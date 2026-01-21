from datetime import date, datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel

# ==========================================
# Shared Properties
# ==========================================
class ProjectMembershipBase(BaseModel):
    user_id: UUID
    member_role: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: bool = True

class ProjectMembershipCreate(ProjectMembershipBase):
    project_id: UUID

class ProjectMembershipUpdate(BaseModel):
    member_role: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None

# ==========================================
# API Response
# ==========================================
class ProjectMembershipResponse(ProjectMembershipBase):
    id: UUID
    project_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True
