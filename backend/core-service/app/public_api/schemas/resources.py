# =============================================================================
# HERMES Public API - Kaynak semalari + serializer'lar (Stage 3A)
# =============================================================================
# STABIL public sozlesme — internal semalardan tamamen ayri. Internal
# alanlar (task_number, type_number, assignment_batch_id, ham event_data,
# silinmis yorum govdeleri, meeting body'si...) BURAYA GIREMEZ.
# =============================================================================

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

# ── Task ────────────────────────────────────────────────────────────────


class PublicRef(BaseModel):
    """Musteri/proje/alt-proje kisa referansi."""

    id: UUID
    name: str


class PublicTask(BaseModel):
    task_code: str
    task_type: str
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    customer: PublicRef
    project: PublicRef
    sub_project: Optional[PublicRef] = None
    assignee_user_id: UUID
    assigner_user_id: UUID
    scheduled_date: date
    due_date: Optional[date] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


_CODE_PREFIX = {"task": "TASK", "issue": "ISSUE", "suggestion": "SUGGESTION"}


def task_code_of(task) -> str:
    number = (
        task.type_number if task.type_number is not None else task.task_number
    )
    return f"{_CODE_PREFIX.get(task.task_type or 'task', 'TASK')}-{number}"


def serialize_task(task) -> PublicTask:
    return PublicTask(
        task_code=task_code_of(task),
        task_type=task.task_type or "task",
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        customer=PublicRef(id=task.customer_id, name=task.customer.name),
        project=PublicRef(id=task.project_id, name=task.project.name),
        sub_project=(
            PublicRef(id=task.sub_project_id, name=task.sub_project.name)
            if task.sub_project_id and task.sub_project
            else None
        ),
        assignee_user_id=task.assignee_user_id,
        assigner_user_id=task.assigner_user_id,
        scheduled_date=task.scheduled_date,
        due_date=task.due_date,
        completed_at=task.completed_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


# ── Activity (sanitize) ─────────────────────────────────────────────────
# Ham event_data ASLA disari verilmez. Yalnizca: event_type, insan-okur
# summary, actor, created_at ve WHITELIST'lenmis changed_fields /
# status_from / status_to alanlari.


class PublicTaskActivity(BaseModel):
    event_type: str
    summary: str
    actor_user_id: Optional[UUID] = None
    created_at: datetime
    changed_fields: Optional[List[str]] = None
    status_from: Optional[str] = None
    status_to: Optional[str] = None


_TYPE_NOUN = {"task": "task", "issue": "issue", "suggestion": "suggestion"}

# task_updated.changes icinden disari verilebilecek alan ADLARI.
_CHANGE_FIELD_WHITELIST = {
    "title",
    "description",
    "priority",
    "status",
    "assignee_user_id",
    "scheduled_date",
    "due_date",
    "sub_project_id",
    "task_type",
    "estimated_duration_minutes",
}
_VALID_STATUSES = {
    "pending",
    "in_progress",
    "completed",
    "cancelled",
    "rejected",
}


def serialize_activity(event, task_type: str) -> PublicTaskActivity:
    noun = _TYPE_NOUN.get(task_type or "task", "task")
    t = event.event_type
    d = event.event_data or {}

    changed_fields = None
    status_from = None
    status_to = None

    if t == "task_created":
        summary = f"created the {noun}"
    elif t == "task_updated":
        changed_fields = sorted(
            k
            for k in (d.get("changes") or {}).keys()
            if k in _CHANGE_FIELD_WHITELIST
        ) or None
        summary = f"updated the {noun}"
        if changed_fields:
            summary += f" ({', '.join(changed_fields)})"
    elif t in ("task_status_changed", "task_reopened"):
        raw_from, raw_to = d.get("from"), d.get("to")
        status_from = raw_from if raw_from in _VALID_STATUSES else None
        status_to = raw_to if raw_to in _VALID_STATUSES else None
        if t == "task_reopened":
            summary = f"reopened the {noun}"
        else:
            summary = (
                f"changed status to {status_to.replace('_', ' ')}"
                if status_to
                else "changed status"
            )
    elif t == "task_completed":
        summary = f"marked the {noun} as completed"
        status_to = "completed"
    elif t == "task_rejected":
        summary = f"rejected the {noun}"
        status_to = "rejected"
    elif t == "comment_added":
        summary = "added a comment"
    elif t == "comment_updated":
        summary = "updated a comment"
    elif t == "comment_deleted":
        summary = "deleted a comment"
    elif t == "log_time_created":
        hours = d.get("duration_hours")
        summary = (
            f"logged {float(hours):.2f} hours"
            if isinstance(hours, (int, float))
            else "logged time"
        )
    else:
        # Gelecekteki bilinmeyen tipler: snake_case'i insanlastir,
        # event_data'dan HICBIR sey tasima.
        summary = (t or "activity").replace("_", " ")

    return PublicTaskActivity(
        event_type=t,
        summary=summary,
        actor_user_id=event.actor_user_id,
        created_at=event.created_at,
        changed_fields=changed_fields,
        status_from=status_from,
        status_to=status_to,
    )


# ── Comments ────────────────────────────────────────────────────────────


class PublicComment(BaseModel):
    id: UUID
    author_user_id: UUID
    body: str
    created_at: datetime
    updated_at: Optional[datetime] = None


def serialize_comment(comment) -> PublicComment:
    return PublicComment(
        id=comment.id,
        author_user_id=comment.author_user_id,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )
