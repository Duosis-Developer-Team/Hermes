# =============================================================================
# HERMES Auth Service — Platform (SaaS operatoru) duzlemi (WS9)
# =============================================================================
# Bu modul, tenant duzleminden TAMAMEN AYRI bir guvenlik duzlemidir:
#
#   - kimlik: `platform_admins` tablosu (tenant rolu DEGIL);
#   - oturum: `aud=hermes-platform-admin` + AYRI cookie;
#   - izin: `shared/platform_permissions.py` katalogu (tenant katalogu
#     ile KESISIMSIZ, testle kilitli);
#   - is verisine erisim: YOK. Platform admini bir tenant'in verisini
#     ancak sureli/denetlenen bir destek izniyle gorebilir ve o erisim
#     TENANT audience'li ayri bir oturum uzerinden olur.
#
# "Gorunmez god mode" tam olarak bu ayrimla engellenir: platform token'i
# tenant uclarindan gecemez (shared/auth.py), tenant token'i platform
# uclarindan gecemez, ve destek izni olmadan tenant verisi okunamaz.
# =============================================================================

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from shared.auth import PlatformPrincipal, get_platform_principal
from shared.platform_permissions import (
    ALL_PLATFORM_PERMISSIONS, PlatformPerm,
)

from ..database import get_db
from ..models.tenancy import (
    PlatformAdmin, PlatformAuditEvent, SupportAccessGrant, Tenant,
)

logger = logging.getLogger("hermes.platform")

# Destek erisiminin AZAMI suresi (pack 07 §9). Daha uzunu istenirse
# yeni bir izin alinir — uzun omurlu "acik kapi" birakilmaz.
MAX_SUPPORT_MINUTES = 30
DEFAULT_SUPPORT_MINUTES = 15


# =============================================================================
# Izin cozumu
# =============================================================================

def effective_platform_permissions(
    db: Session, user_id
) -> frozenset:
    """Platform admininin efektif izinleri.

    Fail-closed: kayit yoksa veya pasifse BOS kume. Izinler JWT'ye
    GOMULMEZ — tenant tarafiyla ayni ilke, boylece bir yetkinin geri
    alinmasi token'in omrunu beklemez.
    """
    try:
        uid = UUID(str(user_id))
    except (ValueError, TypeError):
        return frozenset()

    row = (
        db.query(PlatformAdmin)
        .filter(PlatformAdmin.user_id == uid,
                PlatformAdmin.is_active.is_(True))
        .first()
    )
    if row is None:
        return frozenset()
    # Katalog disi kodlar filtrelenir: kaldirilmis bir izin, kayitta
    # kalmis olsa bile etkisizdir.
    return frozenset(set(row.permissions or []) & set(ALL_PLATFORM_PERMISSIONS))


def require_platform_permissions(*codes: str):
    """FastAPI dependency factory — verilen TUM platform izinleri gerekli.

    Kimlik `aud=hermes-platform-admin` ile dogrulanir (shared/auth.py);
    burada YETKI cozulur. Tenant izinleri burada HICBIR sey ifade etmez.
    """

    def checker(
        principal: PlatformPrincipal = Depends(get_platform_principal),
        db: Session = Depends(get_db),
    ) -> PlatformPrincipal:
        perms = effective_platform_permissions(db, principal.id)
        missing = set(codes) - perms
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Missing platform permissions: "
                       + ", ".join(sorted(missing)),
            )
        return principal

    return checker


# =============================================================================
# Denetim
# =============================================================================

def record_audit(
    db: Session,
    *,
    action: str,
    actor_user_id=None,
    target_tenant_id=None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    result: str = "success",
    reason: Optional[str] = None,
    request_id: Optional[str] = None,
    support_grant_id=None,
    metadata: Optional[dict] = None,
) -> PlatformAuditEvent:
    """Kontrol duzlemi denetim kaydi yazar (commit CAGIRANA aittir).

    ASLA yazilmayanlar: sifre, JWT, API token/hash, SSO secret'i, istek
    govdesi, tenant is kaydi icerigi. `metadata` yalnizca guvenli
    before/after alanlari tasir (durum, plan kodu, rol).
    """
    event = PlatformAuditEvent(
        actor_type="platform_admin" if actor_user_id else "system",
        actor_user_id=actor_user_id,
        target_tenant_id=target_tenant_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
        result=result,
        reason=reason,
        request_id=request_id,
        support_grant_id=support_grant_id,
        metadata_json=metadata or {},
    )
    db.add(event)
    db.flush()
    return event


# =============================================================================
# Tenant yasam dongusu
# =============================================================================

