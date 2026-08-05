# =============================================================================
# HERMES PLATFORM - Tasks Module Schemas (Pydantic)
# =============================================================================
# User name/email enrichment is delegated to the frontend (which calls
# auth-service /users/lookup directly). Backend responses carry user IDs,
# never embed names. This avoids cross-service httpx coupling.
# =============================================================================

from datetime import date, datetime
from typing import List, Optional, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


PriorityLiteral = Literal["low", "medium", "high", "urgent"]
StatusLiteral = Literal["pending", "in_progress", "completed", "cancelled", "rejected"]
TaskTypeLiteral = Literal["task", "issue", "suggestion"]
# Permission/assignment scope: issues and suggestions share 'issue'.
ScopeLiteral = Literal["task", "issue"]


# =============================================================================
# Task User Permissions
# =============================================================================

class TaskPermissionUpdate(BaseModel):
    can_access_tasks: bool
    can_assign_tasks: bool
    # Parallel issue/suggestion scope (default off for back-compat clients).
    can_access_issues: bool = False
    can_assign_issues: bool = False


class TaskPermissionRow(BaseModel):
    """Permission row only — frontend joins with user list from auth-service."""
    user_id: UUID
    can_access_tasks: bool = False
    can_assign_tasks: bool = False
    can_access_issues: bool = False
    can_assign_issues: bool = False
    updated_at: Optional[datetime] = None


class TaskScopePermissions(BaseModel):
    """Effective capability for the calling user in one permission scope."""
    can_access: bool = False
    can_assign: bool = False
    # IDs only — frontend resolves names via auth-service /users/lookup.
    assignable_user_ids: List[UUID] = Field(default_factory=list)
    assignable_group_ids: List[UUID] = Field(default_factory=list)


class TaskPermissionMeResponse(BaseModel):
    is_admin: bool
    # Back-compat task-scope fields (kept so old clients keep working).
    can_access_tasks: bool
    can_assign_tasks: bool
    assignable_user_ids: List[UUID] = Field(default_factory=list)
    assignable_group_ids: List[UUID] = Field(default_factory=list)
    # Per-scope capabilities — the frontend picks the active scope.
    task: TaskScopePermissions = Field(default_factory=TaskScopePermissions)
    issue: TaskScopePermissions = Field(default_factory=TaskScopePermissions)


# =============================================================================
# Assignment Relations
# =============================================================================

class TaskAssignmentRelationCreate(BaseModel):
    assigner_user_id: UUID
    assignee_user_ids: List[UUID]
    scope: ScopeLiteral = "task"

    @field_validator("assignee_user_ids")
    @classmethod
    def _non_empty_assignee_ids(cls, v: List[UUID]) -> List[UUID]:
        if not v:
            raise ValueError("At least one assignee user ID is required.")
        return v


class TaskAssignmentRelationResponse(BaseModel):
    id: UUID
    assigner_user_id: UUID
    assignee_user_id: UUID
    scope: str = "task"
    created_at: datetime
    updated_at: datetime


# =============================================================================
# Assignment Group Relations (assigner -> group)
# =============================================================================

class TaskAssignmentGroupRelationCreate(BaseModel):
    assigner_user_id: UUID
    assignee_group_id: UUID
    scope: ScopeLiteral = "task"


class TaskAssignmentGroupRelationResponse(BaseModel):
    id: UUID
    assigner_user_id: UUID
    assignee_group_id: UUID
    scope: str = "task"
    created_at: datetime
    updated_at: datetime


# =============================================================================
# Task Sub Projects
# =============================================================================

class TaskSubProjectCreate(BaseModel):
    customer_id: UUID
    project_id: UUID
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class TaskSubProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class TaskSubProjectResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: Optional[str] = None
    project_id: UUID
    project_name: Optional[str] = None
    name: str
    description: Optional[str] = None
    is_active: bool
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Tasks
# =============================================================================

