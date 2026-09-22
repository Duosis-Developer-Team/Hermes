# =============================================================================
# HERMES - Is kalemi servisi (PM rework P1.2)
# =============================================================================
# task_service'in `tasks` uzerindeki is mantiginin `work_items` karsiligi.
# Sozlesmeler (08-p1-plani §4–§5):
#   - Is kalemi TEK satirdir; kisiler `work_item_participants`ta. Eski API
#     "satir = atama" varsayimini KATILIMCI id'siyle karsilar: bir ucta
#     verilen id is kalemi, katilimci YA DA eski tasks.id olabilir
#     (`resolve_ref`). Frontend'in mutasyonlari degismez.
#   - Durum `workflow_states` satiridir; eski `status` sozcugu turetilir
#     (`legacy_status_of`) ve eski sozcukle gelen istek duruma cevrilir.
#   - Kisi basi ilerleme: katilimci `accepted_at`/`completed_at`. Is
#     kaleminin durumu katilimcilardan turer (hepsi tamam → Completed;
#     hic biri baslamadi → Pending; degilse In Progress). Iptal/red is
#     kalemi duzeyindedir.
#   - Gorunurluk (P1.2): admin ∨ reporter ∨ owner ∨ katilimci. Proje
#     uyeligi P1.3'te eklenir; su an kimse is kaybetmez garantisi.
#   - Yetki: cekirdek alanlar reporter/admin (P1.3: owner + proje lideri);
#     durum: reporter/owner/atanan katilimci/admin; not: kendi katilimcisi.
#   - Yonlendirme/atama dogrulamasi task_service'ten AYNEN (P1.3'te
#     routing_relations'a gecer).
#   - Olay adlari (task_created, task_completed, ...) KORUNUR: public API
#     aktivite serializer'i ve bildirim seam'i onlara bakar.
# =============================================================================

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from ..models.customer import Customer
from ..models.project import Project
from ..models.task import TaskSubProject
from ..models.user_group import UserGroup
from ..models.work_item import (
    CODE_PREFIX, TERMINAL_CATEGORIES, WorkflowState, WorkItem, WorkItemCodeAlias,
    WorkItemComment, WorkItemEvent, WorkItemParticipant,
)
from ..schemas.task import TaskCreate, TaskUpdate
from . import task_service
from .task_service import (
    _ensure_customer, _ensure_project, _ensure_sub_project_for_create,
    _validate_assignment, can_assign_to, can_assign_to_group,
    get_active_group_member_ids, is_task_admin, perm_scope_for_type,
    user_has_access,
)
from shared.auth import CurrentUser

# Tohumlanan durum adlari ↔ eski status sozcugu (work_item_migration ile ayni).
LEGACY_BY_NAME = {
    "Pending": "pending", "In Progress": "in_progress",
    "Completed": "completed", "Cancelled": "cancelled", "Rejected": "rejected",
}
LEGACY_BY_CATEGORY = {
    "todo": "pending", "in_progress": "in_progress",
    "done": "completed", "cancelled": "cancelled",
}
NAME_BY_LEGACY = {v: k for k, v in LEGACY_BY_NAME.items()}
CANCEL_LIKE = ("cancelled", "rejected")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# -----------------------------------------------------------------------------
# Durumlar
# -----------------------------------------------------------------------------

def legacy_status_of(item: WorkItem) -> str:
    st = item.state
    if st is None:
        return "pending"
    return LEGACY_BY_NAME.get(st.name) or LEGACY_BY_CATEGORY.get(st.category, "pending")


def _session_tenant_id(db: Session) -> Optional[str]:
    """Oturumun tenant baglami: once session isareti, yoksa GUC."""
    from ..tenant_db import SESSION_TENANT_KEY, TENANT_GUC
    marked = db.info.get(SESSION_TENANT_KEY)
    if marked:
        return str(marked)
    value = db.execute(
        text("SELECT current_setting(:name, true)"), {"name": TENANT_GUC}
    ).scalar()
    return str(value) if value else None


def ensure_states(db: Session) -> bool:
    """Kiracinin akisi yoksa varsayilani tohumlar (0010/0011 tohumunun
    ayni kurali; varsa dokunmaz). 0010'dan SONRA acilan kiraci ya da bos
    test DB'si aksi halde ilk is kaleminde 422 alirdi. Tohumlandiysa True."""
    if db.query(WorkflowState.id).first() is not None:
        return False
    tenant_id = _session_tenant_id(db)
    if not tenant_id:
        return False
    from ..migrations.work_item_migration import seed_states
    seed_states(db.connection(), tenant_id)
    db.flush()
    return True


def list_states(db: Session, *, include_inactive: bool = False) -> List[WorkflowState]:
    ensure_states(db)
    q = db.query(WorkflowState)
    if not include_inactive:
        q = q.filter(WorkflowState.is_active.is_(True))
    return q.order_by(WorkflowState.position.asc(), WorkflowState.name.asc()).all()


def _find_state_for_legacy(db: Session, legacy: str) -> Optional[WorkflowState]:
    name = NAME_BY_LEGACY.get(legacy)
    if name:
        st = db.query(WorkflowState).filter(WorkflowState.name == name).first()
        if st is not None:
            return st
    category = {v: k for k, v in LEGACY_BY_CATEGORY.items()}.get(legacy)
    if not category:
        return None
    return (
        db.query(WorkflowState)
        .filter(WorkflowState.category == category, WorkflowState.is_active.is_(True))
        .order_by(WorkflowState.position.asc())
        .first()
    )


