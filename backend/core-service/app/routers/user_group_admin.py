# =============================================================================
# HERMES PLATFORM - User Group Admin Router
# =============================================================================
# Admin-only endpoints for the global user-group system. Generic group +
# membership CRUD lives here. Task-specific permission state lives under
# /admin/task-permissions/... in routers/task_admin.py.
#
#   GET    /admin/user-groups
#   POST   /admin/user-groups
#   PUT    /admin/user-groups/{group_id}
#   DELETE /admin/user-groups/{group_id}                  — soft deactivate
#   GET    /admin/user-groups/{group_id}/members
#   POST   /admin/user-groups/{group_id}/members
#   PUT    /admin/user-groups/{group_id}/members/{member_id}
#   DELETE /admin/user-groups/{group_id}/members/{member_id}
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..tenant_db import get_tenant_db
from ..schemas.user_group import (
    UserGroupCreate,
    UserGroupMemberCreate,
    UserGroupMemberResponse,
    UserGroupMemberUpdate,
    UserGroupResponse,
    UserGroupUpdate,
)
from ..services import user_group_service
from shared.auth import CurrentUser
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm


router = APIRouter(prefix="/admin", tags=["User Group Admin"])


def _serialize_group(group, member_count: int = 0) -> UserGroupResponse:
    return UserGroupResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        is_active=bool(group.is_active),
        created_by_user_id=group.created_by_user_id,
        member_count=member_count,
        created_at=group.created_at,
        updated_at=group.updated_at,
        deactivated_at=group.deactivated_at,
    )


def _serialize_member(member) -> UserGroupMemberResponse:
    return UserGroupMemberResponse(
        id=member.id,
        group_id=member.group_id,
        user_id=member.user_id,
        title=member.title,
        is_active=bool(member.is_active),
        created_at=member.created_at,
        updated_at=member.updated_at,
    )


# =============================================================================
# Groups
# =============================================================================

@router.get(
    "/user-groups",
    response_model=List[UserGroupResponse],
)
def list_user_groups(
    include_inactive: bool = Query(False),
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    groups = user_group_service.list_user_groups(
        db, include_inactive=include_inactive
    )
    counts = user_group_service.get_member_count_map(db)
    return [
        _serialize_group(g, member_count=counts.get(str(g.id), 0))
        for g in groups
    ]


@router.post(
    "/user-groups",
    response_model=UserGroupResponse,
    status_code=201,
)
def create_user_group(
    data: UserGroupCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    group = user_group_service.create_user_group(
        db, data, created_by_user_id=UUID(admin.id)
    )
    return _serialize_group(group, member_count=0)


@router.put(
    "/user-groups/{group_id}",
    response_model=UserGroupResponse,
)
def update_user_group(
    group_id: UUID,
    data: UserGroupUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    group = user_group_service.update_user_group(db, group_id, data)
    counts = user_group_service.get_member_count_map(db)
    return _serialize_group(group, member_count=counts.get(str(group.id), 0))


@router.delete(
    "/user-groups/{group_id}",
    response_model=UserGroupResponse,
)
def deactivate_user_group(
    group_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Soft delete — sets is_active=false + deactivated_at. Group rows
    and their memberships are preserved for rollback safety.
    """
    group = user_group_service.deactivate_user_group(db, group_id)
    counts = user_group_service.get_member_count_map(db)
    return _serialize_group(group, member_count=counts.get(str(group.id), 0))


# =============================================================================
# Members
# =============================================================================

@router.get(
    "/user-groups/{group_id}/members",
    response_model=List[UserGroupMemberResponse],
)
def list_group_members(
    group_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    members = user_group_service.list_group_members(db, group_id)
    return [_serialize_member(m) for m in members]


@router.post(
    "/user-groups/{group_id}/members",
    response_model=UserGroupMemberResponse,
    status_code=201,
)
def add_group_member(
    group_id: UUID,
    data: UserGroupMemberCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    member = user_group_service.add_group_member(db, group_id, data)
    return _serialize_member(member)


@router.put(
    "/user-groups/{group_id}/members/{member_id}",
    response_model=UserGroupMemberResponse,
)
def update_group_member(
    group_id: UUID,
    member_id: UUID,
    data: UserGroupMemberUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    member = user_group_service.update_group_member(db, group_id, member_id, data)
    return _serialize_member(member)


@router.delete(
    "/user-groups/{group_id}/members/{member_id}",
    status_code=200,
)
def remove_group_member(
    group_id: UUID,
    member_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.GROUPS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Removes group membership only. Does not touch the user account or
    any business data (tasks, work logs, etc.). Any task override for
    this user × group is also cleared (it would otherwise be orphaned).
    """
    user_group_service.remove_group_member(db, group_id, member_id)
    return {"deleted": True}
