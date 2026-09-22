# =============================================================================
# HERMES - Public API kaynak servisi (Stage 3A)
# =============================================================================
# Public router'lar DB'ye DOGRUDAN inmez; bu katman mevcut modelleri +
# api_access_service filtrelerini birlestirir. Tum okuma yollari
# AccessScope ile SINIRLIDIR (fail-closed) — binding yoksa veri yok.
#
# Kimlik: public task kimligi task_code'dur (TASK-12 / ISSUE-3 /
# SUGGESTION-7). Kapsam disi detay = None → router 404 doner; gercekten
# olmayan koddan AYIRT EDILEMEZ (varlik ifsasi yok).
# =============================================================================

import re
from typing import List, Optional

from sqlalchemy import or_, select as sa_select
from sqlalchemy.orm import Session, joinedload

from ..models.project import Project
from ..models.work_item import (
    WorkItem, WorkItemCodeAlias, WorkItemComment, WorkItemEvent, WorkItemParticipant,
)
from .api_access_service import AccessScope, work_item_filter

# PM rework P1.2: public task kimligi hala task_code (TASK-12); artik
# work_items.item_key ya da alias (batch birlesince kaybolan kodlar, A9).
_CODE_RE = re.compile(r"^(TASK|ISSUE|SUGGESTION)-(\d{1,12})$", re.IGNORECASE)

# Public sort sozlesmesi → kolon eslemesi (bilinmeyen deger router'da 422).
TASK_SORTS = {
    "updated_at": WorkItem.updated_at.asc(),
    "-updated_at": WorkItem.updated_at.desc(),
    "created_at": WorkItem.created_at.asc(),
    "-created_at": WorkItem.created_at.desc(),
    "due_date": WorkItem.due_date.asc().nullslast(),
    "-due_date": WorkItem.due_date.desc().nullslast(),
}


def parse_task_code(code: str):
    """'ISSUE-3' → 'ISSUE-3' (normalize); bicimsiz kod → None (router 404)."""
    m = _CODE_RE.match((code or "").strip())
    if not m:
        return None
    return f"{m.group(1).upper()}-{int(m.group(2))}"


def _scoped_task_query(db: Session, scope: AccessScope):
    return (
        db.query(WorkItem)
        .options(
            joinedload(WorkItem.state),
            joinedload(WorkItem.project).joinedload(Project.customer),
            joinedload(WorkItem.sub_project),
            joinedload(WorkItem.participants),
        )
        .filter(WorkItem.archived_at.is_(None))
        .filter(work_item_filter(scope))
    )


def list_tasks_scoped(
    db: Session,
    scope: AccessScope,
    *,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    task_type: Optional[str] = None,
    customer_id=None,
    project_id=None,
    assignee_user_id=None,
    due_from=None,
    due_to=None,
    updated_after=None,
    sort: str = "-updated_at",
    fetch_limit: int = 26,
    offset: int = 0,
) -> List[WorkItem]:
    from .work_item_service import _status_state_ids

    q = _scoped_task_query(db, scope)
    if status:
        q = q.filter(WorkItem.state_id.in_(_status_state_ids(db, [status])))
    if priority:
        q = q.filter(WorkItem.priority == priority)
    if task_type:
        q = q.filter(WorkItem.item_type == task_type)
    if customer_id is not None:
        q = q.filter(WorkItem.project_id.in_(
            sa_select(Project.id).where(Project.customer_id == customer_id)
        ))
    if project_id is not None:
        q = q.filter(WorkItem.project_id == project_id)
    if assignee_user_id is not None:
        q = q.filter(or_(
            WorkItem.owner_user_id == assignee_user_id,
            WorkItem.id.in_(sa_select(WorkItemParticipant.work_item_id).where(
                WorkItemParticipant.user_id == assignee_user_id,
                WorkItemParticipant.role == "assignee",
            )),
        ))
    if due_from is not None:
        q = q.filter(WorkItem.due_date >= due_from)
    if due_to is not None:
        q = q.filter(WorkItem.due_date <= due_to)
    if updated_after is not None:
        q = q.filter(WorkItem.updated_at > updated_after)
    order = TASK_SORTS.get(sort, TASK_SORTS["-updated_at"])
    return q.order_by(order).offset(offset).limit(fetch_limit).all()


def _item_id_for_code(db: Session, code: str):
    row = db.query(WorkItem.id).filter(WorkItem.item_key == code).first()
    if row is not None:
        return row[0]
    alias = db.query(WorkItemCodeAlias.work_item_id).filter(
        WorkItemCodeAlias.code == code
    ).first()
    return alias[0] if alias is not None else None


def get_task_by_code_scoped(
    db: Session, scope: AccessScope, code: str
) -> Optional[WorkItem]:
    normalized = parse_task_code(code)
    if normalized is None:
        return None
    item_id = _item_id_for_code(db, normalized)
    if item_id is None:
        return None
    return _scoped_task_query(db, scope).filter(WorkItem.id == item_id).first()


