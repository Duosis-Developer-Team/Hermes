# =============================================================================
# HERMES auth — Tenant provisioning (WS12)
# =============================================================================
# Platform Super Admin konsolundan yeni tenant acilmasi.
#
# SEMA YARATILMAZ. Mimari karar geregi tenant basina veritabani/sema YOK;
# tek paylasilan sema + zorunlu `tenant_id` + FORCE ROW LEVEL SECURITY
# var. Bu yuzden "provisioning" DDL degil KAYIT isidir ve saniyeler
# surer: tenant, kimlik saglayici (e-posta alan adi), RBAC rolleri, ilk
# admin uyeligi, abonelik ve core projeksiyonu.
#
# ADIM ADIM ve KAYITLI: her asama `tenant_provisioning_operations`
# tablosuna yazilir. Core projeksiyonu basarisiz olursa tenant 'active'
# YAPILMAZ — core o tenant'i tanimadigi icin is verisi zaten
# calismazdi; yari-acik bir tenant gostermek yalan olurdu (fail-closed).
# =============================================================================

import logging
import re
import secrets
import string
import uuid
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.rbac import RbacUserRole
from ..models.tenancy import (
    Tenant,
    TenantIdentityProvider,
    TenantMembership,
    TenantProvisioningOperation,
    TenantSubscription,
)
from ..models.user import User
from .platform_service import record_audit
from .rbac_service import SYSTEM_ADMIN_CODE, bootstrap_tenant, get_role_by_code

logger = logging.getLogger(__name__)

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
# Kendi altyapimizin adlari tenant slug'i olarak alinamaz: `/?workspace=`
# ile adreslendigi icin karisiklik ve kimlik avi riski dogurur.
RESERVED_SLUGS = {
    "admin", "api", "app", "auth", "core", "hermes", "internal", "mcp",
    "platform", "platform-admin", "public", "static", "support", "www",
}


class ProvisioningError(RuntimeError):
    """Provisioning tamamlanamadi; mesaj kullaniciya gosterilebilir."""

    def __init__(self, message: str, *, step: str = "validate"):
        super().__init__(message)
        self.step = step


def _generate_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def normalize_domains(raw) -> list:
    """'@acme.com, Foo.COM' -> ['acme.com', 'foo.com'] (tekil, sirali)."""
    if not raw:
        return []
    parts = raw if isinstance(raw, list) else re.split(r"[,\s;]+", str(raw))
    out = []
    for part in parts:
        d = (part or "").strip().lower().lstrip("@").rstrip(".")
        if not d:
            continue
        # Kaba dogrulama: en az bir nokta ve gecerli karakterler.
        if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", d):
            raise ProvisioningError(f"Gecersiz e-posta alan adi: {part}")
        if d not in out:
            out.append(d)
    return out


def _record_step(db: Session, op: TenantProvisioningOperation, step: str,
                 status: str = "running", detail: Optional[str] = None):
    op.step = step
    op.status = status
    if detail:
        op.detail = detail[:2000]
    db.flush()


