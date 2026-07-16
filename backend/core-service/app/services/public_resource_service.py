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

from sqlalchemy.orm import Session, joinedload

from ..models.task import Task
from ..models.task_activity import TaskActivityEvent
from ..models.task_comment import TaskComment
from .api_access_service import AccessScope, task_filter

_CODE_RE = re.compile(r"^(TASK|ISSUE|SUGGESTION)-(\d{1,12})$", re.IGNORECASE)
_PREFIX_TO_TYPE = {"TASK": "task", "ISSUE": "issue", "SUGGESTION": "suggestion"}

# Public sort sozlesmesi → kolon eslemesi (bilinmeyen deger router'da 422).
TASK_SORTS = {
    "updated_at": Task.updated_at.asc(),
    "-updated_at": Task.updated_at.desc(),
    "created_at": Task.created_at.asc(),
    "-created_at": Task.created_at.desc(),
    "due_date": Task.due_date.asc().nullslast(),
    "-due_date": Task.due_date.desc().nullslast(),
}


def parse_task_code(code: str):
    """'ISSUE-3' → ('issue', 3); bicimsiz kod → None (router 404)."""
    m = _CODE_RE.match((code or "").strip())
    if not m:
        return None
    return _PREFIX_TO_TYPE[m.group(1).upper()], int(m.group(2))


def _scoped_task_query(db: Session, scope: AccessScope):
    return (
        db.query(Task)
        .options(
            joinedload(Task.customer),
            joinedload(Task.project),
            joinedload(Task.sub_project),
        )
        .filter(Task.archived_at.is_(None))
        .filter(task_filter(scope))
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
) -> List[Task]:
    q = _scoped_task_query(db, scope)
    if status:
        q = q.filter(Task.status == status)
    if priority:
        q = q.filter(Task.priority == priority)
    if task_type:
        q = q.filter(Task.task_type == task_type)
    if customer_id is not None:
        q = q.filter(Task.customer_id == customer_id)
    if project_id is not None:
        q = q.filter(Task.project_id == project_id)
    if assignee_user_id is not None:
        q = q.filter(Task.assignee_user_id == assignee_user_id)
    if due_from is not None:
        q = q.filter(Task.due_date >= due_from)
    if due_to is not None:
        q = q.filter(Task.due_date <= due_to)
    if updated_after is not None:
        q = q.filter(Task.updated_at > updated_after)
    order = TASK_SORTS.get(sort, TASK_SORTS["-updated_at"])
    return q.order_by(order).offset(offset).limit(fetch_limit).all()


def get_task_by_code_scoped(
    db: Session, scope: AccessScope, code: str
) -> Optional[Task]:
    parsed = parse_task_code(code)
    if parsed is None:
        return None
    task_type, number = parsed
    return (
        _scoped_task_query(db, scope)
        .filter(Task.task_type == task_type, Task.type_number == number)
        .first()
    )


def list_activity_scoped(
    db: Session, task: Task, *, limit: int = 200
) -> List[TaskActivityEvent]:
    """Task zaten scope filtresinden gecmis olmalidir (get_task_by_code_
    scoped) — feed gorunurlugu task gorunurlugune esittir."""
    return (
        db.query(TaskActivityEvent)
        .filter(TaskActivityEvent.task_id == task.id)
        .order_by(TaskActivityEvent.created_at.desc())
        .limit(limit)
        .all()
    )


def list_comments_scoped(db: Session, task: Task) -> List[TaskComment]:
    """Silinmis yorumlar ASLA donmez (govde dahil)."""
    return (
        db.query(TaskComment)
        .filter(
            TaskComment.task_id == task.id,
            TaskComment.deleted_at.is_(None),
        )
        .order_by(TaskComment.created_at.asc())
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
            db.query(Task.customer_id, Task.project_id)
            .filter(Task.archived_at.is_(None), task_filter(scope))
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
        parsed = parse_task_code(task_code)
        if parsed is None:
            return []
        t_type, number = parsed
        task_row = (
            db.query(Task.id)
            .filter(Task.task_type == t_type, Task.type_number == number)
            .first()
        )
        if task_row is None:
            return []
        q = q.filter(WorkLog.task_id == task_row.id)
    if meeting_id is not None:
        q = q.filter(WorkLog.meeting_id == meeting_id)
    order = WORK_LOG_SORTS.get(sort, WORK_LOG_SORTS["-date_worked"])
    return q.order_by(order).offset(offset).limit(fetch_limit).all()


def get_work_log_scoped(db: Session, scope: AccessScope, log_id: int):
    return _work_log_query(db, scope).filter(WorkLog.id == log_id).first()


def task_codes_for(db: Session, task_ids) -> dict:
    """{task_id: 'TASK-12'} — work-log yanitlarindaki baglanti kodlari."""
    ids = [t for t in task_ids if t is not None]
    if not ids:
        return {}
    rows = (
        db.query(Task.id, Task.task_type, Task.type_number, Task.task_number)
        .filter(Task.id.in_(ids))
        .all()
    )
    prefix = {"task": "TASK", "issue": "ISSUE", "suggestion": "SUGGESTION"}
    out = {}
    for tid, ttype, tnum, gnum in rows:
        number = tnum if tnum is not None else gnum
        out[tid] = f"{prefix.get(ttype or 'task', 'TASK')}-{number}"
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
