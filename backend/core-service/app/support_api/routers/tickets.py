# =============================================================================
# HERMES Support API — ticket create + snapshot + musteri komutlari
# =============================================================================
# 04 §6-§8. Uc degismez kural:
#
#   1) UYGULAMA SINIRI: kapsam token'dan gelir; govdede
#      `application_code` alani YOKTUR, dolayisiyla bir uygulama baska
#      bir uygulamanin adina islem YAPAMAZ.
#   2) TENANT SINIRI: `source_tenant_id` govdeden gelse de mapping,
#      token'in uygulamasi icinde aranir ve aktif olmak zorundadir.
#   3) MUSTERI SINIRI: snapshot ve komutlar requester'a (veya kaynak
#      backend'in `view_all` beyanina) kilitlidir; kapsam disi kayit
#      VAR OLMAYAN kayittir (ayni 404 zarfi).
# =============================================================================

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...models.ticketing import Ticket
from ...services import (
    ticket_idempotency as idem,
    ticket_routing,
    ticket_serializers as ser,
    ticket_service,
    ticket_visibility as visibility,
)
from ...services.ticket_service import Actor, TicketCreateInput
from ...ticket_contract import HEADER_IDEMPOTENCY_KEY, format_ticket_number
from ..deps import (
    correlation_id,
    get_support_db,
    require_scopes,
    resolve_source_tenant,
    translate,
)
from ..errors import SupportAPIError
from ..schemas import (
    ConfirmCloseIn,
    MessageIn,
    ReasonIn,
    TicketCreateIn,
    TicketCreatedOut,
)

router = APIRouter(prefix="/v1/support", tags=["Support tickets"])


def _actor(
    request: Request, requester, *, reason: Optional[str] = None
) -> Actor:
    """Integration kaynakli komutun aktoru.

    `type='integration_client'` audit icin; `role='requester'` durum
    makinesi icin. Ikisi bilerek ayridir: komutu ILETEN bir makine,
    VEREN bir musteridir.
    """
    return Actor(
        type="integration_client",
        role="requester",
        id=str(requester.id),
        display_name=requester.display_name,
        source_user_id=str(requester.id),
        correlation_id=correlation_id(request),
        reason=reason,
    )


def _load_ticket(
    db: Session, ticket: Optional[Ticket], scope, source_tenant,
    requester_id: Optional[str], *, for_update: bool = False,
) -> Ticket:
    if ticket is None:
        raise SupportAPIError("not_found")
    try:
        visibility.assert_integration_can_view(
            ticket, scope,
            source_tenant_row_id=source_tenant.id,
            requester_source_user_id=requester_id,
        )
    except visibility.TicketAccessDenied as exc:
        raise translate(exc)
    return ticket


def _by_id(db: Session, ticket_id: UUID, *, for_update=False):
    query = db.query(Ticket).filter(Ticket.id == ticket_id)
    if for_update:
        query = query.with_for_update()
    return query.first()


def _requester_filter(command) -> Optional[str]:
    """`view_all` beyani varsa requester filtresi UYGULANMAZ.

    Beyan, kaynak backend'in KENDI oturumundan turettigi sunucu-taraf
    bir iddiadir; tarayiciya asla acilmaz. Yine de tenant sinirini
    ASAMAZ — `view_all` yalnizca ayni kaynak tenant icinde genisletir.
    """
    return None if command.view_all else str(command.requester.id)


# =============================================================================
# Create
# =============================================================================

