# =============================================================================
# HERMES core — Musteri destek portali (Hermes tenant'lari)
# =============================================================================
# Talep agi baglantisi OLAN her Hermes tenant'inda calisir ("Actigim
# talepler"). Canonical kayit SAGLAYICININ verisindedir.
#
# GUVEN SINIRI (00 §4 / 03 §6): musteri tenant'inin normal RLS
# transaction'i saglayici tablosuna YAZMAZ. Akis:
#   1) normal tenant oturumu dogrulanir (JWT, tenant audience);
#   2) `tickets.create` ve modul erisimi kontrol edilir;
#   3) baglam yalnizca ALLOWLIST alanlardan kurulur;
#   4) saglayici, cagiranin talep agi baglantilarindan COZULUR (istemci
#      `provider` ile yalnizca bu kumeden secer) ve DAR bir gecit
#      (`provider_session`) o baglama gecer.
# Bu, genel bir `bypass_rls` DEGILDIR: gecilebilecek tenant kumesi
# sunucudaki baglanti kaydidir ve baska hicbir tabloya yol acmaz.
# =============================================================================

from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..config import get_settings
from ..models.ticketing import Ticket, TicketAttachment
from ..public_api.rate_limit import get_limiter
from ..schemas.ticketing import (
    AttachmentOut,
    CsatOut,
    ProviderRef,
    ConfirmCloseRequest,
    CustomerMessageCreateRequest,
    MessagePublicOut,
    ReasonRequest,
    TicketCreateRequest,
    TicketCustomerListResponse,
    TicketCustomerOut,
)
from ..services import (
    support_tenant as support,
    ticket_attachment_service,
    ticket_helpdesk as helpdesk,
    ticket_reports,
    ticket_network as network,
    ticket_idempotency as idem,
    ticket_queries,
    ticket_routing,
    ticket_serializers as ser,
    ticket_service,
    ticket_visibility as visibility,
)
from ..services.ticket_service import Actor, TicketCreateInput
from ..ticket_contract import HEADER_IDEMPOTENCY_KEY
from .ticket_deps import (
    client_ip,
    correlation_id,
    get_portal_db,
    http_error,
    network_http_error,
    portal_provider,
    require_customer_surface,
    requested_provider,
    caller_links,
    translate,
)

router = APIRouter(prefix="/support", tags=["Support Portal"])


# =============================================================================
# Kapsam cozumu
# =============================================================================

def _tenant_display_name(db: Session, tenant_id: str) -> str:
    """Tenant gorunen adi core projeksiyonundan (auth'a senkron cagri
    YOK — portal, kontrol duzlemi ayakta olmasa da calismali)."""
    row = db.execute(
        text(
            "SELECT slug FROM tenant_registry "
            " WHERE tenant_id = CAST(:t AS uuid)"
        ),
        {"t": str(tenant_id)},
    ).first()
    return (row[0] if row else str(tenant_id))


def _scope_in(
    db: Session, current_user: CurrentUser, permissions
) -> visibility.PortalScope:
    """Bir saglayici oturumunda musterinin kapsami: uygulama SABIT
    (`hermes`), kaynak tenant CAGIRANIN tenant'i, requester CAGIRANIN
    kullanici kimligi. Hicbiri istek govdesinden gelmez."""
    settings = get_settings()
    app = ticket_routing.get_application(
        db, settings.SUPPORT_HERMES_APPLICATION_CODE
    )
    src = None
    if app is not None:
        src = ticket_routing.get_source_tenant(
            db, application_id=app.id,
            source_tenant_id=str(current_user.tenant_id),
        )
    return visibility.PortalScope(
        # Uygulama henuz yoksa (saglayicida hic talep acilmamis) sifir
        # satir: kaynak satiri da yoktur → predicate kapali.
        application_id=app.id if app is not None else uuid.uuid4(),
        source_tenant_row_id=src.id if src else None,
        requester_source_user_id=str(current_user.id),
        permissions=permissions,
    )