class LifecycleError(Exception):
    """Gecersiz durum gecisi veya iyimser kilit catismasi."""

    def __init__(self, message: str, *, code: str = "invalid_transition",
                 status_code: int = 409):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def transition_tenant(
    db: Session,
    tenant: Tenant,
    *,
    target_status: str,
    expected_version: Optional[int],
    actor_user_id,
    reason: Optional[str] = None,
) -> Tenant:
    """Tenant durumunu DOGRULANMIS bir gecisle degistirir.

    Iki koruma birlikte calisir:
      1. durum makinesi (08 §3) — keyfi durum atamasi imkansiz;
      2. iyimser kilit — iki operator ayni anda suspend/reactivate
         yaparsa ikincisi 409 alir, sessizce ezmez.
    """
    from ..models.tenancy import TENANT_STATUS_TRANSITIONS

    allowed = TENANT_STATUS_TRANSITIONS.get(tenant.status, set())
    if target_status not in allowed:
        raise LifecycleError(
            f"Cannot move a tenant from '{tenant.status}' to "
            f"'{target_status}'."
        )
    if expected_version is not None and tenant.version != expected_version:
        raise LifecycleError(
            "This tenant was modified by someone else. Reload and retry.",
            code="version_conflict",
        )

    previous = tenant.status
    tenant.status = target_status
    tenant.version = (tenant.version or 1) + 1
    now = datetime.now(timezone.utc)
    if target_status == "active":
        tenant.activated_at = tenant.activated_at or now
        tenant.suspended_at = None
    elif target_status == "suspended":
        tenant.suspended_at = now
    elif target_status == "archived":
        tenant.archived_at = now

    record_audit(
        db,
        action=f"tenant.{target_status}",
        actor_user_id=actor_user_id,
        target_tenant_id=tenant.id,
        target_type="tenant",
        target_id=str(tenant.id),
        reason=reason,
        metadata={"from": previous, "to": target_status},
    )
    db.flush()
    return tenant


# =============================================================================
# Destek erisimi (sureli, gerekceli, denetlenen)
# =============================================================================

def create_support_grant(
    db: Session,
    *,
    tenant_id,
    actor_user_id,
    mode: str,
    reason: str,
    duration_minutes: int,
) -> SupportAccessGrant:
    """Bir tenant'in is verisine SURELI erisim izni olusturur.

    Kurallar (pack 16 §5):
      - sure 1-30 dakika; varsayilan salt-okunur;
      - gerekce ZORUNLU (denetim izinin anlamli olmasi icin);
      - izin TEK BASINA tenant token'i DEGILDIR — ayrica exchange
        edilmesi gerekir.
    """
    if mode not in ("read_only", "read_write"):
        raise LifecycleError("Unknown support mode.", code="invalid_mode",
                             status_code=422)
    if not (reason or "").strip():
        raise LifecycleError("A reason is required.", code="reason_required",
                             status_code=422)
    if not 1 <= duration_minutes <= MAX_SUPPORT_MINUTES:
        raise LifecycleError(
            f"Duration must be between 1 and {MAX_SUPPORT_MINUTES} minutes.",
            code="invalid_duration", status_code=422,
        )

    now = datetime.now(timezone.utc)
    grant = SupportAccessGrant(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        mode=mode,
        reason=reason.strip(),
        created_at=now,
        expires_at=now + timedelta(minutes=duration_minutes),
    )
    db.add(grant)
    db.flush()

    record_audit(
        db,
        action="support_access.created",
        actor_user_id=actor_user_id,
        target_tenant_id=tenant_id,
        target_type="support_grant",
        target_id=str(grant.id),
        reason=grant.reason,
        support_grant_id=grant.id,
        metadata={"mode": mode, "duration_minutes": duration_minutes},
    )
    return grant


def active_grant(
    db: Session, *, grant_id, actor_user_id
) -> Optional[SupportAccessGrant]:
    """Kullanilabilir (suresi dolmamis, iptal edilmemis) izni doner.

    Izin, onu OLUSTURAN operatore aittir: baska bir platform admini
    baskasinin iznini kullanamaz.
    """
    grant = (
        db.query(SupportAccessGrant)
        .filter(SupportAccessGrant.id == grant_id,
                SupportAccessGrant.actor_user_id == actor_user_id)
        .first()
    )
    if grant is None:
        return None
    if grant.revoked_at is not None:
        return None
    expires = grant.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        return None
    return grant


def revoke_grant(
    db: Session, *, grant: SupportAccessGrant, actor_user_id
) -> SupportAccessGrant:
    grant.revoked_at = datetime.now(timezone.utc)
    grant.revoked_by_user_id = actor_user_id
    record_audit(
        db,
        action="support_access.revoked",
        actor_user_id=actor_user_id,
        target_tenant_id=grant.tenant_id,
        target_type="support_grant",
        target_id=str(grant.id),
        support_grant_id=grant.id,
    )
    db.flush()
    return grant


def list_platform_admin_ids(db: Session) -> List[UUID]:
    return [
        row[0]
        for row in db.query(PlatformAdmin.user_id)
        .filter(PlatformAdmin.is_active.is_(True)).all()
    ]


# Bootstrap icin kullanilan varsayilan izin kumesi. `superadmin@hermes.dev`
# gibi bir dev kimligi bu kumeyle acilir; SIFRE hicbir yerde saklanmaz
# (bkz. scripts/bootstrap_platform_admin.py).
BOOTSTRAP_PERMISSIONS = list(ALL_PLATFORM_PERMISSIONS)

__all__ = [
    "MAX_SUPPORT_MINUTES", "DEFAULT_SUPPORT_MINUTES", "BOOTSTRAP_PERMISSIONS",
    "LifecycleError", "PlatformPerm",
    "effective_platform_permissions", "require_platform_permissions",
    "record_audit", "transition_tenant",
    "create_support_grant", "active_grant", "revoke_grant",
    "list_platform_admin_ids",
]
