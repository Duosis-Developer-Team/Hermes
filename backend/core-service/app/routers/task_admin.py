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
#   PATCH /admin/tasks/sub-projects/{sub_project_id}/archive
#
# User name/email enrichment is delegated to the frontend (which calls
# auth-service /users/lookup directly).
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.task import (
    TaskAssignmentRelationCreate,
    TaskAssignmentRelationResponse,
    TaskPermissionRow,
    TaskPermissionUpdate,
    TaskSubProjectCreate,
    TaskSubProjectResponse,
    TaskSubProjectUpdate,
)
from ..services import task_service
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
        updated_at=perm.updated_at,
    )


# =============================================================================
# Assignment Relations
# =============================================================================

@router.get(
    "/task-assignment-relations",
    response_model=List[TaskAssignmentRelationResponse],
)
async def list_assignment_relations(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    relations = task_service.list_assignment_relations(db)
    return [
        TaskAssignmentRelationResponse(
            id=r.id,
            assigner_user_id=r.assigner_user_id,
            assignee_user_id=r.assignee_user_id,
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
    )
    return [
        TaskAssignmentRelationResponse(
            id=r.id,
            assigner_user_id=r.assigner_user_id,
            assignee_user_id=r.assignee_user_id,
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


@router.patch(
    "/tasks/sub-projects/{sub_project_id}/archive",
    response_model=TaskSubProjectResponse,
)
async def archive_sub_project(
    sub_project_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    sub = task_service.archive_sub_project(db, sub_project_id)
    return _serialize_sub_project(sub)