def _require_access(current_user: CurrentUser):
    permissions = visibility.effective_ticket_permissions(current_user)
    if Perm.TICKETS_ACCESS not in permissions:
        raise http_error(
            "forbidden", "tickets.access permission is required."
        )
    return permissions


def portal_scope(
    current_user: CurrentUser = Depends(require_customer_surface),
    db: Session = Depends(get_portal_db),
) -> visibility.PortalScope:
    return _scope_in(db, current_user, _require_access(current_user))


def _customer_out(db: Session, ticket: Ticket, link: network.ProviderLink,
                  requester: str) -> TicketCustomerOut:
    """Musteri detayi + saglayici + memnuniyet (Dalga C)."""
    csat = ticket_reports.csat_of(db, ticket.id)
    return ser.customer_detail(db, ticket).model_copy(update={
        "provider": _provider_ref(link),
        "csat": CsatOut(rating=csat.rating, comment=csat.comment, updated_at=csat.updated_at) if csat else None,
        "can_rate": ticket.status in ticket_reports.CSAT_STATUSES
        and str(ticket.requester_source_user_id) == str(requester),
    })


def _provider_ref(link: network.ProviderLink) -> ProviderRef:
    return ProviderRef(
        tenant_id=link.provider_tenant_id, display_name=link.display_name,
    )


def _actor(user: CurrentUser, request: Request,
           reason: Optional[str] = None) -> Actor:
    return Actor(
        type="tenant_user",
        role="requester",
        id=str(user.id),
        display_name=user.email,
        user_id=UUID(str(user.id)),
        source_user_id=str(user.id),
        correlation_id=correlation_id(request),
        reason=reason,
    )


def _load_ticket(
    db: Session, ticket_id: UUID, scope: visibility.PortalScope,
    *, for_update: bool = False,
) -> Ticket:
    query = db.query(Ticket).filter(Ticket.id == ticket_id)
    if for_update:
        query = query.with_for_update()
    ticket = query.first()
    if ticket is None:
        raise http_error("not_found", "This ticket does not exist.")
    try:
        visibility.assert_portal_can_view(ticket, scope)
    except visibility.TicketAccessDenied as exc:
        raise translate(exc)
    return ticket


def _rate_limit(key: str, limit: int, window: int, message: str) -> None:
    result = get_limiter().check(key, limit, window)
    if not result.allowed:
        raise http_error("rate_limited", message)


# =============================================================================
# Liste / detay
# =============================================================================

@router.get("/tickets", response_model=TicketCustomerListResponse)
def list_my_tickets(
    request: Request,
    status: List[str] = Query(default_factory=list),
    category: List[str] = Query(default_factory=list),
    search: Optional[str] = Query(None, max_length=120),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort: Optional[str] = Query(None, pattern="^(updated|newest|oldest)$"),
    current_user: CurrentUser = Depends(require_customer_surface),
    caller: tuple = Depends(caller_links),
):
    """Tum saglayicilardaki taleplerim — `provider` verilirse yalniz o.

    Birden fazla saglayicida: her birinden `offset+limit` kayit alinir,
    `updated_at`'e gore birlestirilir ve dilimlenir (sayfalama dogru kalir;
    saglayici sayisi kucuktur).
    """
    permissions = _require_access(current_user)
    links = list(caller)
    requested = requested_provider(request)
    if requested:
        try:
            links = [network.resolve_provider(links, requested)]
        except network.NetworkError as exc:
            raise network_http_error(exc)
    links = [link for link in links if link.available]
    filters = ticket_queries.TicketFilters(
        statuses=tuple(status), categories=tuple(category),
        search=search, created_from=created_from, created_to=created_to,
    )
    single = len(links) == 1
    merged, total = [], 0
    for link in links:
        try:
            with support.provider_session(link.provider_tenant_id) as db:
                scope = _scope_in(db, current_user, permissions)
                rows, n = ticket_queries.list_portal_tickets(
                    db, scope, filters,
                    limit=limit if single else offset + limit,
                    offset=offset if single else 0, sort=sort,
                )
                ref = _provider_ref(link)
                reads = helpdesk.read_map(
                    db, [t.id for t in rows], reader=str(current_user.id),
                )
                merged.extend(
                    ser.customer_list_item(t).model_copy(update={
                        "provider": ref,
                        "has_update": helpdesk.customer_has_update(t, reads.get(t.id)),
                    })
                    for t in rows
                )
                total += n
        except support.SupportNotConfigured:
            continue
    if not single:
        if sort in ("newest", "oldest"):
            merged.sort(key=lambda item: item.created_at, reverse=sort == "newest")
        else:
            merged.sort(key=lambda item: item.updated_at, reverse=True)
        merged = merged[offset:offset + limit]
    return TicketCustomerListResponse(
        items=merged, total=total, limit=limit, offset=offset,
    )