def list_activity_scoped(
    db: Session, task: WorkItem, *, limit: int = 200
) -> List[WorkItemEvent]:
    """Is kalemi zaten scope filtresinden gecmis olmalidir."""
    return (
        db.query(WorkItemEvent)
        .filter(WorkItemEvent.work_item_id == task.id)
        .order_by(WorkItemEvent.created_at.desc(), WorkItemEvent.sequence.desc())
        .limit(limit)
        .all()
    )


def list_comments_scoped(db: Session, task: WorkItem) -> List[WorkItemComment]:
    """Silinmis yorumlar ASLA donmez (govde dahil)."""
    return (
        db.query(WorkItemComment)
        .filter(
            WorkItemComment.work_item_id == task.id,
            WorkItemComment.deleted_at.is_(None),
        )
        .order_by(WorkItemComment.created_at.asc())
        .all()
    )


# =============================================================================
# Stage 3B — Customers / Projects (turetilmis referans gorunurlugu)
# =============================================================================
# Onayli least-privilege kurali:
#   - global → tum AKTIF musteriler/projeler
#   - acik customer/project binding → yalnizca baglananlar (+ proje
#     binding'inin ust musterisi, customer binding'inin projeleri)
#   - user/group binding → YALNIZCA token'in zaten erisebildigi is
#     kayitlarinda (task + work log) gecen musteri/projeler
#   - binding yok → bos (fail closed)
# Referans endpoint'leri sirket envanterini ENUMERE EDEMEZ.

from sqlalchemy import false as sa_false

from ..models.customer import Customer
from ..models.meeting import Meeting
from ..models.project import Project
from ..models.work_log import WorkLog
from .api_access_service import meeting_filter, work_log_filter


def visible_reference_ids(db: Session, scope: AccessScope):
    """Non-global scope icin (customer_ids, project_ids) gorunur kumesi.
    Turetilmis kisim erisilebilir task + work-log kayitlarindan gelir."""
    cust = set(scope.customer_ids)
    proj = set(scope.project_ids)
    if scope.user_ids:
        for c_id, p_id in (
            db.query(Project.customer_id, WorkItem.project_id)
            .join(Project, Project.id == WorkItem.project_id)
            .filter(WorkItem.archived_at.is_(None), work_item_filter(scope))
            .distinct()
        ):
            cust.add(c_id)
            proj.add(p_id)
        for c_id, p_id in (
            db.query(WorkLog.customer_id, WorkLog.project_id)
            .filter(work_log_filter(scope))
            .distinct()
        ):
            cust.add(c_id)
            proj.add(p_id)
    # Acik proje binding'lerinin ust musterileri de gorunur.
    if scope.project_ids:
        for (c_id,) in db.query(Project.customer_id).filter(
            Project.id.in_(list(scope.project_ids))
        ):
            cust.add(c_id)
    return cust, proj


def _customer_query(db: Session, scope: AccessScope):
    q = db.query(Customer).filter(Customer.is_active.is_(True))
    if scope.is_global:
        return q
    cust, _ = visible_reference_ids(db, scope)
    if not cust:
        return q.filter(sa_false())
    return q.filter(Customer.id.in_(list(cust)))


def list_customers_scoped(
    db: Session,
    scope: AccessScope,
    *,
    q_text: Optional[str] = None,
    fetch_limit: int = 26,
    offset: int = 0,
) -> List[Customer]:
    q = _customer_query(db, scope)
    if q_text:
        q = q.filter(Customer.name.ilike(f"%{q_text.strip()}%"))
    return (
        q.order_by(Customer.name.asc()).offset(offset).limit(fetch_limit).all()
    )


def get_customer_scoped(db: Session, scope: AccessScope, customer_id):
    return (
        _customer_query(db, scope)
        .filter(Customer.id == customer_id)
        .first()
    )


def _project_query(db: Session, scope: AccessScope):
    q = db.query(Project).filter(Project.is_active.is_(True))
    if scope.is_global:
        return q
    cust_bound = list(scope.customer_ids)
    _, proj = visible_reference_ids(db, scope)
    conds = []
    if proj:
        conds.append(Project.id.in_(list(proj)))
    if cust_bound:
        # Acik musteri binding'i o musterinin TUM projelerini gorunur kilar.
        conds.append(Project.customer_id.in_(cust_bound))
    if not conds:
        return q.filter(sa_false())
    from sqlalchemy import or_ as sa_or

    return q.filter(sa_or(*conds))


