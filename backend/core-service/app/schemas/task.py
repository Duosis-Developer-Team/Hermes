# =============================================================================
# HERMES PLATFORM - Tasks Module Schemas (Pydantic)
# =============================================================================

from datetime import date, datetime
from typing import List, Optional, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


PriorityLiteral = Literal["low", "medium", "high", "urgent"]
StatusLiteral = Literal["pending", "in_progress", "completed", "cancelled"]


# =============================================================================
# Minimal user info embedded in task / permission responses
# =============================================================================

class TaskUserInfo(BaseModel):
    id: UUID
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None


# =============================================================================
# Task User Permissions
# =============================================================================

class TaskPermissionUpdate(BaseModel):
    can_access_tasks: bool
    can_assign_tasks: bool


class TaskPermissionRow(BaseModel):
    user_id: UUID
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_admin: bool = False
    is_active: bool = True
    can_access_tasks: bool = False
    can_assign_tasks: bool = False
    updated_at: Optional[datetime] = None


class TaskPermissionMeResponse(BaseModel):
    can_access_tasks: bool
    can_assign_tasks: bool
    is_admin: bool
    assignable_users: List[TaskUserInfo] = Field(default_factory=list)


# =============================================================================
# Assignment Relations
# =============================================================================

class TaskAssignmentRelationCreate(BaseModel):
    assigner_user_id: UUID
    assignee_user_ids: List[UUID]

    @field_validator("assignee_user_ids")
    @classmethod
    def _non_empty_assignee_ids(cls, v: List[UUID]) -> List[UUID]:
        if not v:
            raise ValueError("At least one assignee user ID is required.")
        return v


class TaskAssignmentRelationResponse(BaseModel):
    id: UUID
    assigner_user: TaskUserInfo
    assignee_user: TaskUserInfo
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
    sub_project_id: UUID
    assignee_user_id: UUID
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    scheduled_date: date
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = Field(None, gt=0)
    priority: PriorityLiteral = "medium"


class TaskUpdate(BaseModel):
    customer_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    sub_project_id: Optional[UUID] = None
    assignee_user_id: Optional[UUID] = None
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    scheduled_date: Optional[date] = None
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = Field(None, gt=0)
    priority: Optional[PriorityLiteral] = None
    status: Optional[StatusLiteral] = None


class TaskNoteUpdate(BaseModel):
    assignee_note: Optional[str] = None


class TaskStatusUpdate(BaseModel):
    status: StatusLiteral


class TaskCompleteUpdate(BaseModel):
    completed: bool


class TaskResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: Optional[str] = None
    project_id: UUID
    project_name: Optional[str] = None
    sub_project_id: UUID
    sub_project_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    assignee_user: TaskUserInfo
    assigner_user: TaskUserInfo
    scheduled_date: date
    due_date: Optional[date] = None
    estimated_duration_minutes: Optional[int] = None
    priority: str
    status: str
    assignee_note: Optional[str] = None
    completed_at: Optional[datetime] = None
    completed_by_user: Optional[TaskUserInfo] = None
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