def state_for_legacy(db: Session, legacy: str) -> WorkflowState:
    """Eski status sozcugu → kiracinin durumu. Ad eslesmezse kategori;
    kiracida hic durum yoksa once varsayilan akis tohumlanir."""
    st = _find_state_for_legacy(db, legacy)
    if st is None and ensure_states(db):
        st = _find_state_for_legacy(db, legacy)
    if st is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown status '{legacy}'.",
        )
    return st


def default_state(db: Session) -> WorkflowState:
    st = db.query(WorkflowState).filter(WorkflowState.is_default.is_(True)).first()
    if st is None:
        st = state_for_legacy(db, "pending")
    return st


def state_by_id(db: Session, state_id: UUID) -> WorkflowState:
    st = db.query(WorkflowState).filter(
        WorkflowState.id == state_id, WorkflowState.is_active.is_(True)
    ).first()
    if st is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown state.",
        )
    return st


# -----------------------------------------------------------------------------
# Numaralandirma / kod
# -----------------------------------------------------------------------------

def _next_number(db: Session, tenant_id: str, item_type: str) -> int:
    """tenant_counters'tan atomik numara; sayac geride kaldiysa (golge
    donemde trigger sekansi ilerlemis olabilir) once ileri alinir."""
    from .tenant_counters import next_number
    db.execute(text(
        "INSERT INTO tenant_counters (tenant_id, counter_key, next_value, updated_at) "
        "VALUES (CAST(:t AS uuid), :k, 1, now()) ON CONFLICT DO NOTHING"
    ), {"t": str(tenant_id), "k": item_type})
    db.execute(text(
        "UPDATE tenant_counters SET next_value = GREATEST(next_value, "
        "  COALESCE((SELECT max(item_number) FROM work_items "
        "            WHERE tenant_id = CAST(:t AS uuid) AND item_type = :k), 0) + 1, "
        "  COALESCE((SELECT max(type_number) FROM tasks "
        "            WHERE tenant_id = CAST(:t AS uuid) AND task_type = :k), 0) + 1) "
        " WHERE tenant_id = CAST(:t AS uuid) AND counter_key = :k"
    ), {"t": str(tenant_id), "k": item_type})
    return next_number(db, tenant_id=tenant_id, counter_key=item_type)


def code_of(item_type: str, number: int) -> str:
    return f"{CODE_PREFIX.get(item_type or 'task', 'TASK')}-{number}"


def find_by_code(db: Session, code: str) -> Optional[WorkItem]:
    code = (code or "").strip().upper()
    if not code:
        return None
    item = db.query(WorkItem).filter(WorkItem.item_key == code).first()
    if item is not None:
        return item
    alias = db.query(WorkItemCodeAlias).filter(WorkItemCodeAlias.code == code).first()
    return alias.work_item if alias is None else db.get(WorkItem, alias.work_item_id)


# -----------------------------------------------------------------------------
# Referans cozumu: is kalemi id | katilimci id | eski tasks.id
# -----------------------------------------------------------------------------

def resolve_ref(db: Session, ref: UUID) -> Tuple[Optional[WorkItem], Optional[WorkItemParticipant]]:
    item = db.get(WorkItem, ref)
    if item is not None:
        return item, None
    part = db.get(WorkItemParticipant, ref)
    if part is not None:
        return db.get(WorkItem, part.work_item_id), part
    item = db.query(WorkItem).filter(WorkItem.legacy_task_ids.contains([ref])).first()
    if item is None:
        return None, None
    # Eski satir → o satirin atanani → katilimci.
    row = db.execute(text(
        "SELECT assignee_user_id FROM tasks WHERE id = CAST(:id AS uuid)"
    ), {"id": str(ref)}).first()
    part = None
    if row is not None:
        part = next((p for p in item.participants
                     if p.role == "assignee" and str(p.user_id) == str(row[0])), None)
    return item, part


# -----------------------------------------------------------------------------
# Gorunurluk ve yetki
# -----------------------------------------------------------------------------

def visible_filter(user: CurrentUser):
    """SQLAlchemy kosulu: admin → hepsi; degilse reporter ∨ owner ∨ katilimci."""
    if is_task_admin(user):
        return True  # noqa: E712 — filter(True) tum satirlar
    me = UUID(user.id)
    participant_items = select(WorkItemParticipant.work_item_id).where(
        WorkItemParticipant.user_id == me
    )
    return or_(
        WorkItem.reporter_user_id == me,
        WorkItem.owner_user_id == me,
        WorkItem.id.in_(participant_items),
    )


def assignee_participants(item: WorkItem) -> List[WorkItemParticipant]:
    return [p for p in item.participants if p.role == "assignee"]


def participant_of(item: WorkItem, user_id) -> Optional[WorkItemParticipant]:
    uid = str(user_id)
    return next((p for p in item.participants if p.role == "assignee" and str(p.user_id) == uid), None)


def can_view(user: CurrentUser, item: WorkItem) -> bool:
    if is_task_admin(user):
        return True
    me = str(user.id)
    if str(item.reporter_user_id) == me or (item.owner_user_id and str(item.owner_user_id) == me):
        return True
    return any(str(p.user_id) == me for p in item.participants)


def can_edit_core(user: CurrentUser, item: WorkItem) -> bool:
    if is_task_admin(user):
        return True
    return str(item.reporter_user_id) == str(user.id)


