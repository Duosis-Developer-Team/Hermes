# =============================================================================
# HERMES core — Duosis Ticket Hub (agent) API
# =============================================================================
# Bu yuzey YALNIZCA Duosis support tenant'inda vardir; baska bir
# tenant'in kullanicisi icin 404'tur (bkz. ticket_deps).
#
# Her ucta IKI kapi birden calisir:
#   izin   → `scope.permissions` (RBAC, S2S cozumlu)
#   kapsam → `ticket_visibility` predicate'i (canli grup uyeligi)
# Ikisinden biri eksikse islem yapilmaz. Kapsam disi bir ticket'in
# VARLIGI bile sizmaz (404).
# =============================================================================

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from starlette.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    Ticket,
    TicketAttachment,
    TicketEvent,
)
from ..models.user_group import UserGroup, UserGroupMember
from ..schemas.ticketing import (
    ApplicationOut,
    AssignGroupRequest,
    AssignUserRequest,
    AttachmentOut,
    MessageAgentOut,
    MessageCreateRequest,
    PriorityRequest,
    QueueCountOut,
    ReasonRequest,
    ResolveRequest,
    RoutingGroupOut,
    TicketAgentOut,
    TicketContextOut,
    TicketEventOut,
    TicketListResponse,
    TransitionRequest,
)
from ..services import support_tenant as support
from ..services import (
    ticket_attachment_service,
    ticket_queries,
    ticket_routing,
    ticket_serializers as ser,
    ticket_service,
    ticket_visibility as visibility,
)
from ..services.ticket_service import Actor
from .ticket_deps import (
    correlation_id,
    get_support_db,
    hub_scope,
    http_error,
    require_support_surface,
    translate,
)

router = APIRouter(prefix="/tickets", tags=["Ticket Hub"])


# =============================================================================
# Yardimcilar
# =============================================================================

def _actor(
    user: CurrentUser, scope: visibility.HubScope, request: Request,
    reason: Optional[str] = None,
) -> Actor:
    return Actor(
        type="support_agent",
        role="admin" if scope.is_admin else "agent",
        id=str(user.id),
        display_name=user.email,
        user_id=UUID(str(user.id)),
        correlation_id=correlation_id(request),
        reason=reason,
    )


def _load_ticket(
    db: Session, ticket_id: UUID, scope: visibility.HubScope,
    *, for_update: bool = False,
) -> Ticket:
    query = db.query(Ticket).filter(Ticket.id == ticket_id)
    if for_update:
        # Mutasyonlarda satir kilidi: ayni ticket uzerinde es zamanli
        # iki komut, olay sirasini (sequence) bozmadan sirayla islenir.
        query = query.with_for_update()
    ticket = query.first()
    if ticket is None:
        raise http_error("not_found", "This ticket does not exist.")
    try:
        visibility.assert_hub_can_view(ticket, scope)
    except visibility.TicketAccessDenied as exc:
        raise translate(exc)
    return ticket


def _refs(db: Session, ticket: Ticket):
    return (
        db.get(SupportApplication, ticket.application_id),
        db.get(SupportSourceTenant, ticket.source_tenant_row_id),
    )


def _detail(
    db: Session, ticket: Ticket, scope: visibility.HubScope
) -> TicketAgentOut:
    app, src = _refs(db, ticket)
    return ser.agent_detail(
        db, ticket, application=app, source_tenant=src,
        is_admin=scope.is_admin,
    )


def _require(scope: visibility.HubScope, code: str) -> None:
    try:
        visibility.require_hub_permission(scope, code)
    except visibility.TicketAccessDenied as exc:
        raise translate(exc)


# =============================================================================
# Baglam — HANGI yuzey? (her tenant icin calisir)
# =============================================================================