class TaskCreate(BaseModel):
    customer_id: UUID
    project_id: UUID
    sub_project_id: Optional[UUID] = None  # Optional — task can be created directly under project.
    assignee_user_id: UUID
    title: str = Field(..., min_length=1, max_length=255)
    # Description is now required: holds the actual task instructions.
    description: str = Field(..., min_length=1)
    scheduled_date: date
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = Field(None, gt=0)
    priority: PriorityLiteral = "medium"
    task_type: TaskTypeLiteral = "task"

    @field_validator("description")
    @classmethod
    def _description_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Description is required.")
        return v


class TaskCreateBulk(BaseModel):
    """Create the same task for multiple assignees at once. Targets may be
    individual users and/or whole groups; the backend expands groups to
    active members, unions everything, dedups, and excludes the assigner.
    All created rows share one assignment_batch_id."""

    customer_id: UUID
    project_id: UUID
    sub_project_id: Optional[UUID] = None
    assignee_user_ids: List[UUID] = Field(default_factory=list)
    assignee_group_ids: List[UUID] = Field(default_factory=list)
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(..., min_length=1)
    scheduled_date: date
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = Field(None, gt=0)
    priority: PriorityLiteral = "medium"
    task_type: TaskTypeLiteral = "task"

    @field_validator("description")
    @classmethod
    def _description_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Description is required.")
        return v

    @model_validator(mode="after")
    def _at_least_one_target(self):
        if not self.assignee_user_ids and not self.assignee_group_ids:
            raise ValueError("At least one assignee user or group is required.")
        return self


class TaskUpdate(BaseModel):
    customer_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    sub_project_id: Optional[UUID] = None
    # Sentinel: client may send `clear_sub_project=true` to explicitly null it.
    clear_sub_project: Optional[bool] = None
    assignee_user_id: Optional[UUID] = None
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = Field(None, gt=0)
    priority: Optional[PriorityLiteral] = None
    status: Optional[StatusLiteral] = None
    task_type: Optional[TaskTypeLiteral] = None


class TaskNoteUpdate(BaseModel):
    assignee_note: Optional[str] = None


class TaskStatusUpdate(BaseModel):
    status: StatusLiteral


class TaskCompleteUpdate(BaseModel):
    completed: bool


# =============================================================================
# Task Group Permissions  (per UserGroup task defaults)
# =============================================================================

class TaskGroupPermissionUpdate(BaseModel):
    can_access_tasks_default: bool
    can_assign_tasks_default: bool
    # Issue scope — None means "leave this scope as-is" (back-compat).
    can_access_issues_default: Optional[bool] = None
    can_assign_issues_default: Optional[bool] = None


class TaskGroupPermissionResponse(BaseModel):
    group_id: UUID
    can_access_tasks_default: bool
    can_assign_tasks_default: bool
    can_access_issues_default: bool = False
    can_assign_issues_default: bool = False
    updated_at: Optional[datetime] = None


# =============================================================================
# Task Group Member Overrides  (tri-state per user × group)
# =============================================================================

class TaskGroupMemberOverrideUpdate(BaseModel):
    """Tri-state semantics:
        - omit a field          → leave it untouched
        - field=True or False   → set explicit override
        - clear_*=True          → null out the override (inherit default)
    """

    can_access_tasks_override: Optional[bool] = None
    clear_access_override: Optional[bool] = None
    can_assign_tasks_override: Optional[bool] = None
    clear_assign_override: Optional[bool] = None
    # Parallel issue-scope override fields (same tri-state semantics).
    can_access_issues_override: Optional[bool] = None
    clear_access_issues_override: Optional[bool] = None
    can_assign_issues_override: Optional[bool] = None
    clear_assign_issues_override: Optional[bool] = None