def can_update_status(user: CurrentUser, item: WorkItem) -> bool:
    if is_task_admin(user):
        return True
    me = str(user.id)
    if str(item.reporter_user_id) == me or (item.owner_user_id and str(item.owner_user_id) == me):
        return True
    return participant_of(item, me) is not None


def _load(db: Session, ref: UUID, user: CurrentUser) -> Tuple[WorkItem, Optional[WorkItemParticipant]]:
    item, part = resolve_ref(db, ref)
    if item is None or not can_view(user, item):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    return item, part


def get_item_for_user(db: Session, user: CurrentUser, ref: UUID) -> WorkItem:
    return _load(db, ref, user)[0]


# -----------------------------------------------------------------------------
# Olaylar
# -----------------------------------------------------------------------------

def record_event(db: Session, item: WorkItem, *, actor_user_id: Optional[UUID],
                 event_type: str, event_data: Optional[dict] = None) -> WorkItemEvent:
    seq = db.query(func.coalesce(func.max(WorkItemEvent.sequence), 0)).filter(
        WorkItemEvent.work_item_id == item.id
    ).scalar() or 0
    ev = WorkItemEvent(
        work_item_id=item.id, actor_user_id=actor_user_id,
        event_type=event_type, event_data=event_data, sequence=int(seq) + 1,
    )
    db.add(ev)
    db.flush()
    return ev


# -----------------------------------------------------------------------------
# Kapanis (task_lifecycle sozlesmesinin is kalemi karsiligi)
# -----------------------------------------------------------------------------

def is_terminal(item: WorkItem) -> bool:
    return item.state is not None and item.state.category in TERMINAL_CATEGORIES


def recompute_closure(db: Session, item: WorkItem, *, now: Optional[datetime] = None) -> None:
    """Terminal kategori → closed_at (varsa dokunma); degilse kapanis ve
    arsiv izleri silinir. Terminalden terminale gecis sureyi sifirlamaz."""
    now = now or _now()
    if not is_terminal(item):
        item.closed_at = None
        item.archived_at = None
        item.archive_reason = None
        item.archived_by_user_id = None
        return
    if item.closed_at is None:
        stamps = [p.completed_at for p in assignee_participants(item) if p.completed_at]
        item.closed_at = max(stamps) if stamps else now


def _derive_state_from_participants(db: Session, item: WorkItem) -> WorkflowState:
    parts = assignee_participants(item)
    if parts and all(p.completed_at is not None for p in parts):
        return state_for_legacy(db, "completed")
    if not any(p.accepted_at or p.completed_at for p in parts):
        return state_for_legacy(db, "pending")
    return state_for_legacy(db, "in_progress")


# -----------------------------------------------------------------------------
# Listeleme / arama
# -----------------------------------------------------------------------------

def _base_query(db: Session):
    return db.query(WorkItem).options(
        joinedload(WorkItem.state), joinedload(WorkItem.project).joinedload(Project.customer),
        joinedload(WorkItem.sub_project), joinedload(WorkItem.participants),
    )


def _status_state_ids(db: Session, legacy_values: Iterable[str]) -> List[UUID]:
    wanted = set(legacy_values)
    return [s.id for s in list_states(db, include_inactive=True)
            if (LEGACY_BY_NAME.get(s.name) or LEGACY_BY_CATEGORY.get(s.category)) in wanted]


def list_items_for_user(
    db: Session, user: CurrentUser, *, start_date=None, end_date=None,
    assignee_user_id=None, assigner_user_id=None, task_status=None, statuses=None,
    status_exclude=None, priority=None, task_type=None, customer_id=None,
    project_id=None, sub_project_id=None, due_from=None, due_to=None,
    completed_from=None, completed_to=None, include_archived: bool = False,
    include_due_in_range: bool = False, archive_state: Optional[str] = None,
    state_id: Optional[UUID] = None, owner_user_id=None, unassigned: Optional[bool] = None,
) -> List[WorkItem]:
    q = _base_query(db)
    state = archive_state or ("all" if include_archived else "active")
    if state == "active":
        q = q.filter(WorkItem.archived_at.is_(None))
    elif state == "archived":
        q = q.filter(WorkItem.archived_at.isnot(None))
    vis = visible_filter(user)
    if vis is not True:
        me = UUID(user.id)
        if assignee_user_id is not None and assignee_user_id != me:
            assignee_user_id = me
        if assigner_user_id is not None and assigner_user_id != me:
            assigner_user_id = me
        q = q.filter(vis)
    if start_date and end_date and include_due_in_range:
        q = q.filter(or_(
            and_(WorkItem.start_date >= start_date, WorkItem.start_date <= end_date),
            and_(WorkItem.due_date.isnot(None), WorkItem.due_date >= start_date,
                 WorkItem.due_date <= end_date),
        ))
    else:
        if start_date:
            q = q.filter(WorkItem.start_date >= start_date)
        if end_date:
            q = q.filter(WorkItem.start_date <= end_date)
    if assignee_user_id:
        q = q.filter(or_(
            WorkItem.owner_user_id == assignee_user_id,
            WorkItem.id.in_(select(WorkItemParticipant.work_item_id).where(
                WorkItemParticipant.user_id == assignee_user_id,
                WorkItemParticipant.role == "assignee",
            )),
        ))
    if assigner_user_id:
        q = q.filter(WorkItem.reporter_user_id == assigner_user_id)
    if owner_user_id:
        q = q.filter(WorkItem.owner_user_id == owner_user_id)
    if unassigned:
        q = q.filter(WorkItem.owner_user_id.is_(None))
    if state_id:
        q = q.filter(WorkItem.state_id == state_id)
    if task_status:
        q = q.filter(WorkItem.state_id.in_(_status_state_ids(db, [task_status])))
    if statuses:
        q = q.filter(WorkItem.state_id.in_(_status_state_ids(db, statuses)))
    if status_exclude:
        q = q.filter(~WorkItem.state_id.in_(_status_state_ids(db, status_exclude)))
    if priority:
        q = q.filter(WorkItem.priority == priority)
    if task_type:
        q = q.filter(WorkItem.item_type == task_type)
    if customer_id:
        q = q.join(Project, Project.id == WorkItem.project_id).filter(Project.customer_id == customer_id)
    if project_id:
        q = q.filter(WorkItem.project_id == project_id)
    if sub_project_id:
        q = q.filter(WorkItem.sub_project_id == sub_project_id)
    if due_from:
        q = q.filter(WorkItem.due_date >= due_from)
    if due_to:
        q = q.filter(WorkItem.due_date <= due_to)
    if completed_from:
        q = q.filter(WorkItem.closed_at >= completed_from)
    if completed_to:
        end_of_day = datetime.combine(completed_to, datetime.max.time(), tzinfo=timezone.utc)
        q = q.filter(WorkItem.closed_at <= end_of_day)
    return q.order_by(WorkItem.start_date.asc().nullslast(), WorkItem.created_at.asc()).all()


