# =============================================================================
# HERMES Auth Service — Platform Admin API (WS9)
# =============================================================================
# `/api/platform/v1` — Hermes SaaS operatorlerinin kontrol duzlemi.
#
# TENANT DUZLEMINDEN AYRILIK (pack 03 §2.5, 07 §1):
#   - AYRI cookie (`hermes_platform_session`) ve AYRI audience;
#   - AYRI izin katalogu (`platform.*`), tenant rolleriyle kesisimsiz;
#   - is verisine DOGRUDAN erisim YOK. Buradaki hicbir uc bir tenant'in
#     gorevini/musterisini/zaman kaydini DONDURMEZ; yalnizca metadata
#     (durum, plan, sayim) gorunur.
#
# Bir tenant'in is verisi ancak sureli/gerekceli/denetlenen bir destek
# izniyle ve TENANT audience'li AYRI bir oturumla gorulebilir.
# =============================================================================

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

import logging

from fastapi import (
    APIRouter, Depends, Header, HTTPException, Query, Request, Response,
    status,
)
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from shared.auth import (
    PLATFORM_AUDIENCE, PLATFORM_SESSION_COOKIE_NAME, TENANT_AUDIENCE,
    ACCESS_TOKEN_EXPIRE_MINUTES, PlatformPrincipal, create_access_token,
    get_platform_principal, verify_password,
)
from shared.platform_permissions import PlatformPerm

from ..config import get_settings
from ..database import get_db
from ..models.tenancy import (
    PlatformAdmin, PlatformAuditEvent, Plan, SupportAccessGrant, Tenant,
    TenantIdentityProvider, TenantMembership, TenantSubscription,
)
from ..models.user import User
from ..services import platform_service as svc
from ..services import tenant_provisioning as provisioning

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/platform/v1", tags=["Platform"])

settings = get_settings()

# Platform oturumu tenant oturumundan KISA yasar: yuksek yetkili bir
# duzlemde acik unutulmus bir sekme daha kucuk bir risk penceresi
# birakmali.
PLATFORM_SESSION_MINUTES = min(ACCESS_TOKEN_EXPIRE_MINUTES, 30)


def _set_platform_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=PLATFORM_SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
        max_age=PLATFORM_SESSION_MINUTES * 60,
        # Cookie yalnizca platform yoluna gonderilir: tenant istekleri
        # bu cerezi TASIMAZ.
        path="/api/platform",
    )


# =============================================================================
# Oturum
# =============================================================================

class PlatformLoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login", summary="Platform Admin girisi")
def platform_login(
    payload: PlatformLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Platform operatoru girisi — AYRI cookie ve audience uretir.

    Tenant girisiyle ORTAK hicbir sey yoktur: farkli uc, farkli cerez,
    farkli audience. Basarisiz her durum AYNI yaniti alir (kimlik
    numaralandirmasi yok).
    """
    generic = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials.",
    )

    email = (payload.email or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is None or not user.is_active:
        raise generic
    if not user.hashed_password or not verify_password(
        payload.password, user.hashed_password
    ):
        raise generic

    admin = (
        db.query(PlatformAdmin)
        .filter(PlatformAdmin.user_id == user.id,
                PlatformAdmin.is_active.is_(True))
        .first()
    )
    if admin is None:
        # Gecerli bir Hermes kullanicisi olmak platform operatoru olmak
        # DEGILDIR. Ayni generic yanit: kimin operator oldugu sizmaz.
        raise generic

    token = create_access_token(
        {"user_id": str(user.id), "email": user.email,
         "auth_method": "local"},
        expires_delta=timedelta(minutes=PLATFORM_SESSION_MINUTES),
        audience=PLATFORM_AUDIENCE,
    )
    _set_platform_cookie(response, token)

    svc.record_audit(db, action="platform.login", actor_user_id=user.id)
    db.commit()

    return {
        "admin": {"id": str(user.id), "email": user.email,
                  "full_name": user.full_name},
        "permissions": sorted(
            svc.effective_platform_permissions(db, user.id)
        ),
    }


@router.post("/logout", summary="Platform oturumunu kapat")
def platform_logout(response: Response) -> dict:
    response.delete_cookie(
        key=PLATFORM_SESSION_COOKIE_NAME, path="/api/platform",
        httponly=True, secure=not settings.DEBUG, samesite="lax",
    )
    return {"detail": "Signed out"}


@router.get("/me", summary="Platform oturum bilgisi")
def platform_me(
    principal: PlatformPrincipal = Depends(get_platform_principal),
    db: Session = Depends(get_db),
) -> dict:
    return {
        "admin": {"id": principal.id, "email": principal.email},
        "permissions": sorted(
            svc.effective_platform_permissions(db, principal.id)
        ),
    }


# =============================================================================
# Genel bakis
# =============================================================================

@router.get("/overview", summary="Platform ozeti")
def overview(
    _: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_VIEW)
    ),
    db: Session = Depends(get_db),
) -> dict:
    """Yalnizca TOPLAM sayilar — hicbir tenant is verisi yoktur."""
    counts = dict(
        db.query(Tenant.status, func.count(Tenant.id))
        .group_by(Tenant.status).all()
    )
    now = datetime.now(timezone.utc)
    active_support = (
        db.query(func.count(SupportAccessGrant.id))
        .filter(SupportAccessGrant.revoked_at.is_(None),
                SupportAccessGrant.expires_at > now)
        .scalar()
    )
    return {
        "tenants": {
            "total": sum(counts.values()),
            "by_status": {k: v for k, v in counts.items()},
        },
        # Toplam uyelik sayisi — kimlik/e-posta DONMEZ.
        "memberships_total": db.query(
            func.count(TenantMembership.id)
        ).filter(TenantMembership.status == "active").scalar(),
        "support_sessions_active": active_support,
    }


# =============================================================================
# Tenant listesi / detay
# =============================================================================

def _tenant_summary(db: Session, tenant: Tenant) -> dict:
    subscription = (
        db.query(TenantSubscription)
        .filter(TenantSubscription.tenant_id == tenant.id,
                TenantSubscription.status == "active")
        .first()
    )
    active_members = (
        db.query(func.count(TenantMembership.id))
        .filter(TenantMembership.tenant_id == tenant.id,
                TenantMembership.status == "active")
        .scalar()
    )
    # Duzenleme ekrani mevcut alan adlarini gosterebilmeli.
    idp = (
        db.query(TenantIdentityProvider)
        .filter(TenantIdentityProvider.tenant_id == tenant.id,
                TenantIdentityProvider.provider == "email-domain")
        .first()
    )
    return {
        "id": str(tenant.id),
        "slug": tenant.slug,
        "display_name": tenant.display_name,
        "status": tenant.status,
        "plan_code": subscription.plan_code if subscription else None,
        "email_domains": list(idp.allowed_email_domains or []) if idp else [],
        "active_members": active_members,
        "created_at": tenant.created_at,
        "activated_at": tenant.activated_at,
        "version": tenant.version,
    }


@router.get("/tenants", summary="Tenant listesi")
def list_tenants(
    q: Optional[str] = Query(None, max_length=100),
    tenant_status: Optional[str] = Query(None, alias="status"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_VIEW)
    ),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(Tenant)
    if tenant_status:
        query = query.filter(Tenant.status == tenant_status)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(
            func.lower(Tenant.display_name).like(like)
            | func.lower(Tenant.slug).like(like)
        )
    rows = (
        query.order_by(Tenant.display_name.asc())
        .offset(offset).limit(limit + 1).all()
    )
    has_more = len(rows) > limit
    return {
        "tenants": [_tenant_summary(db, t) for t in rows[:limit]],
        "has_more": has_more,
    }


@router.get("/tenants/{tenant_id}", summary="Tenant detayi")
def get_tenant(
    tenant_id: UUID,
    _: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_VIEW)
    ),
    db: Session = Depends(get_db),
) -> dict:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    return _tenant_summary(db, tenant)


# =============================================================================
# Yasam dongusu
# =============================================================================

class LifecycleRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)
    # Iyimser kilit: istemci gordugu surumu bildirir.
    expected_version: Optional[int] = None
    # Yuksek riskli gecislerde yazili onay (UI typed-confirmation).
    confirm_slug: Optional[str] = None


def _lifecycle(
    db: Session, tenant_id: UUID, target: str, payload: LifecycleRequest,
    principal: PlatformPrincipal, *, require_typed: bool = False,
) -> dict:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    if require_typed and (payload.confirm_slug or "") != tenant.slug:
        raise HTTPException(
            status_code=422,
            detail={"code": "confirmation_required",
                    "message": "Type the tenant slug to confirm."},
        )
    try:
        svc.transition_tenant(
            db, tenant, target_status=target,
            expected_version=payload.expected_version,
            actor_user_id=UUID(principal.id), reason=payload.reason,
        )
    except svc.LifecycleError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        )
    db.commit()
    return _tenant_summary(db, tenant)


# =============================================================================
# Tenant OLUSTURMA ve DUZENLEME (WS12)
# =============================================================================
# Sema yaratilmaz: mimari karar geregi tenant basina veritabani/sema YOK,
# izolasyonu FORCE ROW LEVEL SECURITY sagliyor. Bu yuzden yeni tenant
# saniyeler icinde hazir olur; "provisioning" DDL degil KAYIT isidir.

class TenantCreateRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=63,
                      description="Adres icin kullanilir: /?workspace=<slug>")
    display_name: str = Field(min_length=1, max_length=200)
    owner_email: EmailStr = Field(
        description="Bu kisi tenant'in system-admin'i olur."
    )
    owner_full_name: Optional[str] = Field(default=None, max_length=200)
    email_domains: Optional[str] = Field(
        default=None,
        description=(
            "Virgulle ayrilmis alan adlari (orn. 'acme.com'). Bu alan "
            "adina sahip kullanicilar ILK GIRISLERINDE tenant'a katilir."
        ),
    )
    plan_code: Optional[str] = Field(default=None, max_length=50)


class TenantUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1,
                                        max_length=200)
    email_domains: Optional[str] = None
    plan_code: Optional[str] = Field(default=None, max_length=50)
    # Duzenleme ekrani, olusturma ekranindaki alanlarin AYNISINI
    # sunmalidir. Yeni bir yonetici eklemek olusturmada mumkundu ama
    # duzenlemede degildi.
    owner_email: Optional[EmailStr] = None


@router.get("/plans", summary="Plan katalogu")
def list_plans(
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_VIEW)
    ),
    db: Session = Depends(get_db),
) -> dict:
    rows = db.query(Plan).filter(Plan.is_active.is_(True)).order_by(
        Plan.code
    ).all()
    return {
        "plans": [
            {
                "code": p.code,
                "display_name": p.display_name,
                "description": p.description,
            }
            for p in rows
        ]
    }


@router.post("/tenants", status_code=201, summary="Yeni tenant olustur")
def create_tenant(
    payload: TenantCreateRequest,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_MANAGE)
    ),
    db: Session = Depends(get_db),
    idempotency_key: Optional[str] = Header(default=None,
                                            alias="Idempotency-Key"),
) -> dict:
    try:
        result = provisioning.provision_tenant(
            db,
            slug=payload.slug,
            display_name=payload.display_name,
            owner_email=str(payload.owner_email),
            owner_full_name=payload.owner_full_name,
            email_domains=payload.email_domains,
            plan_code=payload.plan_code,
            actor_user_id=UUID(principal.id),
            idempotency_key=idempotency_key,
        )
    except provisioning.ProvisioningError as exc:
        # Denetim kaydi servis icinde YAZILDI; burada onu kalici kilmak
        # icin commit ediyoruz, ardindan hatayi kullaniciya donuyoruz.
        db.commit()
        raise HTTPException(
            status_code=400,
            detail={"code": "provisioning_failed", "step": exc.step,
                    "message": str(exc)},
        ) from exc
    db.commit()
    return result


@router.patch("/tenants/{tenant_id}", summary="Tenant'i duzenle")
def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdateRequest,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_MANAGE)
    ),
    db: Session = Depends(get_db),
) -> dict:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant bulunamadi.")

    changed = {}
    if payload.display_name and payload.display_name != tenant.display_name:
        tenant.display_name = payload.display_name.strip()
        changed["display_name"] = tenant.display_name

    if payload.email_domains is not None:
        try:
            domains = provisioning.normalize_domains(payload.email_domains)
        except provisioning.ProvisioningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        idp = db.query(TenantIdentityProvider).filter(
            TenantIdentityProvider.tenant_id == tenant.id,
            TenantIdentityProvider.provider == "email-domain",
        ).first()
        if idp is None and domains:
            idp = TenantIdentityProvider(
                tenant_id=tenant.id, provider="email-domain",
                auto_provision_mode="auto", is_active=True,
            )
            db.add(idp)
        if idp is not None:
            idp.allowed_email_domains = domains
            idp.is_active = bool(domains)
        changed["email_domains"] = domains

    if payload.plan_code:
        sub = db.query(TenantSubscription).filter(
            TenantSubscription.tenant_id == tenant.id,
            TenantSubscription.status == "active",
        ).first()
        if sub is None:
            db.add(TenantSubscription(
                tenant_id=tenant.id, plan_code=payload.plan_code,
                status="active",
            ))
        else:
            sub.plan_code = payload.plan_code
        changed["plan_code"] = payload.plan_code

    # Ek yonetici: var olan tenant'a admin ekleme (olusturma paritesi).
    one_time_password = None
    if payload.owner_email:
        result = provisioning.add_tenant_admin(
            db, tenant=tenant, email=str(payload.owner_email),
            actor_user_id=UUID(principal.id),
        )
        one_time_password = result["one_time_password"]
        changed["owner_email"] = result["email"]

    if changed:
        # Gorunen ad core projeksiyonunu ETKILEMEZ (orada slug/status
        # tutulur); yine de surum ilerletilip projeksiyon tazelenir ki
        # durum bilgisi iki tarafta ayrismasin.
        tenant.version = (tenant.version or 1) + 1
        db.flush()
        try:
            provisioning._project_to_core(tenant)
        except provisioning.ProvisioningError as exc:
            logger.warning("projeksiyon tazelenemedi: %s", exc)

    svc.record_audit(
        db,
        action="platform.tenant.update",
        actor_user_id=UUID(principal.id),
        target_tenant_id=tenant.id,
        target_type="tenant",
        target_id=str(tenant.id),
        result="success",
        metadata={"changed": list(changed.keys())},
    )
    db.commit()
    return {
        "tenant_id": str(tenant.id),
        "changed": changed,
        # YALNIZCA yeni kullanici yaratildiysa ve YALNIZCA bu yanitta.
        "one_time_password": one_time_password,
    }


@router.post("/tenants/{tenant_id}/suspend", summary="Tenant'i askiya al")
def suspend_tenant(
    tenant_id: UUID,
    payload: LifecycleRequest,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_MANAGE)
    ),
    db: Session = Depends(get_db),
) -> dict:
    return _lifecycle(db, tenant_id, "suspended", payload, principal,
                      require_typed=True)


@router.post("/tenants/{tenant_id}/reactivate", summary="Tenant'i geri ac")
def reactivate_tenant(
    tenant_id: UUID,
    payload: LifecycleRequest,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_MANAGE)
    ),
    db: Session = Depends(get_db),
) -> dict:
    return _lifecycle(db, tenant_id, "active", payload, principal)


# =============================================================================
# Destek erisimi
# =============================================================================

class SupportGrantRequest(BaseModel):
    tenant_id: UUID
    mode: str = Field(default="read_only")
    reason: str = Field(..., min_length=3, max_length=500)
    duration_minutes: int = Field(
        default=svc.DEFAULT_SUPPORT_MINUTES, ge=1,
        le=svc.MAX_SUPPORT_MINUTES,
    )


@router.post("/support-grants", summary="Destek erisimi olustur")
def create_support_grant(
    payload: SupportGrantRequest,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.SUPPORT_ACCESS_CREATE)
    ),
    db: Session = Depends(get_db),
) -> dict:
    """Sureli, gerekceli, denetlenen erisim izni.

    YAZMA modu AYRI bir izin ister: salt-okunur varsayilanin bilincli
    olarak asilmasi gerekir.
    """
    if payload.mode == "read_write":
        perms = svc.effective_platform_permissions(db, principal.id)
        if PlatformPerm.SUPPORT_ACCESS_WRITE not in perms:
            raise HTTPException(
                status_code=403,
                detail={"code": "support_write_forbidden",
                        "message": "Read-write support requires an "
                                   "additional permission."},
            )

    tenant = db.query(Tenant).filter(Tenant.id == payload.tenant_id).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    try:
        grant = svc.create_support_grant(
            db, tenant_id=tenant.id, actor_user_id=UUID(principal.id),
            mode=payload.mode, reason=payload.reason,
            duration_minutes=payload.duration_minutes,
        )
    except svc.LifecycleError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        )
    db.commit()
    return {
        "grant": {
            "id": str(grant.id),
            "tenant_id": str(grant.tenant_id),
            "mode": grant.mode,
            "expires_at": grant.expires_at,
        }
    }


@router.post(
    "/support-grants/{grant_id}/exchange",
    summary="Destek iznini tenant oturumuna cevir",
)
def exchange_support_grant(
    grant_id: UUID,
    response: Response,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.SUPPORT_ACCESS_CREATE)
    ),
    db: Session = Depends(get_db),
) -> dict:
    """Izni, o tenant icin TENANT audience'li bir destek oturumuna cevirir.

    Onemli ayrimlar:
      - Uretilen token normal bir tenant token'idir; RLS ONU DA baglar.
        Yani destek oturumu "her seyi goren" bir yol DEGIL, yalnizca
        BELIRLI bir tenant'a acilan sureli bir penceredir.
      - Token `support_grant_id` ve `support_mode` tasir: her istek
        denetlenebilir ve salt-okunur mod yazma yollarinda reddedilir.
      - Gercek bir kullanicinin oturumu TAKLIT EDILMEZ; kimlik operatorun
        kendisidir.
    """
    grant = svc.active_grant(
        db, grant_id=grant_id, actor_user_id=UUID(principal.id)
    )
    if grant is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "support_grant_expired",
                    "message": "This support grant is not usable."},
        )

    tenant = db.query(Tenant).filter(Tenant.id == grant.tenant_id).first()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    remaining = grant.expires_at
    if remaining.tzinfo is None:
        remaining = remaining.replace(tzinfo=timezone.utc)
    ttl = remaining - datetime.now(timezone.utc)

    token = create_access_token(
        {
            "user_id": principal.id,
            "email": principal.email,
            "tenant_id": str(tenant.id),
            # Destek oturumunun uyelik kaydi YOKTUR — operator o
            # organizasyonun uyesi degildir; bu bilincli.
            "membership_id": None,
            "auth_method": "support",
            "support_grant_id": str(grant.id),
            "support_mode": grant.mode,
        },
        expires_delta=ttl,
        audience=TENANT_AUDIENCE,
    )

    svc.record_audit(
        db, action="support_access.exchanged",
        actor_user_id=UUID(principal.id), target_tenant_id=tenant.id,
        target_type="support_grant", target_id=str(grant.id),
        support_grant_id=grant.id, metadata={"mode": grant.mode},
    )
    db.commit()

    # Token GOVDEDE doner: destek oturumu normal tarayici oturumunun
    # yerine GECMEZ; konsol onu ayri, bannerli bir baglamda kullanir.
    return {
        "support_session": {
            "token": token,
            "tenant": {"id": str(tenant.id), "slug": tenant.slug,
                       "display_name": tenant.display_name},
            "mode": grant.mode,
            "expires_at": grant.expires_at,
        }
    }


@router.post("/support-grants/{grant_id}/revoke", summary="Destek iznini iptal et")
def revoke_support_grant(
    grant_id: UUID,
    principal: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.SUPPORT_ACCESS_CREATE)
    ),
    db: Session = Depends(get_db),
) -> dict:
    grant = (
        db.query(SupportAccessGrant)
        .filter(SupportAccessGrant.id == grant_id).first()
    )
    if grant is None:
        raise HTTPException(status_code=404, detail="Grant not found.")
    svc.revoke_grant(db, grant=grant, actor_user_id=UUID(principal.id))
    db.commit()
    return {"detail": "revoked"}


@router.get("/support-grants", summary="Destek izinleri")
def list_support_grants(
    active_only: bool = Query(True),
    _: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.TENANTS_VIEW)
    ),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(SupportAccessGrant)
    if active_only:
        query = query.filter(
            SupportAccessGrant.revoked_at.is_(None),
            SupportAccessGrant.expires_at > datetime.now(timezone.utc),
        )
    rows = query.order_by(SupportAccessGrant.created_at.desc()).limit(100).all()
    return {
        "grants": [
            {
                "id": str(g.id),
                "tenant_id": str(g.tenant_id),
                "mode": g.mode,
                "reason": g.reason,
                "created_at": g.created_at,
                "expires_at": g.expires_at,
                "revoked_at": g.revoked_at,
            }
            for g in rows
        ]
    }


# =============================================================================
# Denetim kaydi
# =============================================================================

@router.get("/audit-events", summary="Denetim kaydi")
def list_audit_events(
    target_tenant_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    _: PlatformPrincipal = Depends(
        svc.require_platform_permissions(PlatformPerm.AUDIT_VIEW)
    ),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(PlatformAuditEvent)
    if target_tenant_id:
        query = query.filter(
            PlatformAuditEvent.target_tenant_id == target_tenant_id
        )
    rows = (
        query.order_by(PlatformAuditEvent.occurred_at.desc())
        .limit(limit).all()
    )
    return {
        "events": [
            {
                "id": str(e.id),
                "occurred_at": e.occurred_at,
                "actor_type": e.actor_type,
                "actor_user_id": str(e.actor_user_id)
                if e.actor_user_id else None,
                "target_tenant_id": str(e.target_tenant_id)
                if e.target_tenant_id else None,
                "action": e.action,
                "result": e.result,
                "reason": e.reason,
                "metadata": e.metadata_json,
            }
            for e in rows
        ]
    }