def _project_to_core(tenant: Tenant) -> None:
    """core_db projeksiyonunu S2S ile gunceller.

    Basarisizlik SESSIZ GECILMEZ: core tenant'i tanimadan is verisi
    calismaz, bu yuzden hata yukselir ve tenant 'active' olmaz.
    """
    settings = get_settings()
    token = getattr(settings, "HERMES_S2S_TOKEN_CURRENT", "")
    if not token:
        raise ProvisioningError(
            "S2S credential tanimli degil; core projeksiyonu yapilamaz.",
            step="core_projection",
        )
    base = str(settings.HERMES_CORE_INTERNAL_BASE).rstrip("/")
    try:
        resp = httpx.post(
            f"{base}/internal/tenants/projection",
            json={
                "tenant_id": str(tenant.id),
                "slug": tenant.slug,
                "status": tenant.status,
                "placement_key": tenant.placement_key or "shared-default",
                "source_version": int(tenant.version or 1),
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=10.0,
        )
    except Exception as exc:  # noqa: BLE001 — ag hatasi
        raise ProvisioningError(
            f"core projeksiyonu yapilamadi: {type(exc).__name__}",
            step="core_projection",
        ) from exc
    if resp.status_code >= 400:
        # Token/govde ASLA loglanmaz; yalnizca durum kodu.
        raise ProvisioningError(
            f"core projeksiyonu reddedildi (HTTP {resp.status_code})",
            step="core_projection",
        )


def provision_tenant(
    db: Session,
    *,
    slug: str,
    display_name: str,
    owner_email: str,
    owner_full_name: Optional[str] = None,
    email_domains=None,
    plan_code: Optional[str] = None,
    actor_user_id=None,
    idempotency_key: Optional[str] = None,
) -> dict:
    """Yeni tenant acar. Commit CAGIRANA aittir."""
    slug = (slug or "").strip().lower()
    display_name = (display_name or "").strip()
    owner_email = (owner_email or "").strip().lower()

    # --- 1) Dogrulama ------------------------------------------------------
    if not SLUG_RE.match(slug):
        raise ProvisioningError(
            "Slug yalnizca kucuk harf, rakam ve tire icerebilir."
        )
    if slug in RESERVED_SLUGS:
        raise ProvisioningError(f"'{slug}' ayrilmis bir addir.")
    if not display_name:
        raise ProvisioningError("Gorunen ad zorunludur.")
    if "@" not in owner_email:
        raise ProvisioningError("Gecerli bir sahip e-postasi girin.")
    if db.query(Tenant).filter(Tenant.slug == slug).first():
        raise ProvisioningError(f"'{slug}' zaten kullaniliyor.")
    domains = normalize_domains(email_domains)

    # Idempotency: cift tiklama ya da agdaki tekrar, IKINCI bir tenant
    # yaratmamali. Anahtar verilmezse uretilir (kolon NOT NULL'dur ve
    # her saga'nin izlenebilir bir kimligi olmali).
    key = (idempotency_key or "").strip() or f"auto-{uuid.uuid4()}"
    fingerprint = f"{slug}|{owner_email}|{display_name}"

    prior = db.query(TenantProvisioningOperation).filter(
        TenantProvisioningOperation.idempotency_key == key
    ).first()
    if prior is not None:
        if prior.request_fingerprint and prior.request_fingerprint != fingerprint:
            raise ProvisioningError(
                "Ayni Idempotency-Key farkli bir istekle kullanildi."
            )
        if prior.status == "completed" and prior.tenant_id:
            existing = db.query(Tenant).filter(
                Tenant.id == prior.tenant_id
            ).first()
            if existing is not None:
                # Tekrar eden istek: YENI tenant acilmaz, oncekinin ozeti
                # doner. Parola tekrar URETILMEZ (bir kez gosterilir).
                return {
                    "tenant": {
                        "id": str(existing.id), "slug": existing.slug,
                        "display_name": existing.display_name,
                        "status": existing.status,
                    },
                    "owner": {"email": owner_email, "created": False},
                    "one_time_password": None,
                    "workspace_hint": f"/?workspace={existing.slug}",
                    "replayed": True,
                }

    op = TenantProvisioningOperation(
        operation_type="create",
        step="validate",
        status="running",
        attempts=1,
        idempotency_key=key,
        request_fingerprint=fingerprint,
        created_by_user_id=actor_user_id,
    )
    db.add(op)
    db.flush()

    try:
        # --- 2) Tenant ------------------------------------------------------
        _record_step(db, op, "create_tenant")
        tenant = Tenant(
            slug=slug,
            display_name=display_name,
            status="provisioning",
            placement_key="shared-default",
            version=1,
        )
        db.add(tenant)
        db.flush()
        op.tenant_id = tenant.id

        # --- 3) E-posta alan adi -> otomatik katilim ------------------------
        if domains:
            _record_step(db, op, "identity_provider")
            db.add(TenantIdentityProvider(
                tenant_id=tenant.id,
                provider="email-domain",
                allowed_email_domains=domains,
                # Alan adi eslesen kullanici ILK GIRISINDE uye yapilir.
                auto_provision_mode="auto",
                is_active=True,
            ))
            db.flush()

        # --- 4) Tenant'a ait RBAC rolleri ----------------------------------
        _record_step(db, op, "rbac_roles")
        bootstrap_tenant(db, tenant_id=tenant.id)

        # --- 5) Sahip kullanici --------------------------------------------
        _record_step(db, op, "owner_user")
        one_time_password = None
        user = db.query(User).filter(User.email == owner_email).first()
        if user is None:
            one_time_password = _generate_password()
            from shared.auth import hash_password  # gec import: test kolayligi
            from ..models.user import AuthProvider
            user = User(
                email=owner_email,
                full_name=(owner_full_name or "").strip() or owner_email,
                hashed_password=hash_password(one_time_password),
                is_active=True,
                auth_provider=AuthProvider.LOCAL,
            )
            db.add(user)
            db.flush()

        # --- 6) Uyelik + tenant admin rolu ---------------------------------
        _record_step(db, op, "owner_membership")
        existing = db.query(TenantMembership).filter(
            TenantMembership.tenant_id == tenant.id,
            TenantMembership.user_id == user.id,
        ).first()
        if existing is None:
            db.add(TenantMembership(
                tenant_id=tenant.id, user_id=user.id, status="active",
            ))
        admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE,
                                      tenant_id=tenant.id)
        if admin_role is not None:
            db.add(RbacUserRole(
                tenant_id=tenant.id, user_id=user.id, role_id=admin_role.id,
            ))
        db.flush()

        # --- 7) Abonelik ----------------------------------------------------
        if plan_code:
            _record_step(db, op, "subscription")
            db.add(TenantSubscription(
                tenant_id=tenant.id, plan_code=plan_code, status="active",
            ))
            db.flush()

        # --- 8) core projeksiyonu (BASARISIZLIK TENANT'I ACMAZ) ------------
        _record_step(db, op, "core_projection")
        _project_to_core(tenant)

        # --- 9) Aktiflestir --------------------------------------------------
        _record_step(db, op, "activate")
        tenant.status = "active"
        tenant.version = (tenant.version or 1) + 1
        db.flush()
        # Aktif durumu core'a da yansit.
        _project_to_core(tenant)

        op.status = "completed"
        op.step = "done"
        db.flush()

    except ProvisioningError as exc:
        op.status = "failed"
        op.failure_class = exc.step
        op.detail = str(exc)[:2000]
        record_audit(
            db,
            action="platform.tenant.provision",
            actor_user_id=actor_user_id,
            target_tenant_id=getattr(op, "tenant_id", None),
            target_type="tenant",
            target_id=str(op.tenant_id) if op.tenant_id else None,
            result="error",
            reason=str(exc)[:500],
            metadata={"slug": slug, "step": exc.step},
        )
        raise

    record_audit(
        db,
        action="platform.tenant.provision",
        actor_user_id=actor_user_id,
        target_tenant_id=tenant.id,
        target_type="tenant",
        target_id=str(tenant.id),
        result="success",
        metadata={
            "slug": slug,
            "email_domains": domains,
            "plan_code": plan_code,
            "owner_created": one_time_password is not None,
        },
    )

    return {
        "tenant": {
            "id": str(tenant.id),
            "slug": tenant.slug,
            "display_name": tenant.display_name,
            "status": tenant.status,
        },
        "owner": {"email": owner_email, "created": one_time_password is not None},
        # YALNIZCA yeni kullanici yaratildiysa ve YALNIZCA BU YANITTA.
        # Hicbir yere kaydedilmez, loglanmaz.
        "one_time_password": one_time_password,
        "workspace_hint": f"/?workspace={slug}",
    }


