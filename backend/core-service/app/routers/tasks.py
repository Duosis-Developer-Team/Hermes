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
#
# User name/email enrichment is delegated to the frontend (which calls
# auth-service /users/lookup directly). Backend returns only IDs.
# =============================================================================

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import (
    APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status,
)
from sqlalchemy.orm import Session

from ..tenant_db import get_tenant_db
from ..models.task import TaskSubProject
from ..schemas.task import (
    TaskActivityEventResponse,
    TaskCommentCreate,
    TaskCommentResponse,
    TaskCommentUpdate,
    TaskCompleteUpdate,
    TaskCreate,
    TaskCreateBulk,
    TaskCreateForGroup,
    TaskGroupCreateResponse,
    TaskNoteUpdate,
    TaskPermissionMeResponse,
    TaskScopePermissions,
    TaskResponse,
    TaskSubProjectCreate,
    TaskSubProjectResponse,
    TaskUpdate,
    TaskRestoreRequest,
)
from ..services import task_service
from ..services import work_item_service as wi
from ..services import work_item_compat as compat
from ..schemas.work_item import (
    WorkflowStateResponse, WorkItemResponse, WorkItemStatusUpdate,
)
from ..services.task_notifications import (
    send_assignment_notifications,
    send_status_notifications,
)
from shared.auth import CurrentUser, get_current_user


def _maybe_status_notify(
    task, serialized, background_tasks, request, db, *, tenant_id
) -> None:
    """If the status change was the FIRST accept/complete (service set the
    transient _status_notif flag), schedule the one-time e-mail to the
    assignee + assigner. No-op otherwise. Honours the admin-configured
    notification rules (type / event / priority / due-date)."""
    event = getattr(task, "_status_notif", None)
    if event in ("accept", "complete"):
        if not task_service.notification_allowed(
            db,
            task_type=serialized.task_type,
            priority=serialized.priority,
            due_date=serialized.due_date,
            event=event,
        ):
            return
        background_tasks.add_task(
            send_status_notifications,
            token=_extract_token(request),
            tenant_id=tenant_id,
            task=_notif_payload(serialized),
            assigner_user_id=str(serialized.assigner_user_id),
            event=event,
        )


