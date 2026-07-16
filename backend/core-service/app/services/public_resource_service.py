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
