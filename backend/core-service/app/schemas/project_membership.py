from datetime import date, datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict

# PM rework P2.1 (B2) — rol standardi (08 §2.6): lead | member | viewer.
MemberRoleLiteral = Literal["lead", "member", "viewer"]

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


# ==========================================
# Proje kapsamli uyelik (PM rework P2.1 / B2)
# ==========================================
class ProjectMemberCreate(BaseModel):
    user_id: UUID
    member_role: MemberRoleLiteral = "member"


class ProjectMemberUpdate(BaseModel):
    member_role: Optional[MemberRoleLiteral] = None
    is_active: Optional[bool] = None


class ProjectMembersResponse(BaseModel):
    """Uyeler + cagiranin yetkisi: UI dugmelerini sunucu kararina baglar."""
    project_id: UUID
    can_manage: bool
    can_assign_lead: bool
    items: List[ProjectMembershipResponse]

    model_config = ConfigDict(from_attributes=True)