@router.get("/context", response_model=TicketContextOut)
def ticket_context(
    current_user: CurrentUser = Depends(get_current_user),
    db: Optional[Session] = Depends(get_support_db),
):
    """Frontend'in hangi yuzeyi acacagini SUNUCU soyler.

    Tenant kimligi (Duosis UUID'si) frontend'e ASLA gomulmez; istemci
    yalnizca `surface` degerini okur. Boylece support tenant'i
    degistiginde tek bir ConfigMap degeri yeter.
    """
    from ..config import get_settings

    settings = get_settings()
    state, _detail = support.module_state()
    if db is None:
        return TicketContextOut(
            module_enabled=bool(settings.SUPPORT_TICKETS_ENABLED),
            surface="unavailable", reason=state,
            attachments_enabled=False,
        )

    permissions = visibility.effective_ticket_permissions(current_user)
    has_access = Perm.TICKETS_ACCESS in permissions
    ticket_permissions = sorted(
        p for p in permissions if p.startswith("tickets.")
    )

    if support.is_support_tenant(current_user.tenant_id):
        if not has_access:
            return TicketContextOut(
                module_enabled=True, surface="unavailable",
                reason="missing_permission",
                permissions=ticket_permissions,
            )
        groups = visibility.active_group_ids(db, current_user.id)
        return TicketContextOut(
            module_enabled=True, surface="hub",
            permissions=ticket_permissions,
            can_create=False,
            has_scope=bool(groups) or Perm.TICKETS_ADMIN in permissions,
            attachments_enabled=bool(settings.TICKET_ATTACHMENTS_ENABLED),
        )

    # Musteri portali: route hazir mi?
    from ..schemas.ticketing import RouteStatusOut

    route_status = RouteStatusOut(configured=False)
    if has_access:
        app = ticket_routing.get_application(
            db, settings.SUPPORT_HERMES_APPLICATION_CODE
        )
        if app is not None:
            src = ticket_routing.get_source_tenant(
                db, application_id=app.id,
                source_tenant_id=str(current_user.tenant_id),
            )
            if src is not None:
                route = ticket_routing.active_route(
                    db, source_tenant_row_id=src.id
                )
                if route is not None:
                    group = db.get(UserGroup, route.group_id)
                    route_status = RouteStatusOut(
                        configured=bool(group and group.is_active),
                        group_name=group.name if group else None,
                        route_version=int(route.route_version),
                    )
    return TicketContextOut(
        module_enabled=True,
        surface="portal" if has_access else "unavailable",
        reason=None if has_access else "missing_permission",
        permissions=ticket_permissions,
        can_create=Perm.TICKETS_CREATE in permissions
        and route_status.configured,
        attachments_enabled=bool(settings.TICKET_ATTACHMENTS_ENABLED),
        route=route_status,
    )


# =============================================================================
# Kesif: uygulamalar, kuyruklar, gruplar
# =============================================================================

