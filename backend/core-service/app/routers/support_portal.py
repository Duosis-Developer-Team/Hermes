# =============================================================================
# HERMES core — Musteri destek portali (Hermes tenant'lari)
# =============================================================================
# Bu yuzey, Duosis DISINDAKI her Hermes tenant'inda calisir.
#
# GUVEN SINIRI (00 §4 / 03 §6): musteri tenant'inin normal RLS
# transaction'i canonical Duosis tablosuna YAZMAZ. Akis:
#   1) normal tenant oturumu dogrulanir (JWT, tenant audience);
#   2) `tickets.create` ve modul erisimi kontrol edilir;
#   3) baglam yalnizca ALLOWLIST alanlardan kurulur;
#   4) DAR bir gecit (`support_session`) Duosis baglamina gecer ve
#      YALNIZCA ticket ingress islerini yapar.
# Bu, genel bir `bypass_rls` DEGILDIR: gecit tenant kimligini sunucu
# konfigurasyonundan alir ve baska hicbir tabloya yol acmaz.
# =============================================================================

from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
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
    ConfirmCloseRequest,
    CustomerMessageCreateRequest,
    MessagePublicOut,
    ReasonRequest,
    TicketCreateRequest,
    TicketCustomerListResponse,
    TicketCustomerOut,
)
from ..services import (
    ticket_attachment_service,
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
    get_support_db,
    http_error,
    require_customer_surface,
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


def portal_scope(
    current_user: CurrentUser = Depends(require_customer_surface),
    db: Session = Depends(get_support_db),
) -> visibility.PortalScope:
    """Musterinin kapsami: uygulama SABIT (`hermes`), kaynak tenant
    CAGIRANIN tenant'i, requester CAGIRANIN kullanici kimligi.

    Hicbiri istek govdesinden gelmez — kaynak dogrulanmis oturumdur
    (05 §2: tenant kimligi URL/body'den turetilmez).
    """
    settings = get_settings()
    permissions = visibility.effective_ticket_permissions(current_user)
    if Perm.TICKETS_ACCESS not in permissions:
        raise http_error(
            "forbidden", "tickets.access permission is required."
        )
    app = ticket_routing.get_application(
        db, settings.SUPPORT_HERMES_APPLICATION_CODE
    )
    if app is None:
        raise http_error(
            "support_not_configured",
            "The Hermes support application is not configured.",
        )
    src = ticket_routing.get_source_tenant(
        db, application_id=app.id,
        source_tenant_id=str(current_user.tenant_id),
    )
    return visibility.PortalScope(
        application_id=app.id,
        source_tenant_row_id=src.id if src else None,
        requester_source_user_id=str(current_user.id),
        permissions=permissions,
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
    status: List[str] = Query(default_factory=list),
    category: List[str] = Query(default_factory=list),
    search: Optional[str] = Query(None, max_length=120),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_support_db),
):
    filters = ticket_queries.TicketFilters(
        statuses=tuple(status), categories=tuple(category),
        search=search, created_from=created_from, created_to=created_to,
    )
    rows, total = ticket_queries.list_portal_tickets(
        db, scope, filters, limit=limit, offset=offset
    )
    return TicketCustomerListResponse(
        items=[ser.customer_list_item(t) for t in rows],
        total=total, limit=limit, offset=offset,
    )


@router.get("/tickets/{ticket_id}", response_model=TicketCustomerOut)
def get_my_ticket(
    ticket_id: UUID,
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_support_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    return ser.customer_detail(db, ticket)


# =============================================================================
# Olusturma
# =============================================================================

@router.post("/tickets", response_model=TicketCustomerOut, status_code=201)
def create_ticket(
    payload: TicketCreateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_support_db),
    idempotency_key: Optional[str] = Header(
        None, alias=HEADER_IDEMPOTENCY_KEY,
    ),
):
    settings = get_settings()
    if Perm.TICKETS_CREATE not in scope.permissions:
        raise http_error(
            "forbidden", "tickets.create permission is required."
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
    source_tenant = ticket_routing.ensure_source_tenant(
        db, application=app,
        source_tenant_id=str(current_user.tenant_id),
        display_name=_tenant_display_name(db, current_user.tenant_id),
        slug=_tenant_display_name(db, current_user.tenant_id),
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
        response = ser.customer_detail(db, ticket)
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
    db: Session = Depends(get_support_db),
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
    db: Session = Depends(get_support_db),
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
    return ser.customer_detail(db, ticket)


@router.post("/tickets/{ticket_id}/confirm-close",
             response_model=TicketCustomerOut)
def confirm_close(
    ticket_id: UUID,
    payload: ConfirmCloseRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_support_db),
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
    return ser.customer_detail(db, ticket)


@router.post("/tickets/{ticket_id}/cancel",
             response_model=TicketCustomerOut)
def cancel(
    ticket_id: UUID,
    payload: ReasonRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_support_db),
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
    return ser.customer_detail(db, ticket)


# =============================================================================
# Ekler
# =============================================================================

@router.post("/attachments", response_model=AttachmentOut, status_code=201)
def open_attachment_session(
    request: Request,
    file_name: str = Query(..., max_length=255),
    size_bytes: int = Query(..., ge=1),
    declared_mime_type: Optional[str] = Query(None, max_length=120),
    sha256: Optional[str] = Query(None, min_length=64, max_length=64),
    current_user: CurrentUser = Depends(require_customer_surface),
    scope: visibility.PortalScope = Depends(portal_scope),
    db: Session = Depends(get_support_db),
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
    db: Session = Depends(get_support_db),
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
    db: Session = Depends(get_support_db),
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