@router.get("/tickets/{ticket_id}", response_model=TicketCustomerOut)
def get_my_ticket(
    ticket_id: UUID,
    scope: visibility.PortalScope = Depends(portal_scope),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    helpdesk.mark_read(db, ticket.id, scope.requester_source_user_id)
    return _customer_out(db, ticket, link, scope.requester_source_user_id)


# =============================================================================
# Olusturma
# =============================================================================

@router.post("/tickets", response_model=TicketCustomerOut, status_code=201)
def create_ticket(
    payload: TicketCreateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY,
    ),
):
    settings = get_settings()
    if Perm.TICKETS_CREATE not in scope.permissions:
        raise http_error(
            "forbidden", "tickets.create permission is required."
        )
    # Pasif baglanti YENI talebi durdurur (gecmis gorunur kalir).
    if not link.can_create:
        raise http_error(
            "route_missing",
            "Your workspace can no longer open tickets with this provider.",
        )

    ip = client_ip(request) or "unknown"
    _rate_limit(
        f"support:create:user:{current_user.id}",
        int(settings.SUPPORT_CREATE_LIMIT_PER_10MIN), 600,
        "Too many tickets created recently. Please try again shortly.",
    )
    _rate_limit(
        f"support:create:day:{current_user.tenant_id}",
        int(settings.SUPPORT_CREATE_LIMIT_PER_DAY), 86400,
        "Your workspace reached its daily ticket limit.",
    )
    _rate_limit(f"support:create:ip:{ip}", 60, 600,
                "Too many requests. Please try again shortly.")

    app = ticket_routing.require_application(
        db, settings.SUPPORT_HERMES_APPLICATION_CODE
    )
    # Mapping YALNIZCA yazma yolunda olusturulur: okuma uclarinin
    # yan etkisi olmaz.
    slug = _tenant_display_name(db, current_user.tenant_id)
    source_tenant = ticket_routing.ensure_source_tenant(
        db, application=app,
        source_tenant_id=str(current_user.tenant_id),
        # Konsolun yazdigi gorunen ad (baglanti snapshot'i) slug'dan
        # ONCELIKLIDIR: hub "Acme Holding" gormeli, "acme" degil.
        display_name=link.requester_display_name or slug,
        slug=slug,
    )

    body = payload.model_dump(mode="json")
    try:
        guard = idem.begin(
            db, owner_type=idem.OWNER_TENANT_USER,
            owner_id=str(current_user.id), key=idem.validate_key(
                idempotency_key
            ),
            route="POST /support/tickets", payload=body,
        )
    except idem.IdempotencyError as exc:
        raise http_error(exc.code, str(exc))
    if guard.replay is not None:
        return JSONResponse(
            status_code=guard.replay_status, content=guard.replay,
            headers={"Idempotency-Replayed": "true"},
        )

    try:
        route, group = ticket_routing.resolve_route(
            db, source_tenant=source_tenant
        )
        data = TicketCreateInput(
            source_ticket_id=payload.source_ticket_id or str(uuid.uuid4()),
            requester_source_user_id=str(current_user.id),
            requester_display_name=current_user.email,
            requester_email=current_user.email,
            title=payload.title,
            description=payload.description,
            category=payload.category,
            impact=payload.impact,
            reproduction_steps=payload.reproduction_steps,
            expected_result=payload.expected_result,
            actual_result=payload.actual_result,
            error_code=payload.error_code,
            correlation_id=payload.correlation_id,
            occurred_at=payload.occurred_at,
            client_context=(
                payload.client_context.model_dump(mode="json")
                if payload.client_context else {}
            ),
            attachment_ids=payload.attachment_ids,
        )
        ticket = ticket_service.create_ticket(
            db, application=app, source_tenant=source_tenant, group=group,
            route_version=route.route_version, data=data,
            actor=_actor(current_user, request),
        )
        helpdesk.mark_read(db, ticket.id, str(current_user.id))
        response = ser.customer_detail(db, ticket).model_copy(
            update={"provider": _provider_ref(link)}
        )
    except Exception as exc:  # noqa: BLE001
        guard.release()
        raise translate(exc)

    payload_out = response.model_dump(mode="json")
    guard.commit(201, payload_out, ticket_id=ticket.id)
    return JSONResponse(status_code=201, content=payload_out)