def search_items_for_user(
    db: Session, user: CurrentUser, *, q: Optional[str], task_status=None, priority=None,
    task_type=None, customer_id=None, project_id=None, assignee_user_id=None,
    assigner_user_id=None, due_from=None, due_to=None, limit: int = 50,
) -> List[WorkItem]:
    query = _base_query(db).filter(WorkItem.archived_at.is_(None))
    vis = visible_filter(user)
    if vis is not True:
        query = query.filter(vis)
    query = query.join(Project, Project.id == WorkItem.project_id).join(
        Customer, Customer.id == Project.customer_id
    ).outerjoin(TaskSubProject, TaskSubProject.id == WorkItem.sub_project_id)
    if q and q.strip():
        term = f"%{q.strip()}%"
        conds = [WorkItem.title.ilike(term), WorkItem.description.ilike(term),
                 Customer.name.ilike(term), Project.name.ilike(term),
                 TaskSubProject.name.ilike(term), WorkItem.item_key.ilike(term)]
        digits = "".join(ch for ch in q if ch.isdigit())
        if digits:
            conds.append(WorkItem.item_number == int(digits))
            conds.append(WorkItem.legacy_task_number == int(digits))
        query = query.filter(or_(*conds))
    if task_status:
        query = query.filter(WorkItem.state_id.in_(_status_state_ids(db, [task_status])))
    if priority:
        query = query.filter(WorkItem.priority == priority)
    if task_type:
        query = query.filter(WorkItem.item_type == task_type)
    if customer_id:
        query = query.filter(Project.customer_id == customer_id)
    if project_id:
        query = query.filter(WorkItem.project_id == project_id)
    if assignee_user_id:
        query = query.filter(or_(
            WorkItem.owner_user_id == assignee_user_id,
            WorkItem.id.in_(select(WorkItemParticipant.work_item_id).where(
                WorkItemParticipant.user_id == assignee_user_id)),
        ))
    if assigner_user_id:
        query = query.filter(WorkItem.reporter_user_id == assigner_user_id)
    if due_from:
        query = query.filter(WorkItem.due_date >= due_from)
    if due_to:
        query = query.filter(WorkItem.due_date <= due_to)
    return query.order_by(WorkItem.updated_at.desc(), WorkItem.created_at.desc()).limit(limit).all()


# -----------------------------------------------------------------------------
# Olusturma
# -----------------------------------------------------------------------------

def _check_description(description: Optional[str]) -> str:
    description = (description or "").strip()
    if not description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Description is required.")
    return description


def _check_dates(scheduled: Optional[date], due: Optional[date]) -> None:
    if due and scheduled and due < scheduled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date cannot be before the scheduled date.",
        )


def _project_billable_default(db: Session, project_id: UUID) -> bool:
    val = db.query(Project.is_billable_default).filter(Project.id == project_id).scalar()
    return True if val is None else bool(val)


