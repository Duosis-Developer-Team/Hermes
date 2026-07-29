# =============================================================================
# HERMES Auth Service - RBAC yonetim uclari
# =============================================================================
# Mount: {API_PREFIX}/auth altinda → /api/v1/auth/rbac/*
#
# Guard ayrimi (LogiSlot'un en buyuk zaafinin duzeltmesi — orada
# role.manage tanimliydi ama TUM rol CRUD'u user.manage istiyordu, yani
# user.manage fiilen full-admin'di):
#   - Rol CRUD           → roles.manage
#   - Kullanici-rol atama → users.manage
#   - IKISINDE DE subset kurali: aktor sahip olmadigi izni yazamaz/atayamaz.
#   - Rol listesi/katalog → roles.manage VEYA users.manage (atama UI'si
#     rol listesine muhtac).
#   - /rbac/me → herhangi bir gecerli JWT (kendi izinlerini herkes gorur;
#     frontend can() ve reporting-service bunu kullanir).
# =============================================================================

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import (
    ALL_PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    Perm,
)

from ..database import get_db
from ..models.rbac import RbacRole, RbacUserRole
from ..models.user import User
from ..services import rbac_service as svc

router = APIRouter(prefix="/rbac", tags=["RBAC"])


# ── Semalar (router-yerel; internal_directory deseni) ──────────────────


