# =============================================================================
# HERMES PLATFORM - Tasks Router (user-facing endpoints)
# =============================================================================
# Implements:
#   GET    /tasks/permissions/me
#   GET    /tasks/sub-projects
#   GET    /tasks
#   POST   /tasks
#   GET    /tasks/{task_id}
#   PUT    /tasks/{task_id}
#   PATCH  /tasks/{task_id}/note
#   PATCH  /tasks/{task_id}/status
#   PATCH  /tasks/{task_id}/complete
# =============================================================================

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.task import Task, TaskSubProject
from ..schemas.task import (
    TaskCompleteUpdate,
    TaskCreate,
    TaskNoteUpdate,
    TaskPermissionMeResponse,
    TaskResponse,
    TaskStatusUpdate,
    TaskSubProjectResponse,
    TaskUpdate,
    TaskUserInfo,
)
from ..services import task_service
from shared.auth import (
    ACCESS_TOKEN_COOKIE_NAME,
    CurrentUser,
    get_current_user,
)


router = APIRouter(prefix="/tasks", tags=["Tasks"])


# =============================================================================
# Helpers
# =============================================================================

def _extract_request_token(request: Request) -> Optional[str]:
    """Read the JWT from cookie or Authorization header to forward to auth-service."""
    cookie_token = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    auth_header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip() or None
    return None


def _serialize_sub_project(sub: TaskSubProject) -> TaskSubProjectResponse:
    return TaskSubProjectResponse(
        id=sub.id,
        customer_id=sub.customer_id,
        customer_name=sub.customer.name if sub.customer else None,
        project_id=sub.project_id,
        project_name=sub.project.name if sub.project else None,
        name=sub.name,
        description=sub.description,
        is_active=sub.is_active,
        created_by_user_id=sub.created_by_user_id,
        created_at=sub.created_at,
        updated_at=sub.updated_at,
        archived_at=sub.archived_at,
    )


def _serialize_task(task: Task, user_info_map: dict) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        customer_id=task.customer_id,
        customer_name=task.customer.name if task.customer else None,
        project_id=task.project_id,
        project_name=task.project.name if task.project else None,
        sub_project_id=task.sub_project_id,
        sub_project_name=task.sub_project.name if task.sub_project else None,
        title=task.title,
        description=task.description,
        assignee_user=task_service.to_task_user_info(
            task.assignee_user_id, user_info_map
        ),
        assigner_user=task_service.to_task_user_info(
            task.assigner_user_id, user_info_map
        ),
        scheduled_date=task.scheduled_date,
        due_date=task.due_date,
        estimated_duration_minutes=task.estimated_duration_minutes,
        priority=task.priority,
        status=task.status,
        assignee_note=task.assignee_note,
        completed_at=task.completed_at,
        completed_by_user=(
            task_service.to_task_user_info(
                task.completed_by_user_id, user_info_map
            )
            if task.completed_by_user_id
            else None
        ),
        created_at=task.created_at,
        updated_at=task.updated_at,
        archived_at=task.archived_at,
    )


# =============================================================================
# Permissions — current user
# =============================================================================