def _new_item(
    db: Session, user: CurrentUser, *, customer_id: UUID, project_id: UUID,
    sub_project_id: Optional[UUID], title: str, description: str, scheduled_date: date,
    due_date: Optional[date], estimated_duration_minutes: Optional[int], priority: str,
    task_type: str, assignees: Sequence[UUID], origin_type: Optional[str] = None,
    origin_ref_id: Optional[UUID] = None,
) -> WorkItem:
    _ensure_customer(db, customer_id)
    _ensure_project(db, project_id, customer_id)
    _ensure_sub_project_for_create(db, sub_project_id, customer_id, project_id)
    _check_dates(scheduled_date, due_date)
    description = _check_description(description)
    number = _next_number(db, user.tenant_id, task_type)
    reporter = UUID(user.id)
    item = WorkItem(
        project_id=project_id, sub_project_id=sub_project_id,
        item_key=code_of(task_type, number), item_number=number, item_type=task_type,
        title=title.strip(), description=description, state_id=default_state(db).id,
        priority=priority, reporter_user_id=reporter,
        owner_user_id=assignees[0] if len(assignees) == 1 else None,
        estimate_minutes=estimated_duration_minutes, start_date=scheduled_date,
        due_date=due_date, is_billable=_project_billable_default(db, project_id),
        origin_type=origin_type, origin_ref_id=origin_ref_id,
    )
    db.add(item)
    db.flush()
    for uid in assignees:
        db.add(WorkItemParticipant(
            work_item_id=item.id, user_id=uid, role="assignee", added_by_user_id=reporter,
        ))
    db.flush()
    db.refresh(item)
    record_event(db, item, actor_user_id=reporter, event_type="task_created", event_data={
        "title": item.title,
        "assignee_user_id": str(assignees[0]) if len(assignees) == 1 else None,
        "assignee_user_ids": [str(u) for u in assignees],
        "scheduled_date": scheduled_date.isoformat() if scheduled_date else None,
        "due_date": due_date.isoformat() if due_date else None,
        "priority": priority,
        "assignment_batch_id": str(item.id) if len(assignees) > 1 else None,
    })
    db.refresh(item)
    return item


def create_item(db: Session, user: CurrentUser, data: TaskCreate) -> WorkItem:
    _validate_assignment(db, user, data.assignee_user_id, perm_scope_for_type(data.task_type))
    return _new_item(
        db, user, customer_id=data.customer_id, project_id=data.project_id,
        sub_project_id=data.sub_project_id, title=data.title, description=data.description,
        scheduled_date=data.scheduled_date, due_date=data.due_date,
        estimated_duration_minutes=data.estimated_duration_minutes,
        priority=data.priority, task_type=data.task_type, assignees=[data.assignee_user_id],
    )


def _eligible_assignees(
    db: Session, user: CurrentUser, *, scope: str, assignee_user_ids: Sequence[UUID],
    assignee_group_ids: Sequence[UUID], group_must_exist: bool,
) -> List[UUID]:
    """create_tasks_bulk / create_tasks_for_group ile AYNI uygunluk kurali."""
    from . import authz_client as _authz
    assigner = UUID(user.id)
    admin = is_task_admin(user)
    warm = {str(u) for u in assignee_user_ids}
    for gid in assignee_group_ids:
        warm.update(str(u) for u in get_active_group_member_ids(db, gid))
    try:
        perm_map = _authz.effective_permissions_many(list(warm), tenant_id=user.tenant_id)
    except _authz.AuthzUnavailable:
        perm_map = {}
    access_code = task_service._RBAC_CODE[(scope, "access")]
    eligible: List[UUID] = []
    seen: set = set()

    def _add(uid: UUID) -> None:
        if uid == assigner or uid in seen:
            return
        if access_code not in perm_map.get(str(uid), frozenset()):
            return
        seen.add(uid)
        eligible.append(uid)

    for uid in assignee_user_ids:
        if not admin and not can_assign_to(db, user, uid, scope):
            continue
        _add(uid)
    for gid in assignee_group_ids:
        group = db.query(UserGroup).filter(UserGroup.id == gid).first()
        if not group or not group.is_active:
            if group_must_exist:
                # Eski grup ucunun sozlesmesi: yok → 404, pasif → 400.
                if not group:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group is inactive and cannot receive new tasks.")
            continue
        if not can_assign_to_group(db, user, gid, scope):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="You are not allowed to assign to this group.")
        for member_id in get_active_group_member_ids(db, gid):
            _add(member_id)
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=("No eligible assignee. Targets need access to this work item "
                    "type enabled, and it is never assigned back to you."),
        )
    return eligible


def create_item_bulk(
    db: Session, user: CurrentUser, *, customer_id: UUID, project_id: UUID,
    sub_project_id: Optional[UUID], assignee_user_ids: Sequence[UUID],
    assignee_group_ids: Sequence[UUID], title: str, description: str, scheduled_date: date,
    due_date: Optional[date], estimated_duration_minutes: Optional[int], priority: str,
    task_type: str = "task", group_must_exist: bool = False,
) -> WorkItem:
    """Eski bulk/group fan-out'un karsiligi: TEK is kalemi + N katilimci."""
    scope = perm_scope_for_type(task_type)
    eligible = _eligible_assignees(
        db, user, scope=scope, assignee_user_ids=assignee_user_ids,
        assignee_group_ids=assignee_group_ids, group_must_exist=group_must_exist,
    )
    return _new_item(
        db, user, customer_id=customer_id, project_id=project_id, sub_project_id=sub_project_id,
        title=title, description=description, scheduled_date=scheduled_date, due_date=due_date,
        estimated_duration_minutes=estimated_duration_minutes, priority=priority,
        task_type=task_type, assignees=eligible,
    )


# -----------------------------------------------------------------------------
# Guncelleme
# -----------------------------------------------------------------------------

def _snapshot(item: WorkItem) -> dict:
    return {
        "title": item.title, "description": item.description, "task_type": item.item_type,
        "assignee_user_id": str(item.owner_user_id) if item.owner_user_id else None,
        "scheduled_date": item.start_date.isoformat() if item.start_date else None,
        "due_date": item.due_date.isoformat() if item.due_date else None,
        "priority": item.priority, "project_id": str(item.project_id),
        "sub_project_id": str(item.sub_project_id) if item.sub_project_id else None,
    }


