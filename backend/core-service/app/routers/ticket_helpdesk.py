# =============================================================================
# HERMES core — Talep helpdesk uclari (Dalga B)
# =============================================================================
#   /tickets/helpdesk/sla-policy        SLA politikasi + mesai takvimi
#   /tickets/helpdesk/tags              etiket katalogu
#   /tickets/helpdesk/macros            hazir yanitlar
#   /tickets/helpdesk/views             kayitli gorunumler
#   /tickets/helpdesk/notifications     talep bildirimleri (zil)
#   /tickets/helpdesk/mail              e-posta kanali ayari + son gonderimler (D4)
#   /tickets/helpdesk/my-customers      ekiplerime yonlenen musteriler (talepsiz de)
#   /tickets/{id}/tags | /watch | /macros/{mid}/apply | /requester-history
#   /tickets/bulk                       toplu islem
#
# Hepsi HUB yuzeyidir (saglayici, kendi verisi). Yapilandirma yazmak
# `tickets.config.manage` veya `tickets.admin` ister; kisisel makro/gorunum
# sahibine aittir. Talep basina uclar kapsam predicate'inden gecer (kapsam
# disi = 404).
# =============================================================================

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..models.ticket_helpdesk import (
    TicketMacro,
    TicketNotification,
    TicketTag,
    TicketView,
)
from ..models.ticketing import SupportApplication, SupportSourceTenant, Ticket
from ..schemas.ticketing import TagRef, TicketAgentListItem, TicketAgentOut
from ..services import (
    ticket_automation as automation,
    ticket_helpdesk as helpdesk,
    ticket_reports,
    ticket_sla,
    ticket_serializers as ser,
    ticket_visibility as visibility,
)
from ..services.ticket_service import TicketValidationError
from .ticket_deps import (
    get_support_db,
    hub_scope,
    http_error,
    require_support_surface,
    translate,
)
from .tickets import _actor, _detail, _enrich_rows, _load_ticket, _refs, _require

router = APIRouter(prefix="/tickets", tags=["Ticket Helpdesk"])


def _now():
    return datetime.now(timezone.utc)


def _require_config(scope: visibility.HubScope) -> None:
    if not (scope.can_manage_config or scope.is_admin):
        raise http_error("forbidden", "tickets.config.manage permission is required.")


def _validation(exc: Exception):
    if isinstance(exc, (TicketValidationError, ticket_sla.SlaConfigError)):
        return http_error("validation_error", str(exc))
    return translate(exc)


# =============================================================================
# SLA politikasi
# =============================================================================

class SlaPolicyIn(BaseModel):
    name: str = Field("Default", max_length=120)
    is_active: bool = True
    targets: Dict[str, Dict[str, Optional[int]]] = Field(default_factory=dict)
    calendar: Optional[Dict[str, Any]] = None


class SlaPolicyOut(BaseModel):
    exists: bool
    name: str
    is_active: bool
    targets: Dict[str, Dict[str, int]]
    calendar: Optional[Dict[str, Any]] = None
    updated_at: Optional[datetime] = None


def _policy_out(policy) -> SlaPolicyOut:
    if policy is None:
        # Kayit yoksa ONERILEN varsayilanlar (pasif): ekran bunlarla dolar.
        return SlaPolicyOut(
            exists=False, name="Default", is_active=False,
            targets=ticket_sla.DEFAULT_TARGETS, calendar=ticket_sla.DEFAULT_CALENDAR,
        )
    return SlaPolicyOut(
        exists=True, name=policy.name, is_active=bool(policy.is_active),
        targets=policy.targets_json or {}, calendar=policy.calendar_json,
        updated_at=policy.updated_at,
    )