def _extract_token(request: Request) -> str:
    """Pull the caller's JWT for the notification's service-to-service
    auth lookup. The frontend authenticates via an `access_token` cookie
    (the Authorization header is usually absent), so check the cookie
    first, then fall back to the bearer header. Returns the RAW token
    (no 'Bearer ' prefix)."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth:
        return auth.replace("Bearer ", "").strip()
    return ""


def _notif_payload(resp) -> dict:
    """Flatten a serialized task into the small, session-free dict the
    e-mail templates consume (dates → DD.MM.YYYY strings)."""

    def _d(value):
        return value.strftime("%d.%m.%Y") if value else None

    return {
        "id": str(resp.id),
        "task_code": resp.task_code,
        "task_type": resp.task_type,
        "title": resp.title,
        "description": resp.description,
        "customer_name": resp.customer_name,
        "project_name": resp.project_name,
        "sub_project_name": resp.sub_project_name,
        "priority": resp.priority,
        "scheduled_date": _d(resp.scheduled_date),
        "due_date": _d(resp.due_date),
        "assignee_user_id": str(resp.assignee_user_id),
        "assigner_user_id": str(resp.assigner_user_id),
    }


router = APIRouter(prefix="/tasks", tags=["Tasks"])


# =============================================================================
# Helpers
# =============================================================================

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


# PM rework P1.2: is kalemi tek nesne; eski TaskResponse sekli compat'tan
# turer (work_item_compat.to_response). Buradaki ad eski cagri noktalari
# icin korunur.
_serialize_task = compat.to_response


# =============================================================================
# Permissions — current user
# =============================================================================

@router.get("/permissions/me", response_model=TaskPermissionMeResponse)
def get_my_task_permissions(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Returns task capability flags + assignable user IDs for the current user.

    The frontend resolves names by calling auth-service /users/lookup directly.
    """
    is_admin = task_service.is_task_admin(current_user)

    # RBAC cutover sozlesme duzeltmesi: backend can_assign_to admin icin
    # hierarchy'yi BYPASS eder; picker listesi de ayni gercegi soylemeli.
    # Onceki surumde admin yalniz kendi mapping'lerini goruyordu — backend
    # izin verdigi halde frontend hedef gostermiyordu (tutarsizlik).
    # Admin icin: tum aktif kullanicilar (S2S dizin) + tum aktif gruplar.
    # Dizin cozulmezse admin, mapping listelerine GERI DUSER (davranis
    # daralir, asla genislemez).
    admin_user_ids: List[UUID] = []
    admin_group_ids: List[UUID] = []
    if is_admin:
        try:
            from ..services import directory_client

            offset = 0
            while offset < 5000:  # emniyet tavani (dizin ucu limit<=100)
                page, has_more = directory_client.list_users_global(
                    tenant_id=current_user.tenant_id,
                    limit=100, offset=offset,
                )
                admin_user_ids.extend(
                    UUID(str(u["id"]))
                    for u in page
                    if str(u.get("id")) != str(current_user.id)
                )
                if not has_more:
                    break
                offset += 100
        except Exception:  # noqa: BLE001 — fail-closed: mapping fallback
            admin_user_ids = []
        from ..models.user_group import UserGroup as _UserGroup

        admin_group_ids = [
            r[0]
            for r in db.query(_UserGroup.id)
            .filter(_UserGroup.is_active.is_(True))
            .all()
        ]

    def _scope(scope: str) -> TaskScopePermissions:
        access = task_service.can_access(db, current_user, scope)
        assign = task_service.can_assign(db, current_user, scope)
        user_ids: List[UUID] = []
        group_ids: List[UUID] = []
        if assign:
            user_ids = task_service.get_assignable_user_ids(
                db, current_user, scope
            )
            group_ids = task_service.get_assignable_group_ids(
                db, current_user, scope
            )
            if is_admin:
                user_ids = admin_user_ids or user_ids
                group_ids = admin_group_ids or group_ids
        return TaskScopePermissions(
            can_access=access,
            can_assign=assign,
            assignable_user_ids=user_ids,
            assignable_group_ids=group_ids,
        )

    task_perms = _scope("task")
    issue_perms = _scope("issue")

    return TaskPermissionMeResponse(
        is_admin=is_admin,
        # Back-compat task-scope top-level fields.
        can_access_tasks=task_perms.can_access,
        can_assign_tasks=task_perms.can_assign,
        assignable_user_ids=task_perms.assignable_user_ids,
        assignable_group_ids=task_perms.assignable_group_ids,
        task=task_perms,
        issue=issue_perms,
    )


# =============================================================================
# Assignable groups (read-only minimal info for task users)
# =============================================================================

