# =============================================================================
# HERMES PLATFORM - Task Admin Router
# =============================================================================
# Admin-only endpoints under `/admin/...` for managing the Tasks module:
#   GET  /admin/task-permissions/users      — list permission rows (IDs only)
#   PUT  /admin/task-permissions/users/{user_id}
#   GET  /admin/task-assignment-relations
#   POST /admin/task-assignment-relations
#   DELETE /admin/task-assignment-relations/{relation_id}
#   POST /admin/tasks/sub-projects
#   PUT  /admin/tasks/sub-projects/{sub_project_id}
#   DELETE /admin/tasks/sub-projects/{sub_project_id}
#
# User name/email enrichment is delegated to the frontend (which calls
# auth-service /users/lookup directly).
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.task import (
    NotificationSettingRow,
    NotificationSettingUpdate,
    TaskAssignmentGroupRelationCreate,
    TaskAssignmentGroupRelationResponse,
    TaskAssignmentRelationCreate,
    TaskAssignmentRelationResponse,
    TaskGroupMemberOverrideResponse,
    TaskGroupMemberOverrideUpdate,
    TaskGroupPermissionResponse,
    TaskGroupPermissionUpdate,
    TaskPermissionRow,
    TaskPermissionUpdate,
    TaskSubProjectCreate,
    TaskSubProjectResponse,
    TaskSubProjectUpdate,
)
from ..models.user_group import TaskGroupPermission
from ..services import task_service, user_group_service
from ..routers.tasks import _serialize_sub_project
from shared.auth import CurrentUser, require_admin


router = APIRouter(prefix="/admin", tags=["Task Admin"])


# =============================================================================
# Task Permissions
# =============================================================================