# =============================================================================
# Musteri komutlari
# =============================================================================

@router.post("/tickets/{ticket_id}/messages",
             response_model=MessagePublicOut, status_code=201)
def add_reply(
    ticket_id: UUID,
    payload: CustomerMessageCreateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_portal_db),
):
    settings = get_settings()
    _rate_limit(
        f"support:reply:user:{current_user.id}",
        int(settings.SUPPORT_REPLY_LIMIT_PER_MIN), 60,
        "Too many replies. Please slow down.",
    )
    from ..models.ticketing import SupportApplication, SupportSourceTenant

    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    try:
        message = ticket_service.add_message(
            db, ticket, body=payload.body, visibility="public",
            actor=_actor(current_user, request), author_type="requester",
            attachment_ids=payload.attachment_ids,
            expected_version=payload.expected_version,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    # Kendi yanitini "guncelleme" saymasin.
    helpdesk.mark_read(db, ticket.id, str(current_user.id))
    attachments = [
        a for a in ser.load_attachments(
            db, ticket.id, include_internal=False
        )
        if a.message_id == message.id
    ]
    return ser.message_public_out(message, attachments)


@router.post("/tickets/{ticket_id}/reopen",
             response_model=TicketCustomerOut)
def reopen(
    ticket_id: UUID,
    payload: ReasonRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    from ..models.ticketing import SupportApplication, SupportSourceTenant

    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    try:
        ticket_service.reopen(
            db, ticket, reason=payload.reason,
            actor=_actor(current_user, request, payload.reason),
            expected_version=payload.expected_version,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _customer_out(db, ticket, link, scope.requester_source_user_id)


@router.post("/tickets/{ticket_id}/confirm-close",
             response_model=TicketCustomerOut)
def confirm_close(
    ticket_id: UUID,
    payload: ConfirmCloseRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    from ..models.ticketing import SupportApplication, SupportSourceTenant

    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    try:
        ticket_service.check_version(ticket, payload.expected_version)
        ticket_service.confirm_close(
            db, ticket, actor=_actor(current_user, request),
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _customer_out(db, ticket, link, scope.requester_source_user_id)


@router.post("/tickets/{ticket_id}/cancel",
             response_model=TicketCustomerOut)
def cancel(
    ticket_id: UUID,
    payload: ReasonRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    from ..models.ticketing import SupportApplication, SupportSourceTenant

    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    try:
        ticket_service.cancel(
            db, ticket, reason=payload.reason,
            actor=_actor(current_user, request, payload.reason),
            expected_version=payload.expected_version,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _customer_out(db, ticket, link, scope.requester_source_user_id)


# =============================================================================
# Ekler
# =============================================================================

class CsatIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)


@router.post("/tickets/{ticket_id}/csat", response_model=TicketCustomerOut)
def rate_ticket(
    ticket_id: UUID,
    payload: CsatIn,
    scope: visibility.PortalScope = Depends(portal_scope),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    """Memnuniyet (Dalga C): cozulmus/kapanmis talebi talep eden puanlar."""
    ticket = _load_ticket(db, ticket_id, scope)
    try:
        ticket_reports.submit_csat(
            db, ticket, requester=scope.requester_source_user_id,
            rating=payload.rating, comment=payload.comment,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _customer_out(db, ticket, link, scope.requester_source_user_id)


@router.post("/attachments", response_model=AttachmentOut, status_code=201)
def open_attachment_session(
    request: Request,
    file_name: str = Query(..., max_length=255),
    size_bytes: int = Query(..., ge=1),
    declared_mime_type: Optional[str] = Query(None, max_length=120),
    sha256: Optional[str] = Query(None, min_length=64, max_length=64),
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_portal_db),
):
    settings = get_settings()
    _rate_limit(
        f"support:upload:user:{current_user.id}", 30, 600,
        "Too many uploads. Please try again shortly.",
    )
    try:
        app = ticket_routing.require_application(
            db, settings.SUPPORT_HERMES_APPLICATION_CODE
        )
        source_tenant = ticket_routing.ensure_source_tenant(
            db, application=app,
            source_tenant_id=str(current_user.tenant_id),
            display_name=_tenant_display_name(db, current_user.tenant_id),
        )
        row = ticket_attachment_service.open_upload_session(
            db, application=app, source_tenant=source_tenant,
            uploader_type="tenant_user", uploader_id=str(current_user.id),
            file_name=file_name, size_bytes=size_bytes,
            declared_mime=declared_mime_type, sha256=sha256,
            visibility="public",
        )
    except ticket_attachment_service.AttachmentDisabled as exc:
        raise http_error("support_not_configured", str(exc))
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return ser.attachment_out(row)


@router.post("/attachments/{attachment_id}/content",
             response_model=AttachmentOut)
async def upload_attachment_content(
    attachment_id: UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_portal_db),
):
    settings = get_settings()
    body = await request.body()
    if len(body) > int(settings.TICKET_ATTACHMENT_MAX_BYTES):
        raise http_error(
            "validation_error",
            "This file exceeds the maximum attachment size.",
        )
    row = await run_in_threadpool(db.get, TicketAttachment, attachment_id)
    # Yukleyen kontrolu: baskasinin upload oturumuna icerik yazilamaz.
    if row is None or row.uploader_id != str(current_user.id):
        raise http_error("not_found", "Upload session not found.")
    try:
        await run_in_threadpool(
            ticket_attachment_service.store_upload, db, row, body,
        )
    except ticket_attachment_service.AttachmentDisabled as exc:
        raise http_error("support_not_configured", str(exc))
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return ser.attachment_out(row)


@router.get("/tickets/{ticket_id}/attachments/{attachment_id}/download")
def download_attachment(
    ticket_id: UUID,
    attachment_id: UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_portal_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    row = db.get(TicketAttachment, attachment_id)
    # Musteri yuzeyinde INTERNAL ek yoktur: gorunurluk kontrolu burada
    # da tekrarlanir (serializer'a guvenmek yetmez, dogrudan URL
    # denenebilir).
    if (
        row is None
        or row.ticket_id != ticket.id
        or row.visibility != "public"
    ):
        raise http_error("not_found", "Attachment not found.")
    try:
        stream = ticket_attachment_service.open_download(row)
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    ticket_attachment_service.record_download(
        db, ticket, row, actor=_actor(current_user, request)
    )
    return StreamingResponse(
        stream,
        media_type=row.detected_mime_type or "application/octet-stream",
        headers={
            "Content-Disposition":
                f'attachment; filename="{row.file_name}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