def list_projects_scoped(
    db: Session,
    scope: AccessScope,
    *,
    customer_id=None,
    q_text: Optional[str] = None,
    fetch_limit: int = 26,
    offset: int = 0,
) -> List[Project]:
    q = _project_query(db, scope)
    if customer_id is not None:
        q = q.filter(Project.customer_id == customer_id)
    if q_text:
        q = q.filter(Project.name.ilike(f"%{q_text.strip()}%"))
    return (
        q.order_by(Project.name.asc()).offset(offset).limit(fetch_limit).all()
    )


def get_project_scoped(db: Session, scope: AccessScope, project_id):
    return (
        _project_query(db, scope).filter(Project.id == project_id).first()
    )


# =============================================================================
# Stage 3B — Work logs
# =============================================================================

WORK_LOG_SORTS = {
    "date_worked": WorkLog.date_worked.asc(),
    "-date_worked": WorkLog.date_worked.desc(),
    "created_at": WorkLog.created_at.asc(),
    "-created_at": WorkLog.created_at.desc(),
}


def _work_log_query(db: Session, scope: AccessScope):
    return (
        db.query(WorkLog)
        .options(joinedload(WorkLog.customer), joinedload(WorkLog.project))
        .filter(work_log_filter(scope))
    )


def list_work_logs_scoped(
    db: Session,
    scope: AccessScope,
    *,
    date_from=None,
    date_to=None,
    customer_id=None,
    project_id=None,
    user_id=None,
    task_code: Optional[str] = None,
    meeting_id=None,
    sort: str = "-date_worked",
    fetch_limit: int = 26,
    offset: int = 0,
) -> List[WorkLog]:
    q = _work_log_query(db, scope)
    if date_from is not None:
        q = q.filter(WorkLog.date_worked >= date_from)
    if date_to is not None:
        q = q.filter(WorkLog.date_worked <= date_to)
    if customer_id is not None:
        q = q.filter(WorkLog.customer_id == customer_id)
    if project_id is not None:
        q = q.filter(WorkLog.project_id == project_id)
    if user_id is not None:
        q = q.filter(WorkLog.user_id == user_id)
    if task_code:
        normalized = parse_task_code(task_code)
        item_id = _item_id_for_code(db, normalized) if normalized else None
        if item_id is None:
            return []
        legacy = db.query(WorkItem.legacy_task_ids).filter(WorkItem.id == item_id).scalar() or []
        q = q.filter(or_(
            WorkLog.work_item_id == item_id,
            WorkLog.task_id.in_(list(legacy)) if legacy else sa_false(),
        ))
    if meeting_id is not None:
        q = q.filter(WorkLog.meeting_id == meeting_id)
    order = WORK_LOG_SORTS.get(sort, WORK_LOG_SORTS["-date_worked"])
    return q.order_by(order).offset(offset).limit(fetch_limit).all()


def get_work_log_scoped(db: Session, scope: AccessScope, log_id: int):
    return _work_log_query(db, scope).filter(WorkLog.id == log_id).first()


def task_codes_for(db: Session, refs) -> dict:
    """{ref: 'TASK-12'} — ref bir work_items.id YA DA eski tasks.id olabilir
    (work_logs.work_item_id / task_id). Her iki anahtar da haritaya girer."""
    ids = [r for r in refs if r is not None]
    if not ids:
        return {}
    out = {}
    rows = (
        db.query(WorkItem.id, WorkItem.item_key, WorkItem.legacy_task_ids)
        .filter(or_(
            WorkItem.id.in_(ids),
            WorkItem.legacy_task_ids.overlap(ids),
        ))
        .all()
    )
    for item_id, key, legacy in rows:
        out[item_id] = key
        for tid in legacy or []:
            out[tid] = key
    return out


# =============================================================================
# Stage 3B — Meetings
# =============================================================================

MEETING_SORTS_KEYS = ("start_datetime", "-start_datetime")


def _meeting_query(db: Session, scope: AccessScope):
    return db.query(Meeting).filter(meeting_filter(scope))


def list_meetings_scoped(
    db: Session,
    scope: AccessScope,
    *,
    start_from=None,
    start_to=None,
    include_cancelled: bool = False,
    sort: str = "-start_datetime",
    fetch_limit: int = 26,
    offset: int = 0,
) -> List[Meeting]:
    q = _meeting_query(db, scope)
    if not include_cancelled:
        q = q.filter(Meeting.is_cancelled.is_(False))
    if start_from is not None:
        q = q.filter(Meeting.start_datetime >= start_from)
    if start_to is not None:
        q = q.filter(Meeting.start_datetime <= start_to)
    order = (
        Meeting.start_datetime.asc()
        if sort == "start_datetime"
        else Meeting.start_datetime.desc()
    )
    return q.order_by(order).offset(offset).limit(fetch_limit).all()


def get_meeting_scoped(db: Session, scope: AccessScope, meeting_id):
    return (
        _meeting_query(db, scope).filter(Meeting.id == meeting_id).first()
    )