def update_item(db: Session, user: CurrentUser, ref: UUID, data: TaskUpdate) -> WorkItem:
    item, part = _load(db, ref, user)
    # Yalnizca durum degisiyorsa durum yetkisi yeter (eski PUT ile ayni).
    non_status = {k: v for k, v in data.model_dump(exclude_unset=True).items()
                  if k != "status" and v is not None}
    if non_status and not can_edit_core(user, item):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not allowed to edit this task.")
    before = _snapshot(item)
    customer_now = item.project.customer_id
    new_customer_id = data.customer_id or customer_now
    new_project_id = data.project_id or item.project_id
    if data.clear_sub_project:
        new_sub: Optional[UUID] = None
    elif data.sub_project_id is not None:
        new_sub = data.sub_project_id
    else:
        new_sub = item.sub_project_id
    if (data.customer_id is not None or data.project_id is not None
            or data.sub_project_id is not None or data.clear_sub_project is True):
        _ensure_customer(db, new_customer_id)
        _ensure_project(db, new_project_id, new_customer_id)
        if new_sub is not None:
            sub = db.query(TaskSubProject).filter(TaskSubProject.id == new_sub).first()
            if not sub:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sub project not found.")
            if sub.customer_id != new_customer_id or sub.project_id != new_project_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail="Sub project does not belong to the selected customer/project.")
            if sub.id != item.sub_project_id and not sub.is_active:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail="Sub project is archived and cannot be used for new tasks.")
    if data.assignee_user_id is not None and (
        item.owner_user_id is None or data.assignee_user_id != item.owner_user_id
    ):
        _validate_assignment(db, user, data.assignee_user_id, perm_scope_for_type(item.item_type))
        _reassign(db, item, data.assignee_user_id, actor=UUID(user.id))
    new_scheduled = data.scheduled_date or item.start_date
    new_due = data.due_date if data.due_date is not None else item.due_date
    _check_dates(new_scheduled, new_due)
    if data.project_id is not None:
        item.project_id = data.project_id
    if data.clear_sub_project:
        item.sub_project_id = None
    elif data.sub_project_id is not None:
        item.sub_project_id = data.sub_project_id
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required.")
        item.title = title
    if data.description is not None:
        item.description = _check_description(data.description)
    if data.scheduled_date is not None:
        item.start_date = data.scheduled_date
    if data.due_date is not None:
        item.due_date = data.due_date
    if data.estimated_duration_minutes is not None:
        item.estimate_minutes = data.estimated_duration_minutes
    if data.priority is not None:
        item.priority = data.priority
    if data.task_type is not None and data.task_type != item.item_type:
        new_scope = perm_scope_for_type(data.task_type)
        old_scope = perm_scope_for_type(item.item_type)
        if new_scope != old_scope:
            if not is_task_admin(user) and not task_service.can_assign(db, user, new_scope):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="You are not allowed to assign in the new work item scope.")
            target = data.assignee_user_id or item.owner_user_id
            if target and not user_has_access(db, target, new_scope, tenant_id=user.tenant_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                    detail="Assignee does not have access to the new work item scope.")
        item.item_type = data.task_type
        # Kod tipe baglidir: yeni tipte numara alir, eski kod alias olur.
        old_key = item.item_key
        number = _next_number(db, user.tenant_id, data.task_type)
        item.item_number = number
        item.item_key = code_of(data.task_type, number)
        db.add(WorkItemCodeAlias(code=old_key, work_item_id=item.id))
    notif = None
    if data.status is not None:
        if not can_update_status(user, item):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="You are not allowed to update this task status.")
        notif = apply_status(db, item, user, data.status, participant=part)
    after = _snapshot(item)
    changes = {k: {"from": before[k], "to": after[k]} for k in before if before[k] != after[k]}
    if changes:
        record_event(db, item, actor_user_id=UUID(user.id), event_type="task_updated",
                     event_data={"changes": changes})
    db.flush()
    db.refresh(item)
    item._status_notif = notif
    return item


def _reassign(db: Session, item: WorkItem, new_user_id: UUID, *, actor: UUID) -> None:
    """Tek sorumlu degisir: eski owner'in atanan satiri (yalniz o ise)
    yenisiyle degisir; coklu katilimcida yeni kisi eklenir."""
    parts = assignee_participants(item)
    old_owner = item.owner_user_id
    existing = participant_of(item, new_user_id)
    if existing is None:
        db.add(WorkItemParticipant(
            work_item_id=item.id, user_id=new_user_id, role="assignee", added_by_user_id=actor,
        ))
    if old_owner is not None and len(parts) == 1 and str(parts[0].user_id) == str(old_owner) \
            and str(old_owner) != str(new_user_id):
        db.delete(parts[0])
    item.owner_user_id = new_user_id
    db.flush()
    db.refresh(item)


# -----------------------------------------------------------------------------
# Durum makinesi (katilimci farkinda)
# -----------------------------------------------------------------------------

