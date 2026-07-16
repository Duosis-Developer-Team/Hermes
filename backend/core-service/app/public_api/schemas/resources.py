# =============================================================================
# HERMES Public API - Kaynak semalari + serializer'lar (Stage 3A)
# =============================================================================
# STABIL public sozlesme — internal semalardan tamamen ayri. Internal
# alanlar (task_number, type_number, assignment_batch_id, ham event_data,
# silinmis yorum govdeleri, meeting body'si...) BURAYA GIREMEZ.
# =============================================================================

from datetime import date, datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

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


# ── Customers / Projects (Stage 3B) ─────────────────────────────────────


class PublicCustomer(BaseModel):
    id: UUID
    name: str
    is_active: bool


class PublicProject(BaseModel):
    id: UUID
    customer_id: UUID
    name: str
    is_active: bool


def serialize_customer(c) -> PublicCustomer:
    return PublicCustomer(id=c.id, name=c.name, is_active=c.is_active)


def serialize_project(p) -> PublicProject:
    return PublicProject(
        id=p.id, customer_id=p.customer_id, name=p.name, is_active=p.is_active
    )


# ── Work logs (Stage 3B) ────────────────────────────────────────────────
# Public kimlik: numerik id (WorkLog PK BigInteger'dir — stabil ve sirali;
# dokumantasyonda acikca belirtilir). Internal-only alanlar (billable
# tutarlari, is tipi/platform/hat detaylari) DISARI VERILMEZ.


class PublicWorkLog(BaseModel):
    id: int
    user_id: UUID
    date_worked: date
    duration_hours: float
    description: Optional[str] = None
    customer: PublicRef
    project: PublicRef
    task_code: Optional[str] = None
    meeting_id: Optional[UUID] = None
    created_at: datetime


def serialize_work_log(log, task_code: Optional[str]) -> PublicWorkLog:
    return PublicWorkLog(
        id=log.id,
        user_id=log.user_id,
        date_worked=log.date_worked,
        duration_hours=float(log.duration_hours),
        description=log.description,
        customer=PublicRef(id=log.customer_id, name=log.customer.name),
        project=PublicRef(id=log.project_id, name=log.project.name),
        task_code=task_code,
        meeting_id=log.meeting_id,
        created_at=log.created_at,
    )


# ── Meetings (Stage 3B) ─────────────────────────────────────────────────
# Icerik minimizasyonu: body_preview / govde alanlari public semada YOK.
# Private/confidential toplantilar zaten YAZIM aninda maskelenir (subject
# = "Private Meeting", body silinir); is_private bayragi tuketicilere
# durumu acikca soyler. join_url yalnizca gorunurluk kapisini gecen
# token'lara doner (liste/detay zaten scope-filtreli). Katilimci
# detaylari v1'de YOK (ayri onayli sema gerektirir).


class PublicMeetingOrganizer(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class PublicMeeting(BaseModel):
    id: UUID
    subject: str
    is_private: bool
    organizer: PublicMeetingOrganizer
    start_datetime: datetime
    end_datetime: datetime
    timezone: Optional[str] = None
    duration_minutes: Optional[int] = None
    is_online_meeting: bool
    join_url: Optional[str] = None
    is_cancelled: bool


_PRIVATE_SENSITIVITIES = {"private", "confidential"}


def serialize_meeting(m) -> PublicMeeting:
    is_private = (m.sensitivity or "normal").lower() in _PRIVATE_SENSITIVITIES
    return PublicMeeting(
        id=m.id,
        subject=m.subject,  # private toplantida yazim aninda maskelenmis
        is_private=is_private,
        organizer=PublicMeetingOrganizer(
            name=m.organizer_name, email=m.organizer_email
        ),
        start_datetime=m.start_datetime,
        end_datetime=m.end_datetime,
        timezone=m.timezone,
        duration_minutes=m.duration_minutes,
        is_online_meeting=bool(m.is_online_meeting),
        join_url=m.join_url,
        is_cancelled=bool(m.is_cancelled),
    )


# ── Write request semalari (Stage 3C — user-bound clients only) ─────────


class PublicTaskCreate(BaseModel):
    model_config = {"extra": "forbid"}

    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(..., min_length=1, max_length=10000)
    customer_id: UUID
    project_id: UUID
    sub_project_id: Optional[UUID] = None
    assignee_user_id: UUID
    scheduled_date: date
    due_date: Optional[date] = None
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    task_type: Literal["task", "issue", "suggestion"] = "task"


class PublicTaskUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, min_length=1, max_length=10000)
    priority: Optional[Literal["low", "medium", "high", "urgent"]] = None
    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    sub_project_id: Optional[UUID] = None
    assignee_user_id: Optional[UUID] = None


class PublicCommentCreate(BaseModel):
    model_config = {"extra": "forbid"}

    body: str = Field(..., min_length=1, max_length=5000)


class PublicStatusAction(BaseModel):
    model_config = {"extra": "forbid"}

    """accept → in_progress; reject → rejected; reopen → completed'dan
    in_progress'e / rejected'dan pending'e (internal gecis kurallari
    aynen uygulanir)."""

    action: Literal["accept", "reject", "reopen"]


class PublicWorkLogCreate(BaseModel):
    """Stage 3D — POST /v1/work-logs govdesi.

    Internal WorkLogCreate ile ayni zorunluluk kurallari (musteri, proje,
    is tipi, tarih, sure). YASAK alanlar semada YOK (extra=forbid ile
    422): user_id/target_user_id (aktor HER ZAMAN bagli kullanicidir),
    internal task UUID'si (yalnizca task_code kabul edilir), billable
    alanlar, onay/arsiv/created_by metadata'si, issue_id/issue_key.

    Baglanti kurali (onayli): task_code VEYA meeting_id — ikisi birden
    422 (internal Log Time akislari da tek kaynaktan baglar)."""

    model_config = {"extra": "forbid"}

    customer_id: UUID
    project_id: UUID
    work_type_id: UUID
    date_worked: date
    duration_hours: float = Field(
        ..., ge=0.25, le=24, examples=[2.5, 4.0, 1.25]
    )
    description: Optional[str] = Field(None, max_length=5000)
    activity_type_id: Optional[UUID] = None
    platform_id: Optional[UUID] = None
    work_line_id: Optional[UUID] = None
    task_code: Optional[str] = Field(
        None, max_length=32, examples=["TASK-1", "ISSUE-7"]
    )
    meeting_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _single_link(self):
        if self.task_code is not None and self.meeting_id is not None:
            raise ValueError(
                "Provide task_code or meeting_id, not both."
            )
        return self