class RoleCreate(BaseModel):
    code: str = Field(..., min_length=3, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    permissions: List[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    permissions: Optional[List[str]] = None
    is_active: Optional[bool] = None


class UserRolesPut(BaseModel):
    role_ids: List[UUID] = Field(default_factory=list)


def _role_out(r: RbacRole, member_count: Optional[int] = None) -> dict:
    out = {
        "id": str(r.id),
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "permissions": sorted(r.permissions or []),
        "is_system": bool(r.is_system),
        "is_active": bool(r.is_active),
    }
    if member_count is not None:
        out["member_count"] = member_count
    return out


def _get_role_or_404(db: Session, role_id: UUID) -> RbacRole:
    role = db.query(RbacRole).filter(RbacRole.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found.")
    return role


# ── Katalog ve kendi izinlerim ─────────────────────────────────────────


@router.get("/permission-catalog")
def permission_catalog(
    _: CurrentUser = Depends(
        svc.require_any_permission(Perm.ROLES_MANAGE, Perm.USERS_MANAGE)
    ),
):
    """Izin katalogu — UI'nin rol editorunu besler. Kod + aciklama;
    Turkce etiketler frontend'te."""
    return {
        "permissions": [
            {"code": c, "description": PERMISSION_DESCRIPTIONS.get(c, "")}
            for c in ALL_PERMISSIONS
        ]
    }


@router.get("/me")
def my_permissions(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cagiran kullanicinin efektif izinleri + rolleri. Frontend boot'ta
    ve reporting-service yetki cozumunde kullanilir. JWT yeterli."""
    perms = svc.effective_permissions(db, current_user.id)
    roles = svc.user_role_rows(db, UUID(current_user.id))
    return {
        "permissions": sorted(perms),
        "roles": [
            {"code": r.code, "name": r.name, "is_active": r.is_active}
            for r in roles
        ],
    }


# ── Rol CRUD ───────────────────────────────────────────────────────────


@router.get("/roles")
def list_roles(
    include_inactive: bool = False,
    _: CurrentUser = Depends(
        svc.require_any_permission(Perm.ROLES_MANAGE, Perm.USERS_MANAGE)
    ),
    db: Session = Depends(get_db),
):
    q = db.query(RbacRole)
    if not include_inactive:
        q = q.filter(RbacRole.is_active.is_(True))
    roles = q.order_by(RbacRole.name.asc()).all()
    counts = dict(
        db.query(RbacUserRole.role_id, func.count(RbacUserRole.id))
        .group_by(RbacUserRole.role_id)
        .all()
    )
    return {
        "roles": [_role_out(r, counts.get(r.id, 0)) for r in roles]
    }


@router.post("/roles", status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate,
    actor: CurrentUser = Depends(
        svc.require_permissions(Perm.ROLES_MANAGE)
    ),
    db: Session = Depends(get_db),
):
    svc.validate_role_code(payload.code)
    perms = svc.validate_permission_codes(payload.permissions)
    actor_perms = svc.effective_permissions(db, actor.id)
    svc.enforce_subset_rule(actor_perms, perms, action="grant")

    if svc.get_role_by_code(db, payload.code) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Role code '{payload.code}' already exists.",
        )
    role = RbacRole(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        permissions=perms,
        is_system=False,
        is_active=True,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return _role_out(role, 0)


@router.get("/roles/{role_id}")
def get_role(
    role_id: UUID,
    _: CurrentUser = Depends(
        svc.require_any_permission(Perm.ROLES_MANAGE, Perm.USERS_MANAGE)
    ),
    db: Session = Depends(get_db),
):
    role = _get_role_or_404(db, role_id)
    count = (
        db.query(RbacUserRole)
        .filter(RbacUserRole.role_id == role.id)
        .count()
    )
    return _role_out(role, count)


@router.patch("/roles/{role_id}")
def update_role(
    role_id: UUID,
    payload: RoleUpdate,
    actor: CurrentUser = Depends(
        svc.require_permissions(Perm.ROLES_MANAGE)
    ),
    db: Session = Depends(get_db),
):
    role = _get_role_or_404(db, role_id)

    if role.is_system:
        # Sistem rolu kilidi: yalnizca aciklama duzenlenebilir.
        locked = [
            f
            for f, v in (
                ("name", payload.name),
                ("permissions", payload.permissions),
                ("is_active", payload.is_active),
            )
            if v is not None
        ]
        if locked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "System role is locked; cannot change: "
                    + ", ".join(locked)
                ),
            )

    if payload.permissions is not None:
        perms = svc.validate_permission_codes(payload.permissions)
        actor_perms = svc.effective_permissions(db, actor.id)
        # Subset kurali YENI EKLENEN izinlere uygulanir: aktorun sahip
        # olmadigi mevcut bir izni role birakmasi serbest (dokunmuyor),
        # ama eklemesi yasak.
        added = set(perms) - set(role.permissions or [])
        svc.enforce_subset_rule(actor_perms, sorted(added),
                                action="grant")
        role.permissions = perms
    if payload.name is not None:
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.is_active is not None:
        role.is_active = payload.is_active

    db.commit()
    db.refresh(role)
    count = (
        db.query(RbacUserRole)
        .filter(RbacUserRole.role_id == role.id)
        .count()
    )
    return _role_out(role, count)


@router.delete("/roles/{role_id}")
def deactivate_role(
    role_id: UUID,
    _: CurrentUser = Depends(svc.require_permissions(Perm.ROLES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Soft-delete: is_active=False. Pasif rol atanamaz VE efektif
    izin hesabina girmez (mevcut atamalar gorunur kalir — LogiSlot'un
    aksine izinleri CALISMAYA DEVAM ETMEZ, testle kilitli)."""
    role = _get_role_or_404(db, role_id)
    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="System role cannot be deactivated.",
        )
    role.is_active = False
    db.commit()
    return {"ok": True, "id": str(role.id), "is_active": False}


# ── Kullanici-rol atamalari ────────────────────────────────────────────


@router.get("/users/{user_id}/roles")
def get_user_roles(
    user_id: UUID,
    _: CurrentUser = Depends(svc.require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.id == user_id).first() is None:
        raise HTTPException(status_code=404, detail="User not found.")
    roles = svc.user_role_rows(db, user_id)
    return {
        "user_id": str(user_id),
        "roles": [_role_out(r) for r in roles],
        "effective_permissions": sorted(
            svc.effective_permissions(db, user_id)
        ),
    }


@router.put("/users/{user_id}/roles")
def put_user_roles(
    user_id: UUID,
    payload: UserRolesPut,
    actor: CurrentUser = Depends(
        svc.require_permissions(Perm.USERS_MANAGE)
    ),
    db: Session = Depends(get_db),
):
    """Rol kumesini REPLACE eder. Subset kurali + son-admin kilidi +
    yalnizca-aktif-rol kurallari rbac_service.set_user_roles icinde."""
    actor_perms = svc.effective_permissions(db, actor.id)
    roles = svc.set_user_roles(
        db,
        target_user_id=user_id,
        role_ids=payload.role_ids,
        actor=actor,
        actor_perms=actor_perms,
    )
    db.commit()
    return {
        "user_id": str(user_id),
        "roles": [_role_out(r) for r in roles],
        "effective_permissions": sorted(
            svc.effective_permissions(db, user_id)
        ),
    }
