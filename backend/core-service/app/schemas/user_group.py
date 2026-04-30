# =============================================================================
# HERMES PLATFORM - User Group Schemas (Pydantic)
# =============================================================================
# Generic user grouping. Membership lifecycle and (optional) in-group title
# only — task-specific permissions live in schemas/task.py.
# =============================================================================

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class UserGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class UserGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class UserGroupResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    is_active: bool
    created_by_user_id: Optional[UUID] = None
    member_count: int = 0
    created_at: datetime
    updated_at: datetime
    deactivated_at: Optional[datetime] = None


class UserGroupMemberCreate(BaseModel):
    user_id: UUID
    title: Optional[str] = Field(None, max_length=255)


class UserGroupMemberUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    # Sentinel: client may clear the title back to None.
    clear_title: Optional[bool] = None


class UserGroupMemberResponse(BaseModel):
    id: UUID
    group_id: UUID
    user_id: UUID
    title: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
