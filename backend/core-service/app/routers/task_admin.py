# =============================================================================
# HERMES PLATFORM - Task Admin Router
# =============================================================================
# Admin-only endpoints under `/admin/...` for managing the Tasks module:
#   GET  /admin/task-permissions/users
#   PUT  /admin/task-permissions/users/{user_id}
#   GET  /admin/task-assignment-relations
#   POST /admin/task-assignment-relations
#   DELETE /admin/task-assignment-relations/{relation_id}
#   POST /admin/tasks/sub-projects
#   PUT  /admin/tasks/sub-projects/{sub_project_id}
#   PATCH /admin/tasks/sub-projects/{sub_project_id}/archive
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.task import TaskAssignmentRelation, TaskUserPermission
from ..schemas.task import (
    TaskAssignmentRelationCreate,
    TaskAssignmentRelationResponse,
    TaskPermissionRow,
    TaskPermissionUpdate,
    TaskSubProjectCreate,
    TaskSubProjectResponse,
    TaskSubProjectUpdate,
    TaskUserInfo,
)
from ..services import task_service
from ..routers.tasks import _extract_request_token, _serialize_sub_project
from shared.auth import CurrentUser, require_admin


router = APIRouter(prefix="/admin", tags=["Task Admin"])


# =============================================================================
# Task Permissions
# =============================================================================

@router.get(
    "/task-permissions/users",
    response_model=List[TaskPermissionRow],
)
async def list_task_permission_users(
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    token = _extract_request_token(request)
    users = await task_service.fetch_users_lookup(token, include_inactive=True)
    info_map = task_service.build_user_info_map(users)

    perms = task_service.list_task_permissions(db)
    perm_map = {str(p.user_id): p for p in perms}

    rows: List[TaskPermissionRow] = []
    for u in users:
        uid = str(u.get("id"))
        perm: TaskUserPermission | None = perm_map.get(uid)
        rows.append(
            TaskPermissionRow(
                user_id=UUID(uid),
                full_name=u.get("full_name"),
                email=u.get("email"),
                role=u.get("role"),
                is_admin=bool(u.get("is_admin")),
                is_active=bool(u.get("is_active", True)),
                can_access_tasks=bool(perm.can_access_tasks) if perm else False,
                can_assign_tasks=bool(perm.can_assign_tasks) if perm else False,
                updated_at=perm.updated_at if perm else None,
            )
        )

    # Also surface any DB rows for users we couldn't look up (defensive).
    for uid, perm in perm_map.items():
        if uid not in info_map:
            rows.append(
                TaskPermissionRow(
                    user_id=UUID(uid),
                    is_admin=False,
                    is_active=False,
                    can_access_tasks=bool(perm.can_access_tasks),
                    can_assign_tasks=bool(perm.can_assign_tasks),
                    updated_at=perm.updated_at,
                )
            )
    return rows


@router.put(
    "/task-permissions/users/{user_id}",
    response_model=TaskPermissionRow,
)
async def update_task_permission(
    user_id: UUID,
    data: TaskPermissionUpdate,
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    perm = task_service.upsert_task_permission(db, user_id, data)
    token = _extract_request_token(request)
    users = await task_service.fetch_users_lookup(token, ids=[user_id])
    info = users[0] if users else {}
    return TaskPermissionRow(
        user_id=user_id,
        full_name=info.get("full_name"),
        email=info.get("email"),
        role=info.get("role"),
        is_admin=bool(info.get("is_admin", False)),
        is_active=bool(info.get("is_active", True)),
        can_access_tasks=perm.can_access_tasks,
        can_assign_tasks=perm.can_assign_tasks,
        updated_at=perm.updated_at,
    )


# =============================================================================
# Assignment Relations
# =============================================================================

def _serialize_relation(
    relation: TaskAssignmentRelation,
    info_map: dict,
) -> TaskAssignmentRelationResponse:
    return TaskAssignmentRelationResponse(
        id=relation.id,
        assigner_user=task_service.to_task_user_info(
            relation.assigner_user_id, info_map
        ),
        assignee_user=task_service.to_task_user_info(
            relation.assignee_user_id, info_map
        ),
        created_at=relation.created_at,
        updated_at=relation.updated_at,
    )


@router.get(
    "/task-assignment-relations",
    response_model=List[TaskAssignmentRelationResponse],
)
async def list_assignment_relations(
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    relations = task_service.list_assignment_relations(db)
    user_ids: set = set()
    for r in relations:
        user_ids.add(r.assigner_user_id)
        user_ids.add(r.assignee_user_id)
    info_map: dict = {}
    if user_ids:
        token = _extract_request_token(request)
        users = await task_service.fetch_users_lookup(
            token, ids=list(user_ids), include_inactive=True
        )
        info_map = task_service.build_user_info_map(users)
    return [_serialize_relation(r, info_map) for r in relations]


@router.post(
    "/task-assignment-relations",
    response_model=List[TaskAssignmentRelationResponse],
    status_code=201,
)
async def create_assignment_relations(
    data: TaskAssignmentRelationCreate,
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    token = _extract_request_token(request)
    users = await task_service.fetch_users_lookup(
        token,
        ids=[data.assigner_user_id, *data.assignee_user_ids],
        include_inactive=True,
    )
    info_map = task_service.build_user_info_map(users)

    assigner_info = info_map.get(str(data.assigner_user_id))
    assigner_is_admin = bool(assigner_info and assigner_info.get("is_admin"))

    relations = task_service.create_assignment_relations(
        db,
        data.assigner_user_id,
        data.assignee_user_ids,
        assigner_is_admin_in_db=assigner_is_admin,
    )
    return [_serialize_relation(r, info_map) for r in relations]


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