@router.get("/helpdesk/sla-policy", response_model=SlaPolicyOut)
def get_sla_policy(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return _policy_out(ticket_sla.get_policy(db))


@router.put("/helpdesk/sla-policy", response_model=SlaPolicyOut)
def put_sla_policy(
    payload: SlaPolicyIn,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Yeni hedefler YALNIZ yeni taleplere uygulanir (acik talebin sozu
    acilista kopyalanmistir); oncelik degisen talep yeni hedefi alir."""
    _require_config(scope)
    try:
        targets = ticket_sla.validate_targets(payload.targets)
        if payload.calendar:
            ticket_sla.Calendar(payload.calendar)   # dogrula (hata → 400)
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    policy = ticket_sla.get_policy(db)
    if policy is None:
        from ..models.ticket_helpdesk import TicketSlaPolicy

        policy = TicketSlaPolicy()
        db.add(policy)
    policy.name = " ".join(payload.name.split()) or "Default"
    policy.is_active = payload.is_active
    policy.targets_json = targets
    policy.calendar_json = payload.calendar or None
    policy.updated_by_user_id = UUID(str(current_user.id))
    policy.updated_at = _now()
    db.flush()
    return _policy_out(policy)


# =============================================================================
# Etiketler
# =============================================================================

class TagIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    color: str = "blue"
    is_active: Optional[bool] = None


class TagOut(TagRef):
    is_active: bool = True


def _tag_out(tag) -> TagOut:
    return TagOut(id=tag.id, name=tag.name, color=tag.color, is_active=tag.is_active)


@router.get("/helpdesk/tags", response_model=List[TagOut])
def list_tags(
    include_inactive: bool = Query(False),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return [_tag_out(t) for t in helpdesk.list_tags(db, include_inactive=include_inactive)]


@router.post("/helpdesk/tags", response_model=TagOut, status_code=201)
def create_tag(
    payload: TagIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require_config(scope)
    try:
        return _tag_out(helpdesk.save_tag(db, name=payload.name, color=payload.color))
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)


@router.patch("/helpdesk/tags/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: UUID,
    payload: TagIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require_config(scope)
    tag = db.get(TicketTag, tag_id)
    if tag is None:
        raise http_error("not_found", "Tag not found.")
    try:
        return _tag_out(helpdesk.save_tag(
            db, name=payload.name, color=payload.color, tag=tag, is_active=payload.is_active,
        ))
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)


class TicketTagsIn(BaseModel):
    tag_ids: List[UUID] = Field(default_factory=list, max_length=20)


@router.put("/{ticket_id}/tags", response_model=List[TagRef])
def set_ticket_tags(
    ticket_id: UUID,
    payload: TicketTagsIn,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_RESPOND)
    ticket = _load_ticket(db, ticket_id, scope)
    try:
        tags = helpdesk.set_ticket_tags(db, ticket, payload.tag_ids,
                                        actor_user_id=UUID(str(current_user.id)))
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return [TagRef(id=t.id, name=t.name, color=t.color) for t in tags]


# =============================================================================
# Hazir yanitlar (makrolar)
# =============================================================================

class MacroIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    body: Optional[str] = Field(None, max_length=10000)
    visibility: Literal["public", "internal"] = "public"
    set_status: Optional[str] = None
    set_priority: Optional[str] = None
    add_tag_ids: List[UUID] = Field(default_factory=list, max_length=10)
    is_shared: bool = True
    is_active: Optional[bool] = None


class MacroOut(BaseModel):
    id: UUID
    name: str
    body: Optional[str] = None
    visibility: str
    set_status: Optional[str] = None
    set_priority: Optional[str] = None
    add_tag_ids: List[UUID] = Field(default_factory=list)
    is_shared: bool
    is_mine: bool = False
    is_active: bool = True


def _macro_out(macro, user_id) -> MacroOut:
    return MacroOut(
        id=macro.id, name=macro.name, body=macro.body, visibility=macro.visibility,
        set_status=macro.set_status, set_priority=macro.set_priority,
        add_tag_ids=macro.add_tag_ids or [], is_shared=macro.is_shared,
        is_mine=str(macro.owner_user_id) == str(user_id), is_active=macro.is_active,
    )


def _can_edit_macro(scope, macro) -> bool:
    if macro.is_shared:
        return scope.can_manage_config or scope.is_admin
    return str(macro.owner_user_id) == str(scope.user_id)


@router.get("/helpdesk/macros", response_model=List[MacroOut])
def list_macros(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return [_macro_out(m, scope.user_id) for m in helpdesk.visible_macros(db, scope.user_id)]


def _save_macro(db, scope, payload: MacroIn, macro=None):
    if payload.is_shared:
        _require_config(scope)
    else:
        _require(scope, Perm.TICKETS_RESPOND)
    try:
        helpdesk.validate_macro(
            name=payload.name, body=payload.body, visibility=payload.visibility,
            set_status=payload.set_status, set_priority=payload.set_priority,
        )
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    if macro is None:
        macro = TicketMacro(owner_user_id=UUID(str(scope.user_id)))
        db.add(macro)
    macro.name = " ".join(payload.name.split())
    macro.body = payload.body
    macro.visibility = payload.visibility
    macro.set_status = payload.set_status or None
    macro.set_priority = payload.set_priority or None
    macro.add_tag_ids = [str(t) for t in payload.add_tag_ids]
    macro.is_shared = payload.is_shared
    if payload.is_active is not None:
        macro.is_active = payload.is_active
    macro.updated_at = _now()
    db.flush()
    return _macro_out(macro, scope.user_id)


@router.post("/helpdesk/macros", response_model=MacroOut, status_code=201)
def create_macro(
    payload: MacroIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return _save_macro(db, scope, payload)


@router.patch("/helpdesk/macros/{macro_id}", response_model=MacroOut)
def update_macro(
    macro_id: UUID,
    payload: MacroIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    macro = db.get(TicketMacro, macro_id)
    if macro is None or not _can_edit_macro(scope, macro):
        raise http_error("not_found", "Macro not found.")
    return _save_macro(db, scope, payload, macro)


class MacroApplyIn(BaseModel):
    body: Optional[str] = Field(None, max_length=10000)
    expected_version: int = Field(..., ge=1)


@router.post("/{ticket_id}/macros/{macro_id}/apply", response_model=TicketAgentOut)
def apply_macro(
    ticket_id: UUID,
    macro_id: UUID,
    payload: MacroApplyIn,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require(scope, Perm.TICKETS_RESPOND)
    macro = db.get(TicketMacro, macro_id)
    if macro is None or not macro.is_active or not (
        macro.is_shared or str(macro.owner_user_id) == str(scope.user_id)
    ):
        raise http_error("not_found", "Macro not found.")
    ticket = _load_ticket(db, ticket_id, scope, for_update=True)
    app, src = _refs(db, ticket)
    try:
        helpdesk.apply_macro(
            db, ticket, macro, actor=_actor(current_user, scope, request),
            actor_user_id=UUID(str(current_user.id)), body_override=payload.body,
            expected_version=payload.expected_version, application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return _detail(db, ticket, scope)


# =============================================================================
# Kayitli gorunumler
# =============================================================================

class ViewIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    filters: Dict[str, Any] = Field(default_factory=dict)
    is_shared: bool = False


class ViewOut(BaseModel):
    id: UUID
    name: str
    filters: Dict[str, Any]
    is_shared: bool
    is_mine: bool


def _view_out(view, user_id) -> ViewOut:
    return ViewOut(id=view.id, name=view.name, filters=view.filters_json or {},
                   is_shared=view.is_shared, is_mine=str(view.owner_user_id) == str(user_id))


@router.get("/helpdesk/views", response_model=List[ViewOut])
def list_views(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return [_view_out(v, scope.user_id) for v in helpdesk.list_views(db, scope.user_id)]


@router.post("/helpdesk/views", response_model=ViewOut, status_code=201)
def create_view(
    payload: ViewIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    if payload.is_shared:
        _require_config(scope)
    view = TicketView(
        name=" ".join(payload.name.split()), owner_user_id=UUID(str(scope.user_id)),
        is_shared=payload.is_shared, filters_json=helpdesk.clean_view_filters(payload.filters),
    )
    db.add(view)
    db.flush()
    return _view_out(view, scope.user_id)


@router.delete("/helpdesk/views/{view_id}", status_code=204)
def delete_view(
    view_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Kayitli gorunum KULLANICI tercihidir (talep verisi degil); sahibi
    (paylasilan icin yapilandirma yetkilisi) siler."""
    view = db.get(TicketView, view_id)
    if view is None:
        raise http_error("not_found", "View not found.")
    mine = str(view.owner_user_id) == str(scope.user_id)
    if not (mine or (view.is_shared and (scope.can_manage_config or scope.is_admin))):
        raise http_error("not_found", "View not found.")
    db.delete(view)
    db.flush()


# =============================================================================
# Takip, talep eden gecmisi
# =============================================================================

class WatchIn(BaseModel):
    watching: bool


@router.put("/{ticket_id}/watch", response_model=TicketAgentOut)
def watch_ticket(
    ticket_id: UUID,
    payload: WatchIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    ticket = _load_ticket(db, ticket_id, scope)
    helpdesk.set_watching(db, ticket, UUID(str(scope.user_id)), payload.watching)
    return _detail(db, ticket, scope)


@router.get("/{ticket_id}/requester-history", response_model=List[TicketAgentListItem])
def requester_history(
    ticket_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Ayni talep edenin (kapsam icindeki) diger talepleri — yan panel."""
    ticket = _load_ticket(db, ticket_id, scope)
    rows = helpdesk.requester_history(db, ticket, scope)
    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    items = [ser.agent_list_item(t, application=app, source_tenant=src) for t in rows]
    return _enrich_rows(db, rows, items, scope)


# =============================================================================
# Toplu islem
# =============================================================================

class BulkIn(BaseModel):
    ticket_ids: List[UUID] = Field(..., min_length=1, max_length=helpdesk.MAX_BULK)
    action: Literal["assign_group", "assign_user", "priority", "status", "add_tag", "remove_tag", "watch"]
    value: Optional[Any] = None


class BulkResultOut(BaseModel):
    id: str
    ok: bool
    error: Optional[str] = None


@router.post("/bulk", response_model=List[BulkResultOut])
def bulk(
    payload: BulkIn,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    needed = {
        "assign_group": Perm.TICKETS_ASSIGN, "assign_user": Perm.TICKETS_ASSIGN,
        "priority": Perm.TICKETS_RESPOND, "status": Perm.TICKETS_RESPOND,
        "add_tag": Perm.TICKETS_RESPOND, "remove_tag": Perm.TICKETS_RESPOND,
        "watch": Perm.TICKETS_ACCESS,
    }[payload.action]
    _require(scope, needed)
    value = payload.value
    if payload.action in ("assign_group", "assign_user", "add_tag", "remove_tag") and value:
        try:
            value = UUID(str(value))
        except ValueError:
            raise http_error("validation_error", "Invalid value.")
    try:
        return helpdesk.bulk_apply(
            db, scope, payload.ticket_ids, action=payload.action, value=value,
            actor=_actor(current_user, scope, request),
            actor_user_id=UUID(str(current_user.id)),
        )
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)


# =============================================================================
# Otomasyon kurallari (Dalga D2)
# =============================================================================

class AutomationIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    trigger: Literal["created", "customer_replied", "schedule"]
    is_active: bool = True
    conditions: Dict[str, Any] = Field(default_factory=dict)
    actions: List[Dict[str, Any]] = Field(default_factory=list)
    position: int = 0


class AutomationOut(BaseModel):
    id: UUID
    name: str
    trigger: str
    is_active: bool
    conditions: Dict[str, Any]
    actions: List[Dict[str, Any]]
    position: int
    runs_7d: int = 0
    errors_7d: int = 0
    updated_at: Optional[datetime] = None


class AutomationRunOut(BaseModel):
    id: UUID
    ticket_id: UUID
    ticket_number: Optional[str] = None
    outcome: str
    detail: Optional[str] = None
    ran_at: datetime


def _automation_out(db, rule) -> AutomationOut:
    from datetime import timedelta

    from sqlalchemy import func

    from ..models.ticket_helpdesk import TicketAutomationRun

    since = _now() - timedelta(days=7)
    counts = dict(
        db.query(TicketAutomationRun.outcome, func.count(TicketAutomationRun.id))
        .filter(TicketAutomationRun.automation_id == rule.id, TicketAutomationRun.ran_at >= since)
        .group_by(TicketAutomationRun.outcome).all()
    )
    return AutomationOut(
        id=rule.id, name=rule.name, trigger=rule.trigger, is_active=rule.is_active,
        conditions=rule.conditions_json or {}, actions=rule.actions_json or [],
        position=rule.position, runs_7d=int(counts.get("applied", 0)),
        errors_7d=int(counts.get("error", 0)), updated_at=rule.updated_at,
    )


@router.get("/helpdesk/automations", response_model=List[AutomationOut])
def list_automations(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from ..models.ticket_helpdesk import TicketAutomation

    rules = db.query(TicketAutomation).order_by(TicketAutomation.position, TicketAutomation.created_at).all()
    return [_automation_out(db, r) for r in rules]


def _save_automation(db, scope, payload: AutomationIn, rule=None):
    from ..models.ticket_helpdesk import TicketAutomation

    _require_config(scope)
    try:
        conditions, actions = automation.validate_rule(payload.trigger, payload.conditions, payload.actions)
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    if rule is None:
        rule = TicketAutomation()
        db.add(rule)
    rule.name = " ".join(payload.name.split())
    rule.trigger = payload.trigger
    rule.is_active = payload.is_active
    rule.conditions_json = conditions
    rule.actions_json = actions
    rule.position = payload.position
    rule.updated_by_user_id = UUID(str(scope.user_id))
    rule.updated_at = _now()
    db.flush()
    return _automation_out(db, rule)


@router.post("/helpdesk/automations", response_model=AutomationOut, status_code=201)
def create_automation(
    payload: AutomationIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return _save_automation(db, scope, payload)


@router.put("/helpdesk/automations/{rule_id}", response_model=AutomationOut)
def update_automation(
    rule_id: UUID,
    payload: AutomationIn,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from ..models.ticket_helpdesk import TicketAutomation

    rule = db.get(TicketAutomation, rule_id)
    if rule is None:
        raise http_error("not_found", "Rule not found.")
    return _save_automation(db, scope, payload, rule)


@router.delete("/helpdesk/automations/{rule_id}", status_code=204)
def delete_automation(
    rule_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Kural yapilandirmadir; silinince calisma gecmisi de gider (talep
    verisi degil — eylemlerin kendisi talebin olay gecmisinde kalir)."""
    from ..models.ticket_helpdesk import TicketAutomation

    _require_config(scope)
    rule = db.get(TicketAutomation, rule_id)
    if rule is None:
        raise http_error("not_found", "Rule not found.")
    db.delete(rule)
    db.flush()


@router.get("/helpdesk/automations/{rule_id}/runs", response_model=List[AutomationRunOut])
def automation_runs(
    rule_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from ..ticket_contract import format_ticket_number

    _require_config(scope)
    runs = automation.recent_runs(db, rule_id)
    numbers = {
        t.id: format_ticket_number(t.number)
        for t in db.query(Ticket).filter(Ticket.id.in_([r.ticket_id for r in runs])).all()
    } if runs else {}
    return [AutomationRunOut(id=r.id, ticket_id=r.ticket_id, ticket_number=numbers.get(r.ticket_id),
                             outcome=r.outcome, detail=r.detail, ran_at=r.ran_at) for r in runs]


class CustomerOut(BaseModel):
    id: UUID
    display_name: str
    application: Optional[str] = None


@router.get("/helpdesk/customers", response_model=List[CustomerOut])
def list_customers(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Saglayicinin musterileri (kaynak tenant eslemeleri) — kural kosulu
    ve filtre secicileri icin. Yalniz ad; uye/kimlik verisi yok."""
    rows = (
        db.query(SupportSourceTenant, SupportApplication.display_name)
        .join(SupportApplication, SupportApplication.id == SupportSourceTenant.application_id)
        .order_by(SupportSourceTenant.display_name)
        .all()
    )
    return [CustomerOut(id=src.id, display_name=src.display_name, application=app_name)
            for src, app_name in rows]


# =============================================================================
# Birlestirme (Dalga D1)
# =============================================================================

class MergeIn(BaseModel):
    target_ticket_id: UUID
    public_summary: str = Field(..., min_length=1, max_length=2000)
    note_header: str = Field("", max_length=200)
    expected_version: int = Field(..., ge=1)


@router.post("/{ticket_id}/merge", response_model=TicketAgentOut)
def merge_ticket(
    ticket_id: UUID,
    payload: MergeIn,
    request: Request,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Kaynak talebi hedefe birlestirir; hedefin guncel detayini doner.
    Kaynak cozuldugu icin `tickets.resolve` gerekir; iki talep de kapsamda
    olmali (kapsam disi = 404)."""
    from ..services import ticket_service

    _require(scope, Perm.TICKETS_RESOLVE)
    # Kilit sirasi sabit (id'ye gore): iki ters birlestirme kilitlenmez.
    first, second = sorted([ticket_id, payload.target_ticket_id], key=str)
    a = _load_ticket(db, first, scope, for_update=True)
    b = _load_ticket(db, second, scope, for_update=True) if second != first else a
    source, target = (a, b) if a.id == ticket_id else (b, a)
    try:
        ticket_service.check_version(source, payload.expected_version)
        app, src = _refs(db, source)
        helpdesk.merge_tickets(
            db, source, target, actor=_actor(current_user, scope, request),
            actor_user_id=UUID(str(current_user.id)), public_summary=payload.public_summary,
            note_header=payload.note_header, application=app, source_tenant=src,
        )
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return _detail(db, target, scope)


# =============================================================================
# Raporlar (Dalga C)
# =============================================================================

@router.get("/helpdesk/reports")
def reports(
    days: int = Query(30, ge=1, le=ticket_reports.MAX_DAYS),
    start: Optional[datetime] = Query(None, alias="from"),
    end: Optional[datetime] = Query(None, alias="to"),
    group_id: Optional[UUID] = Query(None),
    tz: str = Query("Europe/Istanbul", max_length=64),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    """Hacim, birikim, medyan sureler, SLA uyumu, CSAT, ekip/ajan kirilimi.
    Kapsam = hub gorunurlugu (yonetici tumu, ajan kendi ekipleri)."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise http_error("validation_error", "Unknown time zone.")
    try:
        window = ticket_reports.period(days=days, start=start, end=end)
        return ticket_reports.build(db, scope, start=window[0], end=window[1],
                                    group_id=group_id, tz=tz)
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)


# =============================================================================
# Bildirimler (zil)
# =============================================================================

class TicketNotificationOut(BaseModel):
    id: UUID
    kind: str
    ticket_id: UUID
    ticket_number: Optional[str] = None
    title: Optional[str] = None
    actor_display_name: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: datetime


class TicketNotificationList(BaseModel):
    items: List[TicketNotificationOut]
    unread: int


@router.get("/helpdesk/notifications", response_model=TicketNotificationList)
def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from ..ticket_contract import format_ticket_number

    rows = helpdesk.list_notifications(db, UUID(str(scope.user_id)), limit=limit)
    tickets = {
        t.id: t for t in db.query(Ticket).filter(Ticket.id.in_([r.ticket_id for r in rows])).all()
    } if rows else {}
    return TicketNotificationList(
        items=[
            TicketNotificationOut(
                id=r.id, kind=r.kind, ticket_id=r.ticket_id,
                ticket_number=format_ticket_number(tickets[r.ticket_id].number) if r.ticket_id in tickets else None,
                title=tickets[r.ticket_id].title if r.ticket_id in tickets else None,
                actor_display_name=r.actor_display_name, read_at=r.read_at, created_at=r.created_at,
            )
            for r in rows
        ],
        unread=helpdesk.unread_count(db, UUID(str(scope.user_id))),
    )


@router.post("/helpdesk/notifications/read-all", status_code=204)
def read_all_notifications(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    (
        db.query(TicketNotification)
        .filter(TicketNotification.user_id == UUID(str(scope.user_id)),
                TicketNotification.read_at.is_(None))
        .update({TicketNotification.read_at: _now()}, synchronize_session=False)
    )


@router.post("/helpdesk/notifications/{notification_id}/read", status_code=204)
def read_notification(
    notification_id: UUID,
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    row = db.get(TicketNotification, notification_id)
    if row is None or str(row.user_id) != str(scope.user_id):
        raise http_error("not_found", "Notification not found.")
    if row.read_at is None:
        row.read_at = _now()


# =============================================================================
# E-posta kanali (Dalga D4)
# =============================================================================

class MailSettingsIn(BaseModel):
    requester_enabled: bool = True
    agent_enabled: bool = True
    language: Literal["tr", "en"] = "tr"
    inbound_enabled: bool = False


class MailDeliveryOut(BaseModel):
    id: UUID
    kind: str
    audience: str
    status: str
    recipient: str
    ticket_number: Optional[str] = None
    attempts: int
    last_error: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None


class MailSettingsOut(MailSettingsIn):
    # Sunucu durumu (salt okunur): gonderim ve gelen kutu dagitim
    # seviyesinde acik mi, saglayicinin gelen adresi ne?
    outbound_ready: bool
    sender: Optional[str] = None
    inbound_configured: bool
    inbound_address: Optional[str] = None
    counts_7d: Dict[str, int]
    recent: List[MailDeliveryOut]


def _mail_out(db: Session, tenant_id: str) -> MailSettingsOut:
    from sqlalchemy import text as sa_text

    from ..config import get_settings
    from ..services import support_tenant as support
    from ..services import ticket_mail
    from ..ticket_contract import format_ticket_number

    cfg = ticket_mail.config(db)
    overview = ticket_mail.delivery_overview(db)
    numbers = dict(
        db.query(Ticket.id, Ticket.number)
        .filter(Ticket.id.in_([r.ticket_id for r in overview["recent"] if r.ticket_id])).all()
    ) if overview["recent"] else {}
    slug = db.execute(sa_text("SELECT slug FROM tenant_registry WHERE tenant_id = CAST(:t AS uuid)"),
                      {"t": tenant_id}).scalar()
    ready = ticket_mail.graph_ready()
    return MailSettingsOut(
        requester_enabled=cfg.requester_enabled, agent_enabled=cfg.agent_enabled,
        language=cfg.language, inbound_enabled=cfg.inbound_enabled,
        outbound_ready=ready, sender=(get_settings().NOTIF_MAIL_SENDER if ready else None),
        inbound_configured=bool(ticket_mail.inbound_mailbox()),
        inbound_address=ticket_mail.inbound_address(slug, is_support_tenant=support.is_support_tenant(tenant_id)),
        counts_7d=overview["counts"],
        recent=[
            MailDeliveryOut(
                id=r.id, kind=r.kind, audience=r.audience, status=r.status,
                # Ajan alicisi kimlikle tutulur; adres gonderimde cozulur.
                recipient=ticket_mail.mask(r.recipient_email) if r.recipient_email else "team",
                ticket_number=format_ticket_number(numbers[r.ticket_id]) if r.ticket_id in numbers else None,
                attempts=int(r.attempts or 0), last_error=r.last_error,
                created_at=r.created_at, sent_at=r.sent_at,
            )
            for r in overview["recent"]
        ],
    )


@router.get("/helpdesk/mail", response_model=MailSettingsOut)
def get_mail_settings(
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    _require_config(scope)
    return _mail_out(db, str(current_user.tenant_id))


@router.put("/helpdesk/mail", response_model=MailSettingsOut)
def update_mail_settings(
    payload: MailSettingsIn,
    current_user: CurrentUser = Depends(require_support_surface),
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from ..services import ticket_mail

    _require_config(scope)
    ticket_mail.save_config(
        db, requester_enabled=payload.requester_enabled, agent_enabled=payload.agent_enabled,
        language=payload.language, inbound_enabled=payload.inbound_enabled,
        actor_user_id=UUID(str(scope.user_id)),
    )
    return _mail_out(db, str(current_user.tenant_id))


# =============================================================================
# Musterilerim (hub) — talep acmamis musteri de gorunur
# =============================================================================
# Ekiplerime YONLENEN her musteri (aktif route grubu benim ekiplerimden biri)
# ve kapsamimdaki talepleri olan her musteri — hic talep acmamis olsa bile.
# Yonetici (tickets.admin) tumunu gorur. Sayimlar hub kapsamindan (liste ile
# ayni kural). Tur: sirket hesabi / calisma alani (talep agi) / entegrasyon.

class TeamRef(BaseModel):
    id: UUID
    name: str


class MyCustomerOut(BaseModel):
    id: UUID
    display_name: str
    # Sirket hesabi musterisinde hesabin kimligi.
    account_id: Optional[UUID] = None
    # Bagli musteri kaydi (0027): logo musteriden.
    customer_id: Optional[UUID] = None
    application: Optional[str] = None
    kind: Literal["company", "workspace", "integration"]
    team: Optional[TeamRef] = None
    open_count: int = 0
    total_count: int = 0
    last_activity_at: Optional[datetime] = None


OPEN_STATUSES = ("open", "in_progress", "waiting_customer", "reopened")


@router.get("/helpdesk/my-customers", response_model=List[MyCustomerOut])
def my_customers(
    scope: visibility.HubScope = Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    from sqlalchemy import case, func

    from ..config import get_settings
    from ..models.ticketing import SupportTicketRoute
    from ..models.user_group import UserGroup
    from ..services import company_accounts

    stats = {
        row[0]: row[1:]
        for row in visibility.apply_hub_filter(db.query(Ticket), scope)
        .with_entities(
            Ticket.source_tenant_row_id,
            func.count(Ticket.id),
            func.sum(case((Ticket.status.in_(OPEN_STATUSES), 1), else_=0)),
            func.max(Ticket.updated_at),
        )
        .group_by(Ticket.source_tenant_row_id).all()
    }
    routes = {
        r.source_tenant_row_id: r for r in db.query(SupportTicketRoute)
        .filter(SupportTicketRoute.is_active.is_(True)).all()
    }
    groups = {g.id: g for g in db.query(UserGroup).all()}
    hermes_code = get_settings().SUPPORT_HERMES_APPLICATION_CODE
    out = []
    rows = (
        db.query(SupportSourceTenant, SupportApplication)
        .join(SupportApplication, SupportApplication.id == SupportSourceTenant.application_id)
        .filter(SupportSourceTenant.status == "active")
        .order_by(SupportSourceTenant.display_name).all()
    )
    for src, app in rows:
        route = routes.get(src.id)
        mine = route is not None and route.group_id in scope.group_ids
        if not (scope.is_admin or mine or src.id in stats):
            continue
        total, open_count, last = stats.get(src.id, (0, 0, None))
        if src.source_tenant_id.startswith(company_accounts.SOURCE_PREFIX):
            kind = "company"
        elif app.code == hermes_code:
            kind = "workspace"
        else:
            kind = "integration"
        group = groups.get(route.group_id) if route is not None else None
        account_id = (UUID(src.source_tenant_id[len(company_accounts.SOURCE_PREFIX):])
                      if kind == "company" else None)
        out.append(MyCustomerOut(
            id=src.id, display_name=src.display_name, application=app.display_name, kind=kind,
            account_id=account_id, customer_id=getattr(src, "customer_id", None),
            team=TeamRef(id=group.id, name=group.name) if group else None,
            open_count=int(open_count or 0), total_count=int(total or 0), last_activity_at=last,
        ))
    return out