@router.get("/permissions/me", response_model=TaskPermissionMeResponse)
async def get_my_task_permissions(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns task capability flags + assignable users for the current user."""
    is_admin = task_service.is_task_admin(current_user)
    can_access = task_service.can_access_tasks(db, current_user)
    can_assign = task_service.can_assign_tasks(db, current_user)

    assignable_users: List[TaskUserInfo] = []
    if can_assign:
        token = _extract_request_token(request)
        if is_admin:
            users = await task_service.fetch_users_lookup(token)
            assignable_users = [
                TaskUserInfo(
                    id=UUID(u["id"]),
                    full_name=u.get("full_name"),
                    email=u.get("email"),
                    role=u.get("role"),
                    is_admin=u.get("is_admin"),
                    is_active=u.get("is_active"),
                )
                for u in users
                if u.get("is_active") and u.get("id") and u["id"] != current_user.id
            ]
        else:
            ids = task_service.get_assignable_user_ids(db, current_user)
            users = await task_service.fetch_users_lookup(token, ids=ids)
            info_map = task_service.build_user_info_map(users)
            assignable_users = [
                task_service.to_task_user_info(uid, info_map) for uid in ids
            ]

    return TaskPermissionMeResponse(
        can_access_tasks=can_access,
        can_assign_tasks=can_assign,
        is_admin=is_admin,
        assignable_users=assignable_users,
    )


# =============================================================================
# Sub Projects (read-only for task users)
# =============================================================================

@router.get("/sub-projects", response_model=List[TaskSubProjectResponse])
async def list_sub_projects(
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    # Only admins may include inactive sub projects.
    effective_include_inactive = bool(include_inactive) and current_user.is_admin
    subs = task_service.list_sub_projects(
        db,
        customer_id=customer_id,
        project_id=project_id,
        include_inactive=effective_include_inactive,
    )
    return [_serialize_sub_project(s) for s in subs]


# =============================================================================
# Tasks — list / get / create / update
# =============================================================================

@router.get("", response_model=List[TaskResponse])
async def list_tasks(
    request: Request,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    assignee_user_id: Optional[UUID] = Query(None),
    assigner_user_id: Optional[UUID] = Query(None),
    task_status: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    sub_project_id: Optional[UUID] = Query(None),
    include_archived: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    effective_include_archived = bool(include_archived) and current_user.is_admin
    tasks = task_service.list_tasks_for_user(
        db,
        current_user,
        start_date=start_date,
        end_date=end_date,
        assignee_user_id=assignee_user_id,
        assigner_user_id=assigner_user_id,
        task_status=task_status,
        priority=priority,
        customer_id=customer_id,
        project_id=project_id,
        sub_project_id=sub_project_id,
        include_archived=effective_include_archived,
    )

    user_ids: set = set()
    for t in tasks:
        user_ids.add(t.assignee_user_id)
        user_ids.add(t.assigner_user_id)
        if t.completed_by_user_id:
            user_ids.add(t.completed_by_user_id)

    info_map: dict = {}
    if user_ids:
        token = _extract_request_token(request)
        users = await task_service.fetch_users_lookup(token, ids=list(user_ids))
        info_map = task_service.build_user_info_map(users)

    return [_serialize_task(t, info_map) for t in tasks]


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreate,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task_service.require_task_assigner(db, current_user)

    token = _extract_request_token(request)
    lookup_users = await task_service.fetch_users_lookup(
        token, ids=[payload.assignee_user_id]
    )
    lookup_map = task_service.build_user_info_map(lookup_users)
    assignee_info = lookup_map.get(str(payload.assignee_user_id))

    task = task_service.create_task(
        db,
        current_user,
        payload,
        assignee_lookup_info=assignee_info,
    )

    relevant_ids = [task.assignee_user_id, task.assigner_user_id]
    users_full = await task_service.fetch_users_lookup(token, ids=relevant_ids)
    info_map = task_service.build_user_info_map(users_full)
    return _serialize_task(task, info_map)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.get_task_for_user(db, current_user, task_id)
    token = _extract_request_token(request)
    user_ids = [task.assignee_user_id, task.assigner_user_id]
    if task.completed_by_user_id:
        user_ids.append(task.completed_by_user_id)
    users = await task_service.fetch_users_lookup(token, ids=user_ids)
    info_map = task_service.build_user_info_map(users)
    return _serialize_task(task, info_map)


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)

    token = _extract_request_token(request)
    assignee_info = None
    if payload.assignee_user_id is not None:
        lookup_users = await task_service.fetch_users_lookup(
            token, ids=[payload.assignee_user_id]
        )
        lookup_map = task_service.build_user_info_map(lookup_users)
        assignee_info = lookup_map.get(str(payload.assignee_user_id))

    task = task_service.update_task(
        db,
        current_user,
        task_id,
        payload,
        assignee_lookup_info=assignee_info,
    )

    user_ids = [task.assignee_user_id, task.assigner_user_id]
    if task.completed_by_user_id:
        user_ids.append(task.completed_by_user_id)
    users_full = await task_service.fetch_users_lookup(token, ids=user_ids)
    info_map = task_service.build_user_info_map(users_full)
    return _serialize_task(task, info_map)


@router.patch("/{task_id}/note", response_model=TaskResponse)
async def update_task_note(
    task_id: UUID,
    payload: TaskNoteUpdate,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task_note(db, current_user, task_id, payload)

    token = _extract_request_token(request)
    user_ids = [task.assignee_user_id, task.assigner_user_id]
    if task.completed_by_user_id:
        user_ids.append(task.completed_by_user_id)
    users_full = await task_service.fetch_users_lookup(token, ids=user_ids)
    info_map = task_service.build_user_info_map(users_full)
    return _serialize_task(task, info_map)


@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(
    task_id: UUID,
    payload: TaskStatusUpdate,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task_status(db, current_user, task_id, payload.status)

    token = _extract_request_token(request)
    user_ids = [task.assignee_user_id, task.assigner_user_id]
    if task.completed_by_user_id:
        user_ids.append(task.completed_by_user_id)
    users_full = await task_service.fetch_users_lookup(token, ids=user_ids)
    info_map = task_service.build_user_info_map(users_full)
    return _serialize_task(task, info_map)


@router.patch("/{task_id}/complete", response_model=TaskResponse)
async def complete_task(
    task_id: UUID,
    payload: TaskCompleteUpdate,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task_completion(
        db, current_user, task_id, payload.completed
    )

    token = _extract_request_token(request)
    user_ids = [task.assignee_user_id, task.assigner_user_id]
    if task.completed_by_user_id:
        user_ids.append(task.completed_by_user_id)
    users_full = await task_service.fetch_users_lookup(token, ids=user_ids)
    info_map = task_service.build_user_info_map(users_full)
    return _serialize_task(task, info_map)