@router.get("/assignable-groups")
def list_assignable_groups(
    scope: str = Query("task"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Returns minimal info for groups the current user may target with
    Create-Task-for-Group:
        - admin: every active user_group
        - non-admin assigner: only groups with a direct
          task_assignment_group_relations row.

    Shape: [{ id, name, member_count }]. Used by Create Task modal so
    non-admins can see group names without needing the /admin/user-groups
    endpoint.
    """
    scope = scope if scope in task_service.VALID_SCOPES else "task"
    task_service.require_task_access(db, current_user, scope)

    from ..models.user_group import UserGroup

    # Hierarchy-driven for everyone, admins included: only groups the caller
    # is explicitly mapped to (assigner → group) in this scope.
    if not task_service.can_assign(db, current_user, scope):
        return []
    ids = task_service.get_assignable_group_ids(db, current_user, scope)
    if not ids:
        return []
    groups = (
        db.query(UserGroup)
        .filter(UserGroup.id.in_(ids), UserGroup.is_active.is_(True))
        .order_by(UserGroup.name.asc())
        .all()
    )

    # Compute active member counts in a single grouped query.
    from sqlalchemy import func as _func
    from ..models.user_group import UserGroupMember

    rows = (
        db.query(UserGroupMember.group_id, _func.count(UserGroupMember.id))
        .filter(UserGroupMember.is_active.is_(True))
        .group_by(UserGroupMember.group_id)
        .all()
    )
    counts = {str(gid): int(c) for gid, c in rows}

    return [
        {
            "id": str(g.id),
            "name": g.name,
            "member_count": counts.get(str(g.id), 0),
        }
        for g in groups
    ]


# =============================================================================
# Sub Projects (read-only for task users)
# =============================================================================

@router.get("/sub-projects", response_model=List[TaskSubProjectResponse])
def list_sub_projects(
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    # Sub projects are shared by all work-item types; access in either
    # the task or the issue scope is enough to list them.
    if not (
        task_service.can_access(db, current_user, "task")
        or task_service.can_access(db, current_user, "issue")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tasks module access is required.",
        )
    effective_include_inactive = bool(include_inactive) and task_service.is_task_admin(current_user)
    subs = task_service.list_sub_projects(
        db,
        customer_id=customer_id,
        project_id=project_id,
        include_inactive=effective_include_inactive,
    )
    return [_serialize_sub_project(s) for s in subs]


@router.post(
    "/sub-projects",
    response_model=TaskSubProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sub_project_as_assigner(
    data: TaskSubProjectCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Create a sub project at task-assignment time.

    Mirrors the Create Task permission gate (Task Access + Assign Tasks)
    so a non-admin assigner can add a missing sub project inline from the
    Create Task modal without an admin round-trip. Editing/deleting sub
    projects stays admin-only (admin/tasks/sub-projects)."""
    # Assigner in either scope may add a sub project inline (shared resource).
    if not (
        task_service.can_assign(db, current_user, "task")
        or task_service.can_assign(db, current_user, "issue")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Assignment permission is required.",
        )
    sub = task_service.create_sub_project(db, data, UUID(current_user.id))
    return _serialize_sub_project(sub)


# =============================================================================
# Tasks — list / get / create / update
# =============================================================================

@router.get("/states", response_model=List[WorkflowStateResponse])
def list_workflow_states(
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Kiracinin durum akisi — pano sutunlari ve durum secenekleri buradan
    gelir (A2 kabul olcutu: kiraci durum ekler, pano degisir)."""
    if not (
        task_service.can_access(db, current_user, "task")
        or task_service.can_access(db, current_user, "issue")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tasks module access is required.",
        )
    return [compat.state_response(st) for st in wi.list_states(db, include_inactive=include_inactive)]


@router.get("", response_model=List[WorkItemResponse])
def list_tasks(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    assignee_user_id: Optional[UUID] = Query(None),
    assigner_user_id: Optional[UUID] = Query(None),
    task_status: Optional[str] = Query(None, alias="status"),
    statuses: Optional[List[str]] = Query(None, alias="statuses"),
    status_exclude: Optional[List[str]] = Query(None, alias="status_exclude"),
    priority: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    sub_project_id: Optional[UUID] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    completed_from: Optional[date] = Query(None),
    completed_to: Optional[date] = Query(None),
    include_archived: bool = Query(
        False,
        description=(
            "DEPRECATED — geriye uyumluluk. Yeni istemciler "
            "`archive_state` kullanir."
        ),
    ),
    archive_state: Optional[str] = Query(
        None,
        description="active (varsayilan) | archived | all",
    ),
    include_due_in_range: bool = Query(
        False,
        description=(
            "Calendar opt-in: also return tasks whose due_date "
            "(not just scheduled_date) falls in [start_date, end_date]."
        ),
    ),
    state_id: Optional[UUID] = Query(None, description="workflow_states.id"),
    owner_user_id: Optional[UUID] = Query(None),
    unassigned: Optional[bool] = Query(None, description="owner_user_id IS NULL (triage)"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(
        db, current_user, task_service.perm_scope_for_type(task_type)
    )
    if archive_state is not None and archive_state not in (
        "active", "archived", "all"
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="archive_state must be active, archived or all.",
        )
    effective_include_archived = bool(include_archived) and task_service.is_task_admin(current_user)
    items = wi.list_items_for_user(
        db,
        current_user,
        start_date=start_date,
        end_date=end_date,
        assignee_user_id=assignee_user_id,
        assigner_user_id=assigner_user_id,
        task_status=task_status,
        statuses=statuses,
        status_exclude=status_exclude,
        priority=priority,
        task_type=task_type,
        customer_id=customer_id,
        project_id=project_id,
        sub_project_id=sub_project_id,
        due_from=due_from,
        due_to=due_to,
        completed_from=completed_from,
        completed_to=completed_to,
        include_archived=effective_include_archived,
        include_due_in_range=bool(include_due_in_range),
        archive_state=archive_state,
        state_id=state_id,
        owner_user_id=owner_user_id,
        unassigned=unassigned,
    )
    return [compat.to_response(i) for i in items]


def _notify_assignment(db, background_tasks, request, current_user, rows, *,
                       direct_user_ids, group_names):
    if not rows:
        return
    first = rows[0]
    if task_service.notification_allowed(
        db, task_type=first.task_type, priority=first.priority,
        due_date=first.due_date, event="assignment",
    ):
        background_tasks.add_task(
            send_assignment_notifications,
            token=_extract_token(request),
            tenant_id=current_user.tenant_id,
            tasks=[_notif_payload(r) for r in rows],
            assigner_user_id=str(current_user.id),
            assignment_context={
                "direct_user_ids": direct_user_ids,
                "group_names": group_names,
            },
        )


def _group_names(db, group_ids):
    from ..models.user_group import UserGroup
    if not group_ids:
        return []
    return [
        row[0]
        for row in db.query(UserGroup.name)
        .filter(UserGroup.id.in_(list(group_ids)))
        .order_by(UserGroup.name.asc())
        .all()
    ]


@router.post("", response_model=WorkItemResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    scope = task_service.perm_scope_for_type(payload.task_type)
    task_service.require_task_access(db, current_user, scope)
    task_service.require_task_assigner(db, current_user, scope)
    item = wi.create_item(db, current_user, payload)
    serialized = compat.to_response(item)
    _notify_assignment(
        db, background_tasks, request, current_user, [serialized],
        direct_user_ids=[str(payload.assignee_user_id)], group_names=[],
    )
    return serialized


@router.post(
    "/group",
    response_model=TaskGroupCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_tasks_for_group(
    payload: TaskCreateForGroup,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Grup atamasi: TEK is kalemi + her aktif uye bir katilimci (eskiden
    uye basina satir). Yanit sekli korunur: her katilimci icin bir satir,
    `assignment_batch_id` = is kaleminin id'si."""
    scope = task_service.perm_scope_for_type(payload.task_type)
    task_service.require_task_access(db, current_user, scope)
    task_service.require_task_assigner(db, current_user, scope)
    item = wi.create_item_bulk(
        db, current_user,
        customer_id=payload.customer_id, project_id=payload.project_id,
        sub_project_id=payload.sub_project_id,
        assignee_user_ids=[], assignee_group_ids=[payload.assignee_group_id],
        title=payload.title, description=payload.description,
        scheduled_date=payload.scheduled_date, due_date=payload.due_date,
        estimated_duration_minutes=payload.estimated_duration_minutes,
        priority=payload.priority, task_type=payload.task_type, group_must_exist=True,
    )
    rows = compat.to_rows(item)
    _notify_assignment(
        db, background_tasks, request, current_user, rows,
        direct_user_ids=[], group_names=_group_names(db, [payload.assignee_group_id]),
    )
    return TaskGroupCreateResponse(
        assignment_batch_id=item.id,
        assignee_group_id=payload.assignee_group_id,
        tasks=rows,
    )


@router.post(
    "/bulk",
    response_model=List[WorkItemResponse],
    status_code=status.HTTP_201_CREATED,
)
def create_tasks_bulk(
    payload: TaskCreateBulk,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Coklu atama: TEK is kalemi + N katilimci; yanit katilimci basina
    satir (istemci sayimlari degismez)."""
    scope = task_service.perm_scope_for_type(payload.task_type)
    task_service.require_task_access(db, current_user, scope)
    task_service.require_task_assigner(db, current_user, scope)
    item = wi.create_item_bulk(
        db, current_user,
        customer_id=payload.customer_id, project_id=payload.project_id,
        sub_project_id=payload.sub_project_id,
        assignee_user_ids=payload.assignee_user_ids,
        assignee_group_ids=payload.assignee_group_ids,
        title=payload.title, description=payload.description,
        scheduled_date=payload.scheduled_date, due_date=payload.due_date,
        estimated_duration_minutes=payload.estimated_duration_minutes,
        priority=payload.priority, task_type=payload.task_type,
    )
    rows = compat.to_rows(item)
    _notify_assignment(
        db, background_tasks, request, current_user, rows,
        direct_user_ids=[str(u) for u in payload.assignee_user_ids],
        group_names=_group_names(db, payload.assignee_group_ids),
    )
    return rows


@router.get("/search", response_model=List[WorkItemResponse])
def search_tasks(
    q: Optional[str] = Query(None, description="Free-text search."),
    task_status: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    assignee_user_id: Optional[UUID] = Query(None),
    assigner_user_id: Optional[UUID] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    items = wi.search_items_for_user(
        db, current_user, q=q, task_status=task_status, priority=priority,
        task_type=task_type, customer_id=customer_id, project_id=project_id,
        assignee_user_id=assignee_user_id, assigner_user_id=assigner_user_id,
        due_from=due_from, due_to=due_to, limit=limit,
    )
    return [compat.to_response(i) for i in items]


@router.get("/{task_id}", response_model=WorkItemResponse)
def get_task(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    item = wi.get_item_for_user(db, current_user, task_id)
    return compat.to_response(item)


@router.put("/{task_id}", response_model=WorkItemResponse)
def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    item = wi.update_item(db, current_user, task_id, payload)
    serialized = compat.to_response(item)
    _maybe_status_notify(item, serialized, background_tasks, request, db, tenant_id=current_user.tenant_id)
    return serialized


@router.patch("/{task_id}/note", response_model=WorkItemResponse)
def update_task_note(
    task_id: UUID,
    payload: TaskNoteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    item = wi.update_note(db, current_user, task_id, payload.assignee_note)
    return compat.to_response(item)


@router.patch("/{task_id}/status", response_model=WorkItemResponse)
def update_task_status(
    task_id: UUID,
    payload: WorkItemStatusUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """`status` (eski sozcuk) ya da `state_id` (kiracinin durumu). Yol
    parametresi is kalemi, KATILIMCI ya da eski tasks.id olabilir; katilimci
    verilirse degisiklik o kisinin ilerlemesine yazilir."""
    task_service.require_task_access(db, current_user)
    if payload.status is None and payload.state_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status or state_id is required.",
        )
    item = wi.update_status(
        db, current_user, task_id, new_status=payload.status, state_id=payload.state_id,
    )
    serialized = compat.to_response(item)
    _maybe_status_notify(item, serialized, background_tasks, request, db, tenant_id=current_user.tenant_id)
    return serialized


@router.patch("/{task_id}/complete", response_model=WorkItemResponse)
def complete_task(
    task_id: UUID,
    payload: TaskCompleteUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    item = wi.set_completed(db, current_user, task_id, payload.completed)
    serialized = compat.to_response(item)
    _maybe_status_notify(item, serialized, background_tasks, request, db, tenant_id=current_user.tenant_id)
    return serialized


@router.patch("/{task_id}/reject", response_model=WorkItemResponse)
def reject_task(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Mark a task as rejected (assignee/assigner/admin)."""
    task_service.require_task_access(db, current_user)
    item = wi.reject(db, current_user, task_id)
    return compat.to_response(item)


@router.delete("/{task_id}", status_code=200)
def delete_task(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Soft delete — sets archived_at, the row is preserved."""
    task_service.require_task_access(db, current_user)
    wi.delete_item(db, current_user, task_id)
    return {"deleted": True}


@router.get(
    "/{task_id}/activity",
    response_model=List[TaskActivityEventResponse],
)
def list_task_activity(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Newest-first activity feed for a work item (gorunurluk = is kalemi)."""
    task_service.require_task_access(db, current_user)
    events = wi.list_activity(db, current_user, task_id)
    return [compat.activity_response(e) for e in events]


@router.get(
    "/{task_id}/comments",
    response_model=List[TaskCommentResponse],
)
def list_comments(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    return [compat.comment_response(c) for c in wi.list_comments(db, current_user, task_id)]


@router.post(
    "/{task_id}/comments",
    response_model=TaskCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    task_id: UUID,
    payload: TaskCommentCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    return compat.comment_response(wi.create_comment(db, current_user, task_id, payload.body))


@router.put(
    "/{task_id}/comments/{comment_id}",
    response_model=TaskCommentResponse,
)
def update_comment(
    task_id: UUID,
    comment_id: UUID,
    payload: TaskCommentUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    return compat.comment_response(
        wi.update_comment(db, current_user, task_id, comment_id, payload.body)
    )


@router.delete("/{task_id}/comments/{comment_id}", status_code=200)
def delete_comment(
    task_id: UUID,
    comment_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    task_service.require_task_access(db, current_user)
    wi.delete_comment(db, current_user, task_id, comment_id)
    return {"deleted": True}


@router.post("/{task_id}/archive", status_code=200)
def archive_work_item(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Is kalemini arsivler (kalici silme DEGIL). Kosul: terminal kategori."""
    task_service.require_task_access(db, current_user)
    return wi.archive_item(db, current_user, task_id)


@router.post("/{task_id}/restore", status_code=200)
def restore_work_item(
    task_id: UUID,
    payload: TaskRestoreRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Arsivden cikarir VE secilen katilimciyi (assignment_task_id =
    katilimci id, is kalemi id ya da eski satir id) yeniden acar."""
    task_service.require_task_access(db, current_user)
    return wi.restore_item(
        db, current_user, task_id,
        assignment_ref=payload.assignment_task_id, target_status=payload.target_status,
    )