def apply_status(
    db: Session, item: WorkItem, user: CurrentUser, new_legacy: str, *,
    participant: Optional[WorkItemParticipant] = None, state: Optional[WorkflowState] = None,
) -> Optional[str]:
    """Eski `status` sozcugu (ya da acik `state`) → is kalemi/katilimci.

    Doner: ilk kabul → "accept", ilk tamamlama → "complete", degilse None
    (bildirim seam'i; katilimci basina bir kez).
    """
    now = _now()
    actor = UUID(user.id)
    old_legacy = legacy_status_of(item)
    target = participant or participant_of(item, actor)
    parts = assignee_participants(item)
    notif: Optional[str] = None

    if state is not None and state.category == "cancelled":
        new_legacy = LEGACY_BY_NAME.get(state.name, "cancelled")

    if new_legacy in CANCEL_LIKE:
        item.state = state or state_for_legacy(db, new_legacy)
        item.state_id = item.state.id
        record_event(db, item, actor_user_id=actor,
                     event_type="task_rejected" if new_legacy == "rejected" else "task_status_changed",
                     event_data={"from": old_legacy, "to": new_legacy})
        recompute_closure(db, item, now=now)
        return None

    if new_legacy == "completed":
        if target is not None:
            if target.completed_at is None:
                if target.accepted_at is None:
                    target.accepted_at = now
                target.completed_at = now
                notif = "complete"
        else:
            # Katilimci baglami yok (reporter/admin): is kalemi TAMAMEN tamamlanir.
            for p in parts:
                if p.completed_at is None:
                    p.accepted_at = p.accepted_at or now
                    p.completed_at = now
        derived = _derive_state_from_participants(db, item) if parts else state_for_legacy(db, "completed")
        if not parts:
            derived = state_for_legacy(db, "completed")
        item.state = state if state is not None and state.category == "done" else derived
        item.state_id = item.state.id
        record_event(db, item, actor_user_id=actor, event_type="task_completed",
                     event_data={"from": old_legacy,
                                 "participant_user_id": str(target.user_id) if target else None})
        recompute_closure(db, item, now=now)
        return notif

    # pending / in_progress (ya da acik todo/in_progress durumu)
    if target is not None:
        if new_legacy == "in_progress":
            if target.accepted_at is None:
                target.accepted_at = now
                notif = "accept"
            target.completed_at = None
        else:  # pending
            target.accepted_at = None
            target.completed_at = None
    else:
        for p in parts:
            p.completed_at = None
            if new_legacy == "pending":
                p.accepted_at = None
            elif p.accepted_at is None:
                p.accepted_at = now
    if state is not None and state.category in ("todo", "in_progress"):
        item.state = state
    elif old_legacy in CANCEL_LIKE or not parts:
        item.state = state_for_legacy(db, new_legacy)
    else:
        item.state = _derive_state_from_participants(db, item)
    item.state_id = item.state.id
    new_now = legacy_status_of(item)
    event_type = "task_reopened" if old_legacy in ("completed", "rejected") else "task_status_changed"
    record_event(db, item, actor_user_id=actor, event_type=event_type,
                 event_data={"from": old_legacy, "to": new_now,
                             "participant_user_id": str(target.user_id) if target else None})
    recompute_closure(db, item, now=now)
    return notif


def update_status(db: Session, user: CurrentUser, ref: UUID, *, new_status: Optional[str] = None,
                  state_id: Optional[UUID] = None) -> WorkItem:
    item, part = _load(db, ref, user)
    if not can_update_status(user, item):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not allowed to update this task status.")
    state = state_by_id(db, state_id) if state_id else None
    legacy = new_status or (LEGACY_BY_NAME.get(state.name) or LEGACY_BY_CATEGORY[state.category])
    if legacy == legacy_status_of(item) and state is None and (
        part is None or (legacy != "completed" and legacy != "in_progress")
    ):
        item._status_notif = None
        return item
    notif = apply_status(db, item, user, legacy, participant=part, state=state)
    db.flush()
    db.refresh(item)
    item._status_notif = notif
    return item


def reject(db: Session, user: CurrentUser, ref: UUID) -> WorkItem:
    return update_status(db, user, ref, new_status="rejected")


def set_completed(db: Session, user: CurrentUser, ref: UUID, completed: bool) -> WorkItem:
    item, part = _load(db, ref, user)
    if not can_update_status(user, item):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not allowed to change this task completion state.")
    target = part or participant_of(item, user.id)
    legacy = legacy_status_of(item)
    if completed:
        # Is akisi kapisi: kabul edilmeden (In Progress) tamamlanamaz.
        started = (target.accepted_at is not None or target.completed_at is not None) if target else legacy in ("in_progress", "completed")
        if not started and legacy not in ("in_progress", "completed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task must be accepted (In Progress) before it can be completed.",
            )
        notif = apply_status(db, item, user, "completed", participant=part)
    else:
        notif = None
        if (target is not None and target.completed_at is not None) or legacy == "completed":
            notif = apply_status(db, item, user, "in_progress", participant=part)
    db.flush()
    db.refresh(item)
    item._status_notif = notif
    return item