@router.post("/tickets", response_model=None, status_code=201)
def create_ticket(
    payload: TicketCreateIn,
    request: Request,
    scope=Depends(require_scopes("support:tickets:write")),
    db: Session = Depends(get_support_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY
    ),
):
    """Canonical ticket olusturur (idempotent).

    Yanit kaybolursa AYNI `Idempotency-Key` ile tekrar denenir ve
    saklanan yanit doner; anahtar gonderilmese bile
    `uq_tickets_source_identity` ayni kaynak ticket'in ikinci kez
    canonical olmasini engeller.
    """
    source_tenant = resolve_source_tenant(
        db, scope, payload.source_tenant.id
    )
    # Gorunen ad SNAPSHOT'ini tazele (kimlik degismez).
    if payload.source_tenant.display_name:
        source_tenant.display_name = payload.source_tenant.display_name[:200]

    body = payload.model_dump(mode="json")
    try:
        guard = idem.begin(
            db, owner_type=idem.OWNER_INTEGRATION,
            owner_id=str(scope.client_id),
            key=idem.validate_key(idempotency_key),
            route="POST /v1/support/tickets", payload=body,
        )
    except idem.IdempotencyError as exc:
        raise translate(exc)
    if guard.replay is not None:
        # Replay 200 doner (201 DEGIL): consumer, kaydin bu istekle
        # DEGIL onceki istekle olustugunu ayirt edebilsin (04 §6).
        return JSONResponse(
            status_code=200, content=guard.replay,
            headers={"Idempotency-Replayed": "true"},
        )

    try:
        from ...models.ticketing import SupportApplication

        application = db.get(SupportApplication, scope.application_id)
        route, group = ticket_routing.resolve_route(
            db, source_tenant=source_tenant,
            expected_route_version=payload.route.route_version,
        )
        if group.id != payload.route.group_id:
            # Kaynak, konfigure edilmis olandan BASKA bir grup istedi.
            # Bu bir "stale config" durumudur; sessizce dogru gruba
            # yonlendirmek, platform yoneticisinin yanlis bir ekibi
            # gorunurde secili tuttugu bir tutarsizligi gizlerdi.
            raise SupportAPIError(
                "route_stale",
                "The requested group does not match the active route.",
                details={"active_route_version": route.route_version},
            )
        data = TicketCreateInput(
            source_ticket_id=payload.source_ticket_id,
            requester_source_user_id=payload.requester.id,
            requester_display_name=payload.requester.display_name,
            requester_email=payload.requester.email,
            title=payload.title,
            description=payload.description,
            category=payload.category,
            impact=payload.impact,
            reproduction_steps=payload.reproduction_steps,
            expected_result=payload.expected_result,
            actual_result=payload.actual_result,
            error_code=payload.error_code,
            correlation_id=payload.correlation_id or correlation_id(request),
            occurred_at=payload.occurred_at,
            client_context=(
                payload.client_context.model_dump(mode="json")
                if payload.client_context else {}
            ),
            attachment_ids=payload.attachment_upload_ids,
        )
        ticket = ticket_service.create_ticket(
            db, application=application, source_tenant=source_tenant,
            group=group, route_version=route.route_version, data=data,
            actor=_actor(request, payload.requester),
        )
        out = TicketCreatedOut(
            ticket_id=ticket.id,
            ticket_number=format_ticket_number(ticket.number),
            status=ticket.status,
            assigned_group={
                "id": str(ticket.assigned_group_id),
                "name": ticket.assigned_group_name_snapshot,
            },
            created_at=ticket.created_at,
            version=int(ticket.version or 1),
        ).model_dump(mode="json")
    except SupportAPIError:
        guard.release()
        raise
    except Exception as exc:  # noqa: BLE001
        guard.release()
        raise translate(exc)

    guard.commit(201, out, ticket_id=ticket.id)
    return JSONResponse(status_code=201, content=out)


# =============================================================================
# Snapshot
# =============================================================================

@router.get("/tickets/by-source/{source_ticket_id}")
def get_by_source(
    source_ticket_id: str,
    source_tenant_id: str,
    request: Request,
    response: Response,
    requester_id: Optional[str] = None,
    scope=Depends(require_scopes("support:tickets:read")),
    db: Session = Depends(get_support_db),
):
    """Kaynak kimligiyle arama — reconciliation'in ana yolu (06 §4)."""
    source_tenant = resolve_source_tenant(db, scope, source_tenant_id)
    ticket = (
        db.query(Ticket)
        .filter(
            Ticket.application_id == scope.application_id,
            Ticket.source_tenant_row_id == source_tenant.id,
            Ticket.source_ticket_id == source_ticket_id,
        )
        .first()
    )
    ticket = _load_ticket(
        db, ticket, scope, source_tenant, requester_id
    )
    return _snapshot(db, ticket, response)


@router.get("/tickets/{ticket_id}")
def get_ticket(
    ticket_id: UUID,
    source_tenant_id: str,
    request: Request,
    response: Response,
    requester_id: Optional[str] = None,
    scope=Depends(require_scopes("support:tickets:read")),
    db: Session = Depends(get_support_db),
):
    source_tenant = resolve_source_tenant(db, scope, source_tenant_id)
    ticket = _load_ticket(
        db, _by_id(db, ticket_id), scope, source_tenant, requester_id
    )
    return _snapshot(db, ticket, response)


def _snapshot(db: Session, ticket: Ticket, response: Response):
    """Musteri projeksiyonu — internal alan/mesaj ICERMEZ.

    ETag `version`den turetilir: consumer degismeyen bir ticket'i
    tekrar cekmek zorunda kalmaz (reconciliation maliyeti duser).
    """
    payload = ser.customer_detail(db, ticket).model_dump(mode="json")
    response.headers["ETag"] = f'W/"{ticket.id}-{ticket.version}"'
    response.headers["Cache-Control"] = "private, no-store"
    return payload


# =============================================================================
# Musteri komutlari
# =============================================================================

def _command_context(db: Session, scope, command, ticket_id: UUID):
    source_tenant = resolve_source_tenant(
        db, scope, command.source_tenant_id
    )
    ticket = _load_ticket(
        db, _by_id(db, ticket_id, for_update=True), scope, source_tenant,
        _requester_filter(command),
    )
    from ...models.ticketing import SupportApplication

    application = db.get(SupportApplication, scope.application_id)
    return source_tenant, ticket, application


