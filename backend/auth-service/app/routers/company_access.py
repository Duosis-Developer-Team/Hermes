# =============================================================================
# HERMES auth — Sirket hesaplari + modul erisimi (auth 0007)
# =============================================================================
#   /api/v1/auth/companies          sirket hesaplari (users.manage)
#   /api/v1/auth/module-access      modul erisim kurallari (roles.manage)
#
# Sirket hesabi = dis musteriye (ornegin Defacto) verilen TEK giris hesabi.
# Kullanicilar listesinde DEGIL; rol almaz; yalniz kendisine acilan
# modulleri gorur (services/module_access.py). Tenant'in her zaman cagiranin
# DOGRULANMIS token'indan gelir.
# =============================================================================

from datetime import datetime, timezone
from typing import List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, hash_password
from shared.modules import ALL_MODULES, Module
from shared.permissions import Perm

from ..database import get_db
from ..models.tenancy import TenantMembership
from ..models.user import User
from ..services import module_access as access
from ..services.rbac_service import require_permissions

router = APIRouter(tags=["Company accounts & module access"])


def _now():
    return datetime.now(timezone.utc)


def _value_error(exc: ValueError) -> HTTPException:
    messages = {
        "module_not_enabled": "This module is not enabled for the workspace.",
        "unknown_module": "Unknown module.",
        "invalid_principal": "Invalid access rule.",
        "unknown_user": "One or more users are not members of this workspace.",
    }
    return HTTPException(status_code=422, detail=messages.get(str(exc), str(exc)))


# =============================================================================
# Sirket hesaplari
# =============================================================================

class CompanyOut(BaseModel):
    id: UUID
    name: str
    email: str
    is_active: bool
    modules: List[str]
    created_at: Optional[datetime] = None


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    modules: List[str] = Field(default_factory=lambda: [Module.TICKETS])


class CompanyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    is_active: Optional[bool] = None
    modules: Optional[List[str]] = None


class PasswordReset(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


def _company_rows(db: Session, tenant_id, user_id: Optional[UUID] = None):
    q = (
        db.query(User, TenantMembership)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == UUID(str(tenant_id)),
                TenantMembership.account_kind == access.COMPANY)
    )
    if user_id is not None:
        q = q.filter(User.id == user_id)
    return q.order_by(User.full_name.asc()).all()


def _out(db: Session, tenant_id, user: User, membership: TenantMembership) -> CompanyOut:
    return CompanyOut(
        id=user.id, name=user.full_name or user.email, email=user.email,
        is_active=bool(user.is_active) and membership.status == "active",
        modules=access.user_modules(db, tenant_id=tenant_id, user_id=user.id),
        created_at=membership.created_at,
    )


def _get_company(db: Session, tenant_id, company_id: UUID):
    rows = _company_rows(db, tenant_id, company_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Company not found.")
    return rows[0]


@router.get("/companies", response_model=List[CompanyOut])
def list_companies(
    actor: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_db),
):
    return [_out(db, actor.tenant_id, u, m) for u, m in _company_rows(db, actor.tenant_id)]


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(
    payload: CompanyCreate,
    actor: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    if db.query(User.id).filter(User.email == email).first() is not None:
        raise HTTPException(status_code=409, detail="This e-mail address is already in use.")
    user = User(email=email, full_name=" ".join(payload.name.split()),
                hashed_password=hash_password(payload.password), is_admin=False, is_active=True)
    db.add(user)
    db.flush()
    membership = TenantMembership(tenant_id=UUID(str(actor.tenant_id)), user_id=user.id, status="active",
                                  account_kind=access.COMPANY, joined_at=_now())
    db.add(membership)
    db.flush()
    try:
        access.set_user_modules(db, tenant_id=actor.tenant_id, user_id=user.id, modules=payload.modules,
                                actor_id=actor.id)
    except ValueError as exc:
        db.rollback()
        raise _value_error(exc)
    db.commit()
    return _out(db, actor.tenant_id, user, membership)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def update_company(
    company_id: UUID,
    payload: CompanyUpdate,
    actor: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_db),
):
    user, membership = _get_company(db, actor.tenant_id, company_id)
    if payload.name is not None:
        user.full_name = " ".join(payload.name.split())
    if payload.is_active is not None:
        if not payload.is_active and membership.status == "active":
            # Acik oturumlar bir sonraki yenilemede duser.
            user.session_version = int(user.session_version or 1) + 1
        membership.status = "active" if payload.is_active else "suspended"
    if payload.modules is not None:
        try:
            access.set_user_modules(db, tenant_id=actor.tenant_id, user_id=user.id, modules=payload.modules,
                                    actor_id=actor.id)
        except ValueError as exc:
            db.rollback()
            raise _value_error(exc)
    db.commit()
    return _out(db, actor.tenant_id, user, membership)


@router.post("/companies/{company_id}/password", status_code=204)
def reset_company_password(
    company_id: UUID,
    payload: PasswordReset,
    actor: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_db),
):
    user, _membership = _get_company(db, actor.tenant_id, company_id)
    user.hashed_password = hash_password(payload.password)
    user.session_version = int(user.session_version or 1) + 1
    db.commit()


# =============================================================================
# Modul erisimi
# =============================================================================

class Grant(BaseModel):
    type: Literal["user", "group"]
    id: UUID


class ModuleAccessOut(BaseModel):
    module: str
    everyone: bool
    grants: List[Grant]


class ModuleAccessIn(BaseModel):
    everyone: bool = True
    grants: List[Grant] = Field(default_factory=list, max_length=500)


def _policies(db: Session, tenant_id) -> List[ModuleAccessOut]:
    rows = access.policy_rows(db, tenant_id=tenant_id)
    return [ModuleAccessOut(module=m, everyone=v["everyone"], grants=[Grant(**g) for g in v["grants"]])
            for m, v in rows.items()]


@router.get("/module-access", response_model=List[ModuleAccessOut])
def list_module_access(
    actor: CurrentUser = Depends(require_permissions(Perm.ROLES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Tenant'ta ACIK modullerin erisim kurali (yoksa: Herkes)."""
    return _policies(db, actor.tenant_id)


@router.put("/module-access/{module}", response_model=List[ModuleAccessOut])
def set_module_access(
    module: str,
    payload: ModuleAccessIn,
    actor: CurrentUser = Depends(require_permissions(Perm.ROLES_MANAGE)),
    db: Session = Depends(get_db),
):
    if module not in ALL_MODULES:
        raise HTTPException(status_code=404, detail="Unknown module.")
    try:
        access.set_policy(db, tenant_id=actor.tenant_id, module=module, everyone=payload.everyone,
                          grants=[g.model_dump(mode="json") for g in payload.grants], actor_id=actor.id)
    except ValueError as exc:
        db.rollback()
        raise _value_error(exc)
    db.commit()
    return _policies(db, actor.tenant_id)