def update_note(db: Session, user: CurrentUser, ref: UUID, note: Optional[str]) -> WorkItem:
    item, part = _load(db, ref, user)
    target = part or participant_of(item, user.id)
    if target is None or (str(target.user_id) != str(user.id) and not is_task_admin(user)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only the assignee can edit the task note.")
    target.note = note
    db.flush()
    db.refresh(item)
    return item


# -----------------------------------------------------------------------------
# Silme / arsiv / geri alma
# -----------------------------------------------------------------------------

def delete_item(db: Session, user: CurrentUser, ref: UUID) -> None:
    item, _ = _load(db, ref, user)
    if not can_edit_core(user, item):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not allowed to delete this task.")
    if item.archived_at is None:
        item.archived_at = _now()
        item.archive_reason = "manual"
        item.archived_by_user_id = UUID(user.id)
        record_event(db, item, actor_user_id=UUID(user.id), event_type="task_deleted")
        db.flush()


def _require_archive_authority(user: CurrentUser, item: WorkItem) -> None:
    if is_task_admin(user) or str(item.reporter_user_id) == str(user.id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="You are not allowed to archive this work item.")


def archive_item(db: Session, user: CurrentUser, ref: UUID, *, reason: str = "manual") -> dict:
    item, _ = _load(db, ref, user)
    if not can_update_status(user, item):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    _require_archive_authority(user, item)
    if not is_terminal(item):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=("This work item still has active assignments. Only fully "
                    "completed or rejected work items can be archived."),
        )
    recompute_closure(db, item)
    already = item.archived_at is not None
    if not already:
        item.archived_at = _now()
        item.archive_reason = reason
        item.archived_by_user_id = None if reason == "auto_retention" else UUID(user.id)
        record_event(db, item, actor_user_id=UUID(user.id), event_type="task_archived_manual",
                     event_data={"reason": reason})
    db.flush()
    db.refresh(item)
    return {
        "logical_work_item_id": str(item.id),
        "archived_at": item.archived_at,
        "archive_reason": item.archive_reason,
        "assignment_count": len([p for p in assignee_participants(item)
                                 if is_task_admin(user) or str(p.user_id) == str(user.id)
                                 or str(item.reporter_user_id) == str(user.id)]),
    }


def restore_item(db: Session, user: CurrentUser, ref: UUID, *, assignment_ref: UUID,
                 target_status: str) -> dict:
    if target_status not in ("pending", "in_progress"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="target_status must be pending or in_progress.")
    item, _ = _load(db, ref, user)
    if not can_update_status(user, item):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    _require_archive_authority(user, item)
    target_item, target = resolve_ref(db, assignment_ref)
    if target_item is None or target_item.id != item.id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Selected assignment does not belong to this work item.")
    apply_status(db, item, user, target_status, participant=target)
    item.archived_at = None
    item.archive_reason = None
    item.archived_by_user_id = None
    recompute_closure(db, item)
    record_event(db, item, actor_user_id=UUID(user.id), event_type="task_restored",
                 event_data={"reopened_assignment": str(target.id if target else item.id)})
    db.flush()
    db.refresh(item)
    return {
        "logical_work_item_id": str(item.id),
        "reopened_assignment_id": str(target.id if target else item.id),
        "target_status": target_status,
    }


# -----------------------------------------------------------------------------
# Aktivite / yorum
# -----------------------------------------------------------------------------

def list_activity(db: Session, user: CurrentUser, ref: UUID, *, limit: int = 200) -> List[WorkItemEvent]:
    item, _ = _load(db, ref, user)
    return (db.query(WorkItemEvent).filter(WorkItemEvent.work_item_id == item.id)
            .order_by(WorkItemEvent.created_at.desc(), WorkItemEvent.sequence.desc()).limit(limit).all())


def list_comments(db: Session, user: CurrentUser, ref: UUID) -> List[WorkItemComment]:
    item, _ = _load(db, ref, user)
    return (db.query(WorkItemComment)
            .filter(WorkItemComment.work_item_id == item.id, WorkItemComment.deleted_at.is_(None))
            .order_by(WorkItemComment.created_at.asc()).all())


def create_comment(db: Session, user: CurrentUser, ref: UUID, body: str) -> WorkItemComment:
    item, _ = _load(db, ref, user)
    actor = UUID(user.id)
    comment = WorkItemComment(work_item_id=item.id, author_user_id=actor, body=body)
    db.add(comment)
    db.flush()
    record_event(db, item, actor_user_id=actor, event_type="comment_added",
                 event_data={"comment_id": str(comment.id)})
    db.refresh(comment)
    return comment


def _own_comment(db: Session, user: CurrentUser, item: WorkItem, comment_id: UUID) -> WorkItemComment:
    comment = db.query(WorkItemComment).filter(
        WorkItemComment.id == comment_id, WorkItemComment.work_item_id == item.id,
        WorkItemComment.deleted_at.is_(None),
    ).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")
    if str(comment.author_user_id) != str(user.id) and not is_task_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You can only edit your own comments.")
    return comment


def update_comment(db: Session, user: CurrentUser, ref: UUID, comment_id: UUID, body: str) -> WorkItemComment:
    item, _ = _load(db, ref, user)
    comment = _own_comment(db, user, item, comment_id)
    comment.body = body
    comment.updated_at = _now()
    record_event(db, item, actor_user_id=UUID(user.id), event_type="comment_updated",
                 event_data={"comment_id": str(comment.id)})
    db.refresh(comment)
    return comment


def delete_comment(db: Session, user: CurrentUser, ref: UUID, comment_id: UUID) -> None:
    item, _ = _load(db, ref, user)
    comment = _own_comment(db, user, item, comment_id)
    comment.deleted_at = _now()
    record_event(db, item, actor_user_id=UUID(user.id), event_type="comment_deleted",
                 event_data={"comment_id": str(comment.id)})
    db.flush()


def record_log_time_event(db: Session, *, work_item_id: UUID, actor_user_id: UUID,
                          work_log_id, duration_hours: float, date_worked) -> None:
    item = db.get(WorkItem, work_item_id)
    if item is None:
        return
    record_event(db, item, actor_user_id=actor_user_id, event_type="log_time_created", event_data={
        "work_log_id": str(work_log_id), "duration_hours": float(duration_hours),
        "date_worked": date_worked.isoformat() if date_worked else None,
    })