def _idempotent(
    db, scope, key, route: str, payload: dict, run, ticket_id=None
):
    try:
        guard = idem.begin(
            db, owner_type=idem.OWNER_INTEGRATION,
            owner_id=str(scope.client_id), key=idem.validate_key(key),
            route=route, payload=payload,
        )
    except idem.IdempotencyError as exc:
        raise translate(exc)
    if guard.replay is not None:
        return JSONResponse(
            status_code=200, content=guard.replay,
            headers={"Idempotency-Replayed": "true"},
        )
    try:
        status_code, body = run()
    except SupportAPIError:
        guard.release()
        raise
    except Exception as exc:  # noqa: BLE001
        guard.release()
        raise translate(exc)
    guard.commit(status_code, body, ticket_id=ticket_id)
    return JSONResponse(status_code=status_code, content=body)


@router.post("/tickets/{ticket_id}/messages", status_code=201)
def add_message(
    ticket_id: UUID,
    payload: MessageIn,
    request: Request,
    scope=Depends(require_scopes("support:tickets:write")),
    db: Session = Depends(get_support_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY
    ),
):
    """Musteri public yaniti. Internal not YAZILAMAZ — sema boyle bir
    alan tanimlamaz ve servis `author_type='requester'` icin internal
    gorunurlugu reddeder."""
    source_tenant, ticket, application = _command_context(
        db, scope, payload, ticket_id
    )

    def run():
        message = ticket_service.add_message(
            db, ticket, body=payload.body, visibility="public",
            actor=_actor(request, payload.requester),
            author_type="requester",
            source_message_id=payload.source_message_id,
            attachment_ids=payload.attachment_upload_ids,
            application=application, source_tenant=source_tenant,
        )
        return 201, {
            "message_id": str(message.id),
            "sequence": message.sequence,
            "ticket_status": ticket.status,
            "version": int(ticket.version or 1),
        }

    return _idempotent(
        db, scope, idempotency_key,
        "POST /v1/support/tickets/{id}/messages",
        payload.model_dump(mode="json"), run, ticket_id=ticket.id,
    )


@router.post("/tickets/{ticket_id}/reopen")
def reopen(
    ticket_id: UUID,
    payload: ReasonIn,
    request: Request,
    scope=Depends(require_scopes("support:tickets:write")),
    db: Session = Depends(get_support_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY
    ),
):
    source_tenant, ticket, application = _command_context(
        db, scope, payload, ticket_id
    )

    def run():
        ticket_service.reopen(
            db, ticket, reason=payload.reason,
            actor=_actor(request, payload.requester, reason=payload.reason),
            expected_version=None,
            application=application, source_tenant=source_tenant,
        )
        return 200, {"ticket_id": str(ticket.id), "status": ticket.status,
                     "version": int(ticket.version or 1)}

    return _idempotent(
        db, scope, idempotency_key,
        "POST /v1/support/tickets/{id}/reopen",
        payload.model_dump(mode="json"), run, ticket_id=ticket.id,
    )


@router.post("/tickets/{ticket_id}/confirm-close")
def confirm_close(
    ticket_id: UUID,
    payload: ConfirmCloseIn,
    request: Request,
    scope=Depends(require_scopes("support:tickets:write")),
    db: Session = Depends(get_support_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY
    ),
):
    source_tenant, ticket, application = _command_context(
        db, scope, payload, ticket_id
    )

    def run():
        ticket_service.confirm_close(
            db, ticket, actor=_actor(request, payload.requester),
            application=application, source_tenant=source_tenant,
        )
        return 200, {"ticket_id": str(ticket.id), "status": ticket.status,
                     "version": int(ticket.version or 1)}

    return _idempotent(
        db, scope, idempotency_key,
        "POST /v1/support/tickets/{id}/confirm-close",
        payload.model_dump(mode="json"), run, ticket_id=ticket.id,
    )


@router.post("/tickets/{ticket_id}/cancel")
def cancel(
    ticket_id: UUID,
    payload: ReasonIn,
    request: Request,
    scope=Depends(require_scopes("support:tickets:write")),
    db: Session = Depends(get_support_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY
    ),
):
    source_tenant, ticket, application = _command_context(
        db, scope, payload, ticket_id
    )

    def run():
        ticket_service.cancel(
            db, ticket, reason=payload.reason,
            actor=_actor(request, payload.requester, reason=payload.reason),
            expected_version=None,
            application=application, source_tenant=source_tenant,
        )
        return 200, {"ticket_id": str(ticket.id), "status": ticket.status,
                     "version": int(ticket.version or 1)}

    return _idempotent(
        db, scope, idempotency_key,
        "POST /v1/support/tickets/{id}/cancel",
        payload.model_dump(mode="json"), run, ticket_id=ticket.id,
    )