@router.get(
    "/task-permissions/users",
    response_model=List[TaskPermissionRow],
)
async def list_task_permission_rows(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Returns one row per existing permission record (IDs only).

    Frontend fetches the full user list separately from auth-service and
    merges with these rows to render the admin Task Access table. Users
    without a permission row default to false flags client-side.
    """
    perms = task_service.list_task_permissions(db)
    return [
        TaskPermissionRow(
            user_id=p.user_id,
            can_access_tasks=bool(p.can_access_tasks),
            can_assign_tasks=bool(p.can_assign_tasks),
            can_access_issues=bool(p.can_access_issues),
            can_assign_issues=bool(p.can_assign_issues),
            updated_at=p.updated_at,
        )
        for p in perms
    ]


@router.put(
    "/task-permissions/users/{user_id}",
    response_model=TaskPermissionRow,
)
async def update_task_permission(
    user_id: UUID,
    data: TaskPermissionUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    perm = task_service.upsert_task_permission(db, user_id, data)
    return TaskPermissionRow(
        user_id=user_id,
        can_access_tasks=bool(perm.can_access_tasks),
        can_assign_tasks=bool(perm.can_assign_tasks),
        can_access_issues=bool(perm.can_access_issues),
        can_assign_issues=bool(perm.can_assign_issues),
        updated_at=perm.updated_at,
    )


@router.get(
    "/task-permissions/effective",
)
async def list_effective_permissions(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Returns per-user effective permission data used by the
    Individual Overrides tab.

    Frontend merges with the auth-service user list to decide the
    final "effective" badge and source label (admin role, individual
    override, group: <name>, or no access).
    """
    data = task_service.list_effective_perm_data(db)
    return [
        {
            "user_id": uid,
            **payload,
        }
        for uid, payload in data.items()
    ]


# =============================================================================
# Assignment Relations
# =============================================================================

@router.get(
    "/task-assignment-relations",
    response_model=List[TaskAssignmentRelationResponse],
)
async def list_assignment_relations(
    scope: str = Query("task"),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    relations = task_service.list_assignment_relations(db, scope)
    return [
        TaskAssignmentRelationResponse(
            id=r.id,
            assigner_user_id=r.assigner_user_id,
            assignee_user_id=r.assignee_user_id,
            scope=r.scope,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in relations
    ]


@router.post(
    "/task-assignment-relations",
    response_model=List[TaskAssignmentRelationResponse],
    status_code=201,
)
async def create_assignment_relations(
    data: TaskAssignmentRelationCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    relations = task_service.create_assignment_relations(
        db,
        data.assigner_user_id,
        data.assignee_user_ids,
        data.scope,
    )
    return [
        TaskAssignmentRelationResponse(
            id=r.id,
            assigner_user_id=r.assigner_user_id,
            assignee_user_id=r.assignee_user_id,
            scope=r.scope,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in relations
    ]


@router.delete(
    "/task-assignment-relations/{relation_id}",
    status_code=200,
)
async def delete_assignment_relation(
    relation_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task_service.delete_assignment_relation(db, relation_id)
    return {"deleted": True}


# =============================================================================
# Assignment Group Relations (assigner -> group)
# =============================================================================

@router.get(
    "/task-assignment-group-relations",
    response_model=List[TaskAssignmentGroupRelationResponse],
)
async def list_assignment_group_relations(
    scope: str = Query("task"),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    relations = task_service.list_assignment_group_relations(db, scope)
    return [
        TaskAssignmentGroupRelationResponse(
            id=r.id,
            assigner_user_id=r.assigner_user_id,
            assignee_group_id=r.assignee_group_id,
            scope=r.scope,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in relations
    ]


@router.post(
    "/task-assignment-group-relations",
    response_model=TaskAssignmentGroupRelationResponse,
    status_code=201,
)
async def create_assignment_group_relation(
    data: TaskAssignmentGroupRelationCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    relation = task_service.create_assignment_group_relation(
        db, data.assigner_user_id, data.assignee_group_id, data.scope
    )
    return TaskAssignmentGroupRelationResponse(
        id=relation.id,
        assigner_user_id=relation.assigner_user_id,
        assignee_group_id=relation.assignee_group_id,
        scope=relation.scope,
        created_at=relation.created_at,
        updated_at=relation.updated_at,
    )


@router.delete(
    "/task-assignment-group-relations/{relation_id}",
    status_code=200,
)
async def delete_assignment_group_relation(
    relation_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task_service.delete_assignment_group_relation(db, relation_id)
    return {"deleted": True}


# =============================================================================
# Sub Projects (admin write)
# =============================================================================

@router.post(
    "/tasks/sub-projects",
    response_model=TaskSubProjectResponse,
    status_code=201,
)
async def create_sub_project(
    data: TaskSubProjectCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    sub = task_service.create_sub_project(db, data, UUID(admin.id))
    return _serialize_sub_project(sub)


@router.put(
    "/tasks/sub-projects/{sub_project_id}",
    response_model=TaskSubProjectResponse,
)
async def update_sub_project(
    sub_project_id: UUID,
    data: TaskSubProjectUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    sub = task_service.update_sub_project(db, sub_project_id, data)
    return _serialize_sub_project(sub)


@router.delete(
    "/tasks/sub-projects/{sub_project_id}",
    status_code=200,
)
async def delete_sub_project(
    sub_project_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task_service.delete_sub_project(db, sub_project_id)
    return {"deleted": True}



# =============================================================================
# Task Group Permissions  (per UserGroup defaults)
# =============================================================================
# These endpoints set the "task" aspect of a global UserGroup. The group
# itself (name, description, members) is managed under
# /admin/user-groups/... in routers/user_group_admin.py.
# =============================================================================

@router.get(
    "/task-permissions/groups",
    response_model=List[TaskGroupPermissionResponse],
)
async def list_task_group_permissions(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """All task permission rows (sparse — only groups that have been
    configured at least once). Frontend joins with /admin/user-groups
    to render the full matrix.
    """
    rows = db.query(TaskGroupPermission).all()
    return [
        TaskGroupPermissionResponse(
            group_id=r.group_id,
            can_access_tasks_default=bool(r.can_access_tasks_default),
            can_assign_tasks_default=bool(r.can_assign_tasks_default),
            can_access_issues_default=bool(r.can_access_issues_default),
            can_assign_issues_default=bool(r.can_assign_issues_default),
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.put(
    "/task-permissions/groups/{group_id}",
    response_model=TaskGroupPermissionResponse,
)
async def upsert_task_group_permission(
    group_id: UUID,
    data: TaskGroupPermissionUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    perm = user_group_service.upsert_task_group_permission(
        db,
        group_id,
        can_access_tasks_default=data.can_access_tasks_default,
        can_assign_tasks_default=data.can_assign_tasks_default,
        can_access_issues_default=data.can_access_issues_default,
        can_assign_issues_default=data.can_assign_issues_default,
    )
    return TaskGroupPermissionResponse(
        group_id=perm.group_id,
        can_access_tasks_default=bool(perm.can_access_tasks_default),
        can_assign_tasks_default=bool(perm.can_assign_tasks_default),
        can_access_issues_default=bool(perm.can_access_issues_default),
        can_assign_issues_default=bool(perm.can_assign_issues_default),
        updated_at=perm.updated_at,
    )


# =============================================================================
# Task Group Member Overrides  (tri-state per user × group)
# =============================================================================

def _serialize_override(
    *,
    group_id: UUID,
    user_id: UUID,
    override,
    permission,
) -> TaskGroupMemberOverrideResponse:
    access, assign = user_group_service.effective_member_contribution(
        override=override,
        permission=permission,
        scope="task",
    )
    i_access, i_assign = user_group_service.effective_member_contribution(
        override=override,
        permission=permission,
        scope="issue",
    )
    return TaskGroupMemberOverrideResponse(
        group_id=group_id,
        user_id=user_id,
        can_access_tasks_override=(
            override.can_access_tasks_override if override else None
        ),
        can_assign_tasks_override=(
            override.can_assign_tasks_override if override else None
        ),
        can_access_issues_override=(
            override.can_access_issues_override if override else None
        ),
        can_assign_issues_override=(
            override.can_assign_issues_override if override else None
        ),
        effective_access_in_group=access,
        effective_assign_in_group=assign,
        effective_access_issues_in_group=i_access,
        effective_assign_issues_in_group=i_assign,
        updated_at=override.updated_at if override else None,
    )


@router.get(
    "/task-permissions/groups/{group_id}/member-overrides",
    response_model=List[TaskGroupMemberOverrideResponse],
)
async def list_task_group_member_overrides(
    group_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user_group_service.get_user_group(db, group_id)  # 404 if missing
    permission = user_group_service.get_task_group_permission(db, group_id)
    overrides = user_group_service.list_task_group_member_overrides(db, group_id)
    return [
        _serialize_override(
            group_id=group_id,
            user_id=o.user_id,
            override=o,
            permission=permission,
        )
        for o in overrides
    ]


@router.put(
    "/task-permissions/groups/{group_id}/member-overrides/{user_id}",
    response_model=TaskGroupMemberOverrideResponse,
)
async def upsert_task_group_member_override(
    group_id: UUID,
    user_id: UUID,
    data: TaskGroupMemberOverrideUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    override = user_group_service.upsert_task_group_member_override(
        db,
        group_id,
        user_id,
        access_value=data.can_access_tasks_override,
        clear_access=bool(data.clear_access_override),
        assign_value=data.can_assign_tasks_override,
        clear_assign=bool(data.clear_assign_override),
        access_issues_value=data.can_access_issues_override,
        clear_access_issues=bool(data.clear_access_issues_override),
        assign_issues_value=data.can_assign_issues_override,
        clear_assign_issues=bool(data.clear_assign_issues_override),
    )
    permission = user_group_service.get_task_group_permission(db, group_id)
    return _serialize_override(
        group_id=group_id,
        user_id=user_id,
        override=override,
        permission=permission,
    )


# =============================================================================
# Notification Settings  (admin-configurable e-mail rules)
# =============================================================================

@router.get(
    "/notification-settings",
    response_model=List[NotificationSettingRow],
)
async def list_notification_settings(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """One row per work-item type (task / issue / suggestion). Types that
    were never configured come back with the defaults (everything ON)."""
    data = task_service.get_notification_settings(db)
    return [
        NotificationSettingRow(task_type=t, **d) for t, d in data.items()
    ]


@router.put(
    "/notification-settings/{task_type}",
    response_model=NotificationSettingRow,
)
async def update_notification_setting(
    task_type: str,
    data: NotificationSettingUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = task_service.upsert_notification_setting(db, task_type, data)
    return NotificationSettingRow(
        task_type=row.task_type,
        enabled=row.enabled,
        notify_assignment=row.notify_assignment,
        notify_accept=row.notify_accept,
        notify_complete=row.notify_complete,
        priorities=list(row.priorities or []),
        due_date_rule=row.due_date_rule,
        updated_at=row.updated_at,
    )