class TaskGroupMemberOverrideResponse(BaseModel):
    group_id: UUID
    user_id: UUID
    can_access_tasks_override: Optional[bool] = None
    can_assign_tasks_override: Optional[bool] = None
    can_access_issues_override: Optional[bool] = None
    can_assign_issues_override: Optional[bool] = None
    # Group's effective contribution for this member (computed):
    # override if set, else group default — per scope.
    effective_access_in_group: bool
    effective_assign_in_group: bool
    effective_access_issues_in_group: bool = False
    effective_assign_issues_in_group: bool = False
    updated_at: Optional[datetime] = None


# =============================================================================
# Notification Settings  (admin-configurable e-mail rules, per work-item type)
# =============================================================================

DueDateRuleLiteral = Literal["any", "with_due", "without_due"]


class NotificationSettingUpdate(BaseModel):
    enabled: bool = True
    notify_assignment: bool = True
    notify_accept: bool = True
    notify_complete: bool = True
    # Only items whose priority is in this list notify. Empty → no e-mails.
    priorities: List[PriorityLiteral] = Field(
        default_factory=lambda: ["low", "medium", "high", "urgent"]
    )
    due_date_rule: DueDateRuleLiteral = "any"


class NotificationSettingRow(NotificationSettingUpdate):
    task_type: TaskTypeLiteral
    updated_at: Optional[datetime] = None


class TaskCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)

    @field_validator("body")
    @classmethod
    def _body_not_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Comment body is required.")
        if len(v) > 5000:
            raise ValueError("Comment body is too long.")
        return v


class TaskCommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)

    @field_validator("body")
    @classmethod
    def _body_not_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Comment body is required.")
        if len(v) > 5000:
            raise ValueError("Comment body is too long.")
        return v


class TaskCommentResponse(BaseModel):
    id: UUID
    task_id: UUID
    author_user_id: UUID
    body: str
    created_at: datetime
    updated_at: Optional[datetime] = None


class TaskActivityEventResponse(BaseModel):
    id: UUID
    task_id: UUID
    actor_user_id: Optional[UUID] = None
    event_type: str
    event_data: Optional[dict] = None
    created_at: datetime


class TaskResponse(BaseModel):
    id: UUID
    task_number: Optional[int] = None
    task_code: Optional[str] = None
    customer_id: UUID
    customer_name: Optional[str] = None
    project_id: UUID
    project_name: Optional[str] = None
    sub_project_id: Optional[UUID] = None
    sub_project_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    assignee_user_id: UUID
    assigner_user_id: UUID
    scheduled_date: date
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = None
    priority: str
    status: str
    task_type: str = "task"
    assignee_note: Optional[str] = None
    completed_at: Optional[datetime] = None
    completed_by_user_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    assignment_batch_id: Optional[UUID] = None


# =============================================================================
# Group Task Creation (fan out to active group members)
# =============================================================================

class TaskCreateForGroup(BaseModel):
    customer_id: UUID
    project_id: UUID
    sub_project_id: Optional[UUID] = None
    assignee_group_id: UUID
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(..., min_length=1)
    scheduled_date: date
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = Field(None, gt=0)
    priority: PriorityLiteral = "medium"
    task_type: TaskTypeLiteral = "task"

    @field_validator("description")
    @classmethod
    def _description_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Description is required.")
        return v


class TaskGroupCreateResponse(BaseModel):
    """Response for POST /tasks/group — one batch_id, N created tasks."""
    assignment_batch_id: UUID
    assignee_group_id: UUID
    tasks: List[TaskResponse]


class TaskRestoreRequest(BaseModel):
    """Arsivden geri alma: HANGI assignment yeniden acilacak.

    Alan ZORUNLUDUR — sessiz toplu reopen'i yapisal olarak imkansiz
    kilar.
    """

    assignment_task_id: UUID
    target_status: str = "in_progress"


class TaskLifecyclePolicyUpdate(BaseModel):
    """Otomatik arsiv retention politikasi.

    `retention_days=None` → "Never" (otomatik arsiv kapali). Sihirli
    -1 gibi belirsiz deger KULLANILMAZ; yokluk acikca null'dir.
    """

    retention_days: Optional[int] = None
