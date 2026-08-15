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
    TaskSubProjectCreate,
    TaskSubProjectResponse,
    TaskSubProjectUpdate,
    TaskLifecyclePolicyUpdate,
)
from ..services import task_service
from ..routers.tasks import _serialize_sub_project
from shared.auth import CurrentUser
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm


router = APIRouter(prefix="/admin", tags=["Task Admin"])


# =============================================================================
# Task Permissions — LEGACY (RBAC cutover, 2026-08-04)
# =============================================================================
# Task access/assign yetkileri artik ROLLERDEN yonetilir (Roles UI +
# auth-service RBAC). Bu uclarin yazdigi tablolar karar kaynagi degildir;
# veri backfill/parity icin YERINDE durur, silinmez. Uclar sessizce
# basarili olup etkisiz kalmasin diye ACIK 410 Gone doner (guard korunur:
# yetkisiz cagiran yine 403/503 alir — route-walk envanteri degismedi).

_LEGACY_GONE = (
    "Task access permissions have moved to Roles (RBAC). "
    "This legacy endpoint is gone; manage roles instead."
)


def _legacy_gone() -> None:
    from fastapi import HTTPException

    raise HTTPException(status_code=410, detail=_LEGACY_GONE)


@router.get("/task-permissions/users")
def list_task_permission_rows(
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


@router.put("/task-permissions/users/{user_id}")
def update_task_permission(
    user_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


@router.get("/task-permissions/effective")
def list_effective_permissions(
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


# =============================================================================
# RBAC backfill — legacy efektif izinleri komponent rollere tasir
# =============================================================================

@router.post("/task-permissions/rbac-backfill")
def rbac_backfill(
    dry_run: bool = Query(True),
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Legacy efektif izinlerin RBAC komponent rollerine backfill'i.

    dry_run=true (varsayilan): yalnizca ozet + anomaliler — parity
    incelemesi icin. dry_run=false: eksik atamalar auth-service'e
    yazilir (idempotent; tekrar kosmak duplicate uretmez, hicbir sey
    silinmez).
    """
    from ..services.rbac_backfill import run

    return run(db, dry_run=dry_run, tenant_id=admin.tenant_id)


# =============================================================================
# Assignment Relations
# =============================================================================

@router.get(
    "/task-assignment-relations",
    response_model=List[TaskAssignmentRelationResponse],
)
def list_assignment_relations(
    scope: str = Query("task"),
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def create_assignment_relations(
    data: TaskAssignmentRelationCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def delete_assignment_relation(
    relation_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def list_assignment_group_relations(
    scope: str = Query("task"),
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def create_assignment_group_relation(
    data: TaskAssignmentGroupRelationCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def delete_assignment_group_relation(
    relation_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def create_sub_project(
    data: TaskSubProjectCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
    db: Session = Depends(get_db),
):
    sub = task_service.create_sub_project(db, data, UUID(admin.id))
    return _serialize_sub_project(sub)


@router.put(
    "/tasks/sub-projects/{sub_project_id}",
    response_model=TaskSubProjectResponse,
)
def update_sub_project(
    sub_project_id: UUID,
    data: TaskSubProjectUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
    db: Session = Depends(get_db),
):
    sub = task_service.update_sub_project(db, sub_project_id, data)
    return _serialize_sub_project(sub)


@router.delete(
    "/tasks/sub-projects/{sub_project_id}",
    status_code=200,
)
def delete_sub_project(
    sub_project_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
    db: Session = Depends(get_db),
):
    task_service.delete_sub_project(db, sub_project_id)
    return {"deleted": True}



# =============================================================================
# Task Group Permissions + Member Overrides — LEGACY (RBAC cutover)
# =============================================================================
# Grup default'lari ve uye override'lari artik yetki KAYNAGI degildir;
# yonetim Roles uzerinden yapilir. Acik 410 (guard korunur).


@router.get("/task-permissions/groups")
def list_task_group_permissions(
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


@router.put("/task-permissions/groups/{group_id}")
def upsert_task_group_permission(
    group_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


@router.get("/task-permissions/groups/{group_id}/member-overrides")
def list_task_group_member_overrides(
    group_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


@router.put("/task-permissions/groups/{group_id}/member-overrides/{user_id}")
def upsert_task_group_member_override(
    group_id: UUID,
    user_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
):
    _legacy_gone()


# =============================================================================
# Notification Settings  (admin-configurable e-mail rules)
# =============================================================================

@router.get(
    "/notification-settings",
    response_model=List[NotificationSettingRow],
)
def list_notification_settings(
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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
def update_notification_setting(
    task_type: str,
    data: NotificationSettingUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
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


# =============================================================================
# Work item lifecycle policy (§9)
# =============================================================================
# Yetki: mevcut PM Configurations yonetim izni (TASK_PERMISSIONS_MANAGE).
# YENI bir hard-coded admin kontrolu OLUSTURULMAZ; merkezi katman
# kullanilir. Frontend gizlemesine GUVENILMEZ — kapi burada.
@router.get("/lifecycle-policy")
def get_lifecycle_policy(
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
    db: Session = Depends(get_db),
):
    from ..services import task_lifecycle

    policy = task_lifecycle.get_policy(db)
    db.commit()
    return {
        "retention_days": policy.retention_days,
        "allowed_values": list(task_lifecycle.ALLOWED_RETENTION_DAYS),
        "updated_at": policy.updated_at,
        "updated_by_user_id": policy.updated_by_user_id,
    }


@router.put("/lifecycle-policy")
def update_lifecycle_policy(
    payload: TaskLifecyclePolicyUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.TASK_PERMISSIONS_MANAGE)),
    db: Session = Depends(get_db),
):
    from fastapi import HTTPException, status as http_status

    from ..services import task_lifecycle

    try:
        policy = task_lifecycle.set_policy(
            db,
            retention_days=payload.retention_days,
            actor_user_id=UUID(admin.id),
        )
    except ValueError:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "retention_days must be one of "
                f"{list(task_lifecycle.ALLOWED_RETENTION_DAYS)} or null "
                "for Never."
            ),
        )
    db.commit()
    return {
        "retention_days": policy.retention_days,
        "updated_at": policy.updated_at,
        "updated_by_user_id": policy.updated_by_user_id,
    }
