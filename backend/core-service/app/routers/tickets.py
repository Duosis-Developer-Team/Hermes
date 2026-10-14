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

from fastapi import APIRouter, Depends, Query, Request, status
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
    TicketWorkItemCreateRequest,
    TicketWorkItemRef,
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
    CsatOut,
    RoutingGroupOut,
    SlaStateOut,
    TagRef,
    TicketRefOut,
    TicketAgentOut,
    TicketContextOut,
    TicketEventOut,
    TicketListResponse,
    TransitionRequest,
)
from ..services import support_tenant as support
from ..services import ticket_network as network
from ..services import company_accounts
from ..services import (
    ticket_attachment_service,
    ticket_helpdesk as helpdesk,
    ticket_queries,
    ticket_reports,
    ticket_sla,
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
    caller_is_provider,
    caller_links,
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


def _sla_out(clock) -> Optional[SlaStateOut]:
    state = ticket_sla.clock_state(clock)
    return SlaStateOut(**state) if state else None


def _tag_refs(tags) -> list:
    return [TagRef(id=t.id, name=t.name, color=t.color) for t in tags]


def _enrich_rows(db: Session, rows, items, scope: visibility.HubScope):
    """Liste satirlarina SLA + etiket + okunmamis (tek seferde, N+1 yok)."""
    ids = [t.id for t in rows]
    clocks = ticket_sla.clocks_for(db, ids)
    tags = helpdesk.tags_for(db, ids)
    reads = helpdesk.read_map(db, ids, reader=scope.user_id)
    return [
        item.model_copy(update={
            "sla": _sla_out(clocks.get(t.id)),
            "tags": _tag_refs(tags.get(t.id, [])),
            "unread": helpdesk.agent_unread(t, reads.get(t.id)),
        })
        for t, item in zip(rows, items)
    ]


def _ticket_ref(ticket: Ticket) -> TicketRefOut:
    from ..ticket_contract import format_ticket_number

    from sqlalchemy.orm import object_session

    db = object_session(ticket)
    name = ser.source_name(db, ticket) if db is not None else None
    return TicketRefOut(id=ticket.id, ticket_number=format_ticket_number(ticket.number),
                        title=ticket.title, status=ticket.status,
                        customer_ref=ser.customer_ref(name, ticket.customer_seq))


def _detail(
    db: Session, ticket: Ticket, scope: visibility.HubScope
) -> TicketAgentOut:
    app, src = _refs(db, ticket)
    out = ser.agent_detail(
        db, ticket, application=app, source_tenant=src,
        is_admin=scope.is_admin,
    )
    watchers = helpdesk.watchers_of(db, ticket.id)
    csat = ticket_reports.csat_of(db, ticket.id)
    into = helpdesk.merged_into(db, ticket.id)
    return out.model_copy(update={
        "merged_into": _ticket_ref(into) if into else None,
        "merged_from": [_ticket_ref(t) for t in helpdesk.merged_from(db, ticket.id)],
        "csat": CsatOut(rating=csat.rating, comment=csat.comment, updated_at=csat.updated_at) if csat else None,
        "sla": _sla_out(ticket_sla.clocks_for(db, [ticket.id]).get(ticket.id)),
        "tags": _tag_refs(helpdesk.tags_for(db, [ticket.id]).get(ticket.id, [])),
        "watching": any(str(w) == str(scope.user_id) for w in watchers),
        "watcher_count": len(watchers),
    })


def _require(scope: visibility.HubScope, code: str) -> None:
    try:
        visibility.require_hub_permission(scope, code)
    except visibility.TicketAccessDenied as exc:
        raise translate(exc)


# =============================================================================
# Baglam — HANGI yuzey? (her tenant icin calisir)
# =============================================================================

def _route_status(db: Session, tenant_id: str):
    """Saglayici oturumunda talep edenin varsayilan ekibi hazir mi?"""
    from ..config import get_settings
    from ..schemas.ticketing import RouteStatusOut

    app = ticket_routing.get_application(
        db, get_settings().SUPPORT_HERMES_APPLICATION_CODE
    )
    if app is None:
        return RouteStatusOut(configured=False)
    src = ticket_routing.get_source_tenant(
        db, application_id=app.id, source_tenant_id=str(tenant_id),
    )
    route = (
        ticket_routing.active_route(db, source_tenant_row_id=src.id)
        if src is not None else None
    )
    if route is None:
        return RouteStatusOut(configured=False)
    group = db.get(UserGroup, route.group_id)
    return RouteStatusOut(
        configured=bool(group and group.is_active),
        group_name=group.name if group else None,
        route_version=int(route.route_version),
    )


@router.get("/context", response_model=TicketContextOut)
def ticket_context(
    current_user: CurrentUser = Depends(get_current_user),
    db: Optional[Session] = Depends(get_support_db),
    is_provider: bool = Depends(caller_is_provider),
    caller: tuple = Depends(caller_links),
):
    """Frontend'in hangi yuzey(ler)i acacagini SUNUCU soyler.

    Tenant kimligi frontend'e ASLA gomulmez; istemci `surfaces` ve
    `providers` alanlarini okur. Talep aginda bir tenant:
      - saglayiciysa  → hub ("Gelen talepler"),
      - baglantisi varsa → portal ("Actigim talepler"),
      - ikisi birden olabilir.
    """
    from ..config import get_settings
    from ..schemas.ticketing import PortalProviderOut, RouteStatusOut

    settings = get_settings()
    state, _detail = support.module_state()
    if not support.is_available():
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
    if not has_access:
        return TicketContextOut(
            module_enabled=True, surface="unavailable",
            reason="missing_permission",
            permissions=ticket_permissions,
        )

    is_hub = db is not None and is_provider
    links = list(caller)
    can_create_perm = Perm.TICKETS_CREATE in permissions

    providers = []
    for link in links:
        route = RouteStatusOut(configured=False)
        if link.available:
            try:
                with support.provider_session(link.provider_tenant_id) as pdb:
                    route = _route_status(pdb, company_accounts.source_key(current_user))
            except support.SupportNotConfigured:
                pass
        providers.append(PortalProviderOut(
            tenant_id=link.provider_tenant_id,
            display_name=link.display_name,
            is_active=link.is_active,
            can_create=bool(
                can_create_perm and link.can_create and route.configured
            ),
            route=route,
        ))

    surfaces = (["hub"] if is_hub else []) + (["portal"] if links else [])
    if not surfaces:
        return TicketContextOut(
            module_enabled=True, surface="unavailable",
            reason="not_connected", permissions=ticket_permissions,
        )

    has_scope = True
    if is_hub:
        groups = visibility.active_group_ids(db, current_user.id)
        has_scope = bool(groups) or Perm.TICKETS_ADMIN in permissions
    # Tek saglayicili eski istemciler `route`/`can_create` okur.
    primary_route = providers[0].route if len(providers) == 1 else None
    return TicketContextOut(
        module_enabled=True,
        surface=surfaces[0],
        surfaces=surfaces,
        permissions=ticket_permissions,
        can_create=any(p.can_create for p in providers),
        has_scope=has_scope,
        attachments_enabled=bool(settings.TICKET_ATTACHMENTS_ENABLED),
        route=primary_route,
        providers=providers,
        integrations=is_hub and support.is_support_tenant(current_user.tenant_id),
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
    sort: Optional[str] = Query(None, pattern="^(updated|newest|oldest|priority|due)$"),
    tag: List[UUID] = Query(default_factory=list),
    board: bool = Query(False),
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
        tag_ids=tuple(tag),
        # Kanban (board=true): iptaller yok, tamamlananlar son 14 gun.
        board_window_days=14 if board else None,
    )
    rows, total = ticket_queries.list_hub_tickets(
        db, scope, filters, limit=limit, offset=offset, sort=sort,
    )
    apps, sources = ticket_queries.load_refs(db, rows)
    authors = ticket_queries.last_public_authors(db, [t.id for t in rows])
    items = [
        ser.agent_list_item(
            t,
            application=apps.get(t.application_id),
            source_tenant=sources.get(t.source_tenant_row_id),
            last_public_author=authors.get(t.id),
        )
        for t in rows
    ]
    return TicketListResponse(
        items=_enrich_rows(db, rows, items, scope),
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
    # Okundu bilgisi (Dalga B): listede "okunmamis" isareti bundan cikar.
    helpdesk.mark_read(db, ticket.id, scope.user_id)
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
    # "Bana ata" (talebi ustlenmek) yanit yetkisiyle yeterlidir; BASKASINA
    # atamak `tickets.assign` ister. Hedef yine grubun aktif uyesi olmali
    # (servis dogrular) — atama gorunurluk URETMEZ.
    taking = payload.user_id is not None and str(payload.user_id) == str(current_user.id)
    if not (taking and scope.can_respond):
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


# =============================================================================
# Talep → is (PM rework A6)
# =============================================================================

@router.get("/{ticket_id}/work-items", response_model=List[TicketWorkItemRef])
def list_ticket_work_items(
    ticket_id: UUID,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    return ser.work_item_refs(db, ticket.id)


@router.post(
    "/{ticket_id}/work-items", response_model=TicketAgentOut,
    status_code=status.HTTP_201_CREATED,
)
def create_ticket_work_item(
    ticket_id: UUID,
    payload: TicketWorkItemCreateRequest,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Ticket'tan is kalemi acar (origin_type='ticket'). Ticket olay
    kumesine DOKUNULMAZ (sozlesme donmus); bag is kaleminde tasinir."""
    from ..services import work_item_service as wi

    _require(scope, Perm.TICKETS_RESPOND)
    ticket = _load_ticket(db, ticket_id, scope)
    wi.create_from_ticket(
        db, current_user, ticket=ticket, project_id=payload.project_id,
        customer_id=payload.customer_id, assignee_user_id=payload.assignee_user_id,
        title=payload.title, description=payload.description, due_date=payload.due_date,
        priority=payload.priority, task_type=payload.task_type,
    )
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
