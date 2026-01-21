from datetime import date, datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel

# ==========================================
# Shared Properties
# ==========================================
class IssueBase(BaseModel):
    issue_key: str
    summary: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True

class IssueCreate(IssueBase):
    project_id: UUID

class IssueUpdate(BaseModel):
    issue_key: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    project_id: Optional[UUID] = None

# ==========================================
# API Response
# ==========================================
class IssueResponse(IssueBase):
    id: UUID
    project_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True