@router.get("/applications", response_model=List[ApplicationOut])
def list_applications(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return [
        ApplicationOut(**row)
        for row in ticket_queries.application_counts(db, scope)
    ]


@router.get("/queues", response_model=List[QueueCountOut])
def list_queues(
    application_id: Optional[UUID] = Query(None),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return [
        QueueCountOut(**row)
        for row in ticket_queries.queue_counts(
            db, scope, application_id=application_id
        )
    ]


@router.get("/routing-groups", response_model=List[RoutingGroupOut])
def list_routing_groups(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Atama secicisi icin aktif Duosis gruplari."""
    items, _version = ticket_routing.routing_group_catalog(db)
    return [ser.routing_group_out(item) for item in items]


@router.get("/groups/{group_id}/members")
def list_group_members(
    group_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Assignee secicisi: grubun AKTIF uyeleri (yalnizca user id'ler).

    Ad/e-posta DONMEZ — frontend zaten mevcut `users/lookup` dizinini
    kullanir; burada ikinci bir dizin yuzeyi acmayiz.
    """
    rows = (
        db.query(UserGroupMember.user_id)
        .filter(
            UserGroupMember.group_id == group_id,
            UserGroupMember.is_active.is_(True),
        )
        .all()
    )
    return {"group_id": str(group_id),
            "user_ids": [str(r[0]) for r in rows]}


# =============================================================================
# Liste / detay
# =============================================================================

@router.get("", response_model=TicketListResponse)
def list_tickets(
    queue: Optional[str] = Query(None),
    application_id: Optional[UUID] = Query(None),
    source_tenant_row_id: Optional[UUID] = Query(None),
    group_id: Optional[UUID] = Query(None),
    assignee_id: Optional[UUID] = Query(None),
    status: List[str] = Query(default_factory=list),
    category: List[str] = Query(default_factory=list),
    priority: List[str] = Query(default_factory=list),
    search: Optional[str] = Query(None, max_length=120),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    filters = ticket_queries.TicketFilters(
        queue=queue,
        application_id=application_id,
        source_tenant_row_id=source_tenant_row_id,
        group_id=group_id,
        assignee_id=assignee_id,
        statuses=tuple(status),
        categories=tuple(category),
        priorities=tuple(priority),
        search=search,
        created_from=created_from,
        created_to=created_to,
    )
    rows, total = ticket_queries.list_hub_tickets(
        db, scope, filters, limit=limit, offset=offset
    )
    apps, sources = ticket_queries.load_refs(db, rows)
    return TicketListResponse(
        items=[
            ser.agent_list_item(
                t,
                application=apps.get(t.application_id),
                source_tenant=sources.get(t.source_tenant_row_id),
            )
            for t in rows
        ],
        total=total, limit=limit, offset=offset,
    )


@router.get("/{ticket_id}", response_model=TicketAgentOut)
def get_ticket(
    ticket_id: UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    # Admin, GRUP SINIRINI ASARAK acti ise bu AUDITLENIR (05 §2).
    # Kendi grubundaki bir ticket'i acan admin icin kayit uretilmez —
    # aksi halde denetim kaydi gurultuye bogulur ve gercek override
    # gorunmez olurdu.
    if scope.is_admin and ticket.assigned_group_id not in scope.group_ids:
        ticket_service.record_admin_access(
            db, ticket, actor=_actor(current_user, scope, request)
        )
    return _detail(db, ticket, scope)


@router.get("/{ticket_id}/audit", response_model=List[TicketEventOut])
def get_ticket_audit(
    ticket_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    rows = (
        db.query(TicketEvent)
        .filter(TicketEvent.ticket_id == ticket.id)
        .order_by(TicketEvent.sequence)
        .all()
    )
    return [ser.event_out(row) for row in rows]


# =============================================================================
# Komutlar
# =============================================================================

@router.post("/{ticket_id}/messages", response_model=MessageAgentOut,
             status_code=201)
def add_message(
    ticket_id: UUID,
    payload: MessageCreateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_RESPOND)
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app, src = _refs(db, ticket)
    try:
        message = ticket_service.add_message(
            db, ticket, body=payload.body, visibility=payload.visibility,
            actor=_actor(current_user, scope, request),
            author_type="agent",
            attachment_ids=payload.attachment_ids,
            expected_version=payload.expected_version,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001 — tek yerde cevrilir
        raise translate(exc)
    attachments = [
        a for a in ser.load_attachments(db, ticket.id, include_internal=True)
        if a.message_id == message.id
    ]
    return ser.message_agent_out(message, attachments)


@router.post("/{ticket_id}/transition", response_model=TicketAgentOut)
def transition_ticket(
    ticket_id: UUID,
    payload: TransitionRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    # `resolved`/`closed` hedefleri resolve iznine tabidir; normal is
    # akisi gecisleri respond iznine.
    _require(
        scope,
        Perm.TICKETS_RESOLVE
        if payload.to_status in ("resolved", "closed", "reopened")
        else Perm.TICKETS_RESPOND,
    )
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app, src = _refs(db, ticket)
    try:
        ticket_service.transition(
            db, ticket, to_status=payload.to_status,
            actor=_actor(current_user, scope, request, payload.reason),
            expected_version=payload.expected_version,
            reason=payload.reason,
            public_message=payload.public_message,
            attachment_ids=payload.attachment_ids,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _detail(db, ticket, scope)


@router.post("/{ticket_id}/assign-group", response_model=TicketAgentOut)
def assign_group(
    ticket_id: UUID,
    payload: AssignGroupRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_ASSIGN)
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app, src = _refs(db, ticket)
    try:
        ticket_service.assign_group(
            db, ticket, group_id=payload.group_id,
            actor=_actor(current_user, scope, request, payload.reason),
            expected_version=payload.expected_version,
            reason=payload.reason, application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    # DIKKAT: grup degistikten sonra ticket, cagiranin kapsami DISINA
    # cikmis olabilir. Yaniti yine doneriz (islemi O yapti) ama bu,
    # sonraki isteklerde 404 alacagi anlamina gelir — UI bunu
    # "baska ekibe devredildi" olarak gosterir.
    return _detail(db, ticket, scope)


@router.post("/{ticket_id}/assign-user", response_model=TicketAgentOut)
def assign_user(
    ticket_id: UUID,
    payload: AssignUserRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_ASSIGN)
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    try:
        ticket_service.assign_user(
            db, ticket, user_id=payload.user_id,
            actor=_actor(current_user, scope, request),
            expected_version=payload.expected_version,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _detail(db, ticket, scope)


@router.post("/{ticket_id}/priority", response_model=TicketAgentOut)
def set_priority(
    ticket_id: UUID,
    payload: PriorityRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_RESPOND)
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    try:
        ticket_service.set_priority(
            db, ticket, priority=payload.priority,
            actor=_actor(current_user, scope, request),
            expected_version=payload.expected_version,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _detail(db, ticket, scope)


@router.post("/{ticket_id}/resolve", response_model=TicketAgentOut)
def resolve_ticket(
    ticket_id: UUID,
    payload: ResolveRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_RESOLVE)
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app, src = _refs(db, ticket)
    try:
        ticket_service.resolve(
            db, ticket,
            resolution_code=payload.resolution_code,
            public_summary=payload.public_summary,
            actor=_actor(current_user, scope, request),
            expected_version=payload.expected_version,
            public_workaround=payload.public_workaround,
            fix_version=payload.fix_version,
            internal_root_cause=payload.internal_root_cause,
            internal_note=payload.internal_note,
            attachment_ids=payload.attachment_ids,
            duplicate_of_ticket_id=payload.duplicate_of_ticket_id,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _detail(db, ticket, scope)


@router.post("/{ticket_id}/reopen", response_model=TicketAgentOut)
def reopen_ticket(
    ticket_id: UUID,
    payload: ReasonRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_RESOLVE)
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app, src = _refs(db, ticket)
    try:
        ticket_service.reopen(
            db, ticket, reason=payload.reason,
            actor=_actor(current_user, scope, request, payload.reason),
            expected_version=payload.expected_version,
            application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _detail(db, ticket, scope)


# =============================================================================
# Ekler
# =============================================================================

@router.post("/attachments", response_model=AttachmentOut, status_code=201)
def open_attachment_session(
    file_name: str = Query(..., max_length=255),
    size_bytes: int = Query(..., ge=1),
    declared_mime_type: Optional[str] = Query(None, max_length=120),
    sha256: Optional[str] = Query(None, min_length=64, max_length=64),
    visibility_mode: str = Query("public", pattern="^(public|internal)$"),
    application_code: Optional[str] = Query(None, max_length=50),
    scope: visibility.HubScope = Depends(hub_scope),
    current_user: CurrentUser = Depends(require_support_surface),
    db: Session = Depends(get_support_db),
):
    from ..config import get_settings

    _require(scope, Perm.TICKETS_RESPOND)
    code = application_code or get_settings().SUPPORT_HERMES_APPLICATION_CODE
    try:
        app = ticket_routing.require_application(db, code)
        row = ticket_attachment_service.open_upload_session(
            db, application=app, source_tenant=None,
            uploader_type="support_agent", uploader_id=str(current_user.id),
            file_name=file_name, size_bytes=size_bytes,
            declared_mime=declared_mime_type, sha256=sha256,
            visibility=visibility_mode,
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
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from ..config import get_settings

    _require(scope, Perm.TICKETS_RESPOND)
    settings = get_settings()
    body = await request.body()
    if len(body) > int(settings.TICKET_ATTACHMENT_MAX_BYTES):
        raise http_error(
            "validation_error",
            "This file exceeds the maximum attachment size.",
        )
    row = await run_in_threadpool(db.get, TicketAttachment, attachment_id)
    if row is None:
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


@router.get("/{ticket_id}/attachments/{attachment_id}/download")
def download_attachment(
    ticket_id: UUID,
    attachment_id: UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Once TICKET yetkisi, sonra yetkili STREAM (05 §5).

    Imzali/kalici URL uretilmez; icerik uygulama uzerinden akar ve
    `Content-Disposition: attachment` ile inline calistirma yolu
    kapatilir.
    """
    ticket = _load_ticket(db, ticket_id, scope)
    row = db.get(TicketAttachment, attachment_id)
    if row is None or row.ticket_id != ticket.id:
        raise http_error("not_found", "Attachment not found.")
    try:
        stream = ticket_attachment_service.open_download(row)
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    ticket_attachment_service.record_download(
        db, ticket, row, actor=_actor(current_user, scope, request)
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