def add_tenant_admin(db: Session, *, tenant, email: str, actor_user_id=None):
    """Var olan bir tenant'a YONETICI ekler (olusturma paritesi).

    Duzenleme ekrani, olusturma ekranindaki alanlarin aynisini
    sunmalidir; yonetici eklemek olusturmada mumkundu ama duzenlemede
    degildi.

    Idempotent: kisi zaten uyeyse uyelik tekrar yaratilmaz, yalnizca
    admin rolu garanti edilir. Parola var olan kullanicilar icin ASLA
    sifirlanmaz — baskasinin oturumunu sessizce dusurmek kabul edilemez.
    """
    from ..models.rbac import RbacUserRole
    from ..models.user import AuthProvider, User

    email = (email or "").strip().lower()
    if "@" not in email:
        raise ProvisioningError("Gecerli bir e-posta girin.")

    one_time_password = None
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        from shared.auth import hash_password
        one_time_password = _generate_password()
        user = User(
            email=email, full_name=email,
            hashed_password=hash_password(one_time_password),
            is_active=True, auth_provider=AuthProvider.LOCAL,
        )
        db.add(user)
        db.flush()

    membership = db.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant.id,
        TenantMembership.user_id == user.id,
    ).first()
    if membership is None:
        db.add(TenantMembership(tenant_id=tenant.id, user_id=user.id,
                                status="active"))
    elif membership.status != "active":
        membership.status = "active"
    db.flush()

    admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE, tenant_id=tenant.id)
    if admin_role is not None:
        has = db.query(RbacUserRole).filter(
            RbacUserRole.tenant_id == tenant.id,
            RbacUserRole.user_id == user.id,
            RbacUserRole.role_id == admin_role.id,
        ).first()
        if has is None:
            db.add(RbacUserRole(tenant_id=tenant.id, user_id=user.id,
                                role_id=admin_role.id))
    db.flush()

    record_audit(
        db,
        action="platform.tenant.admin_added",
        actor_user_id=actor_user_id,
        target_tenant_id=tenant.id,
        target_type="tenant",
        target_id=str(tenant.id),
        result="success",
        metadata={"email": email, "user_created": one_time_password is not None},
    )
    return {"email": email, "one_time_password": one_time_password,
            "created": one_time_password is not None}
