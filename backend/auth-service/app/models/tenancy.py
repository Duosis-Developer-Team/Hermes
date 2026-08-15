# =============================================================================
# HERMES Auth Service — Tenant control-plane modelleri (WS2)
# =============================================================================
# Bu dosya, Hermes'i tek-sirket uygulamasindan tenant tabanli SaaS'a
# tasiyan KONTROL DUZLEMINI tanimlar. Otorite `auth_db`'dedir; core_db
# yalnizca idempotent bir projeksiyon (`tenant_registry`) tutar.
#
# TEMEL AYRIM (CTO karari):
#   - `users` GLOBAL kimliktir. Tenant sutunu ALMAZ. Ayni kisi birden
#     fazla tenant'a uye olabilir.
#   - Bir tenant'a erisim YALNIZCA aktif bir `tenant_memberships` satiri
#     uzerinden vardir.
#   - Yetki her zaman (tenant_id, membership_id, user_id) uclusune gore
#     degerlendirilir; tek basina user_id'ye gore ASLA.
#   - Tenant yoneticisi (`system-admin` rolu) ile Platform Super Admin
#     AYRI guvenlik duzlemleridir. `platform_admins` tenant rolu DEGILDIR.
#
# Sifre/secret DEGERI bu tablolarin hicbirinde saklanmaz — yalnizca
# K8s/secret manager'a isaret eden opak referanslar.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..database import Base


def _now():
    return datetime.now(timezone.utc)


# =============================================================================
# Durum sozlukleri (tek kaynak)
# =============================================================================
# Python tarafinda Enum yerine acik sabit listeleri kullaniyoruz: DB'de
# CHECK constraint olarak yasarlar ve yeni deger eklemek ENUM tipi
# degistirmek gibi kilitleyici bir DDL gerektirmez.

TENANT_STATUSES = (
    "provisioning", "active", "suspended", "grace",
    "deprovisioning", "archived", "failed",
)

# Izin verilen gecisler — servis katmani bunu otorite kabul eder.
# 08_TENANT_PROVISIONING_SUBSCRIPTIONS_LIFECYCLE.md §3 ile birebir.
TENANT_STATUS_TRANSITIONS = {
    "provisioning": {"active", "failed"},
    "failed": {"provisioning", "archived"},
    "active": {"grace", "suspended", "deprovisioning"},
    "grace": {"active", "suspended"},
    "suspended": {"active", "deprovisioning"},
    "deprovisioning": {"archived", "failed"},
    "archived": set(),
}

MEMBERSHIP_STATUSES = ("invited", "active", "suspended", "removed")

DOMAIN_KINDS = ("hermes_subdomain", "custom", "legacy")
DOMAIN_VERIFICATION_STATUSES = ("pending", "verified", "failed")

SUPPORT_GRANT_MODES = ("read_only", "read_write")

# Tenant yerlesimi: ilk surumde YALNIZCA paylasimli sema. Bu sutunlar
# gelecekteki database-per-tenant calismasi icin notr metadata'dir;
# hicbir router/servis istekten gelen bir degere gore veritabani SECMEZ.
PLACEMENT_MODES = ("shared",)


# =============================================================================
# tenants — kontrol duzleminin koku
# =============================================================================

class Tenant(Base):
    """Bir musteri organizasyonu (workspace)."""

    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Aktivasyondan sonra degismez (kontrollu rename akisi haric).
    slug = Column(String(63), nullable=False, unique=True, index=True)
    display_name = Column(String(255), nullable=False)
    legal_name = Column(String(255), nullable=True)

    status = Column(String(20), nullable=False, default="provisioning",
                    index=True)

    default_locale = Column(String(10), nullable=False, default="tr-TR")
    timezone = Column(String(64), nullable=False, default="Europe/Istanbul")

    # Gelecekteki yerlesim calismasi icin notr metadata (bkz. dosya basi).
    placement_mode = Column(String(20), nullable=False, default="shared")
    placement_key = Column(String(64), nullable=False,
                           default="shared-default")

    # Iyimser kilit: lifecycle aksiyonlari beklenen surumu gonderir,
    # uyusmazsa 409 doner (es zamanli suspend/reactivate carpismasi).
    version = Column(Integer, nullable=False, default=1)

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)
    activated_at = Column(DateTime(timezone=True), nullable=True)
    suspended_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('provisioning','active','suspended','grace',"
            "'deprovisioning','archived','failed')",
            name="chk_tenants_status",
        ),
        CheckConstraint(
            "placement_mode = 'shared'",
            name="chk_tenants_placement_mode",
        ),
        # Slug bir hostname bileseni olarak kullanilir: kucuk harf,
        # rakam ve tire; bas/son tire yok.
        CheckConstraint(
            r"slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'",
            name="chk_tenants_slug_format",
        ),
    )


# =============================================================================
# tenant_domains — host -> tenant cozumu
# =============================================================================

class TenantDomain(Base):
    """Bir tenant'a isaret eden dogrulanmis hostname.

    Ingress'te gelen Host basligi YALNIZCA burada dogrulanmis bir kayda
    eslesiyorsa tenant cozulur. Istemcinin gonderdigi X-Tenant-* basligi
    ASLA otorite degildir.
    """

    __tablename__ = "tenant_domains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Normalize edilmis kucuk harfli hostname; GLOBAL benzersiz.
    hostname = Column(String(253), nullable=False, unique=True, index=True)
    kind = Column(String(20), nullable=False, default="hermes_subdomain")

    verification_status = Column(String(20), nullable=False,
                                 default="pending")
    # Dogrulama challenge'i yalnizca HASH olarak saklanir.
    verification_token_hash = Column(String(64), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)

    is_primary = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('hermes_subdomain','custom','legacy')",
            name="chk_tenant_domains_kind",
        ),
        CheckConstraint(
            "verification_status IN ('pending','verified','failed')",
            name="chk_tenant_domains_verification",
        ),
        # Tenant basina en fazla BIR birincil domain.
        Index(
            "uq_tenant_domains_one_primary",
            "tenant_id",
            unique=True,
            postgresql_where=Column("is_primary") == True,  # noqa: E712
        ),
    )


# =============================================================================
# tenant_memberships — global kimlik ile tenant arasindaki TEK kopru
# =============================================================================

class TenantMembership(Base):
    """Kullanicinin bir tenant'taki uyeligi.

    Bu satir yoksa (veya aktif degilse) kullanici o tenant'i goremez —
    global `users` kaydinin varligi tek basina hicbir erisim vermez.
    """

    __tablename__ = "tenant_memberships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    status = Column(String(20), nullable=False, default="invited")

    # Tenant'a ozel gorunen ad (rapor/atama ekranlarinda). Bos ise
    # global users.full_name kullanilir.
    display_name_override = Column(String(255), nullable=True)

    joined_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id",
                         name="uq_tenant_memberships_tenant_user"),
        CheckConstraint(
            "status IN ('invited','active','suspended','removed')",
            name="chk_tenant_memberships_status",
        ),
        # Tenant switcher: "bu kimligin aktif uyelikleri" sorgusu.
        Index("idx_tenant_memberships_user_status", "user_id", "status"),
        # RBAC atamalarinin uyelige bagli composite FK'si icin gerekli.
        UniqueConstraint("tenant_id", "user_id", "id",
                         name="uq_tenant_memberships_tenant_user_id"),
    )


# =============================================================================
# tenant_identity_providers — tenant basina SSO baglantisi
# =============================================================================

class TenantIdentityProvider(Base):
    """Tenant'a ozel Entra/OIDC baglantisi.

    Bugun tek bir deployment-genelinde AZURE_TENANT_ID var; bu tablo onu
    tenant basina cozulen bir baglantiya donusturur. SECRET DEGERI
    SAKLANMAZ: yalnizca K8s Secret'ina isaret eden opak referans.
    """

    __tablename__ = "tenant_identity_providers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    provider = Column(String(32), nullable=False, default="microsoft")

    # Entra dizin (tid) kimligi — callback'te gelen token'in `tid`
    # claim'i bununla karsilastirilir.
    provider_tenant_id = Column(String(128), nullable=False)
    client_id = Column(String(128), nullable=True)
    # ORNEK: "k8s:hermes-dev/hermes-sso-acme#CLIENT_SECRET"
    client_secret_ref = Column(String(255), nullable=True)

    # Kolaylik kurali; TEK BASINA tenant otoritesi DEGILDIR.
    allowed_email_domains = Column(JSONB, nullable=False, default=list)

    is_active = Column(Boolean, nullable=False, default=False)
    # Varsayilan KAPALI: bir Entra dizinine sahip olmak, o tenant'ta
    # otomatik hesap acilmasi anlamina gelmez.
    auto_provision_mode = Column(String(20), nullable=False,
                                 default="disabled")

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", "provider_tenant_id",
                         name="uq_tenant_idp_tenant_provider_dir"),
        CheckConstraint(
            "auto_provision_mode IN ('disabled','invite','auto')",
            name="chk_tenant_idp_auto_provision",
        ),
    )


# =============================================================================
# Abonelik / entitlement (v1: odeme saglayicisi YOK)
# =============================================================================

class Plan(Base):
    """Satilabilir paket. Kod STABIL slug'dir."""

    __tablename__ = "plans"

    code = Column(String(32), primary_key=True)
    display_name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)


class PlanEntitlement(Base):
    """Bir planin tasidigi tipli yetkinlik degeri."""

    __tablename__ = "plan_entitlements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_code = Column(
        String(32),
        ForeignKey("plans.code", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # app/services/entitlements.py katalogundan; katalog disi kod
    # FAIL-CLOSED kabul edilir (ozelligi sessizce ACMAZ).
    entitlement_code = Column(String(64), nullable=False)
    value = Column(JSONB, nullable=False)

    __table_args__ = (
        UniqueConstraint("plan_code", "entitlement_code",
                         name="uq_plan_entitlements_plan_code"),
    )


class TenantSubscription(Base):
    """Tenant'in aktif planiyla iliskisi."""

    __tablename__ = "tenant_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    plan_code = Column(
        String(32),
        ForeignKey("plans.code", ondelete="RESTRICT"),
        nullable=False,
    )
    status = Column(String(20), nullable=False, default="active")
    started_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=True)

    # Odeme saglayicisi v1'de YOK; alanlar ileri uyumluluk icin bos.
    external_provider = Column(String(32), nullable=True)
    external_reference = Column(String(128), nullable=True)

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        # Tenant basina tek AKTIF abonelik.
        Index(
            "uq_tenant_subscriptions_one_active",
            "tenant_id",
            unique=True,
            postgresql_where=Column("status") == "active",
        ),
        CheckConstraint(
            "status IN ('active','cancelled','expired')",
            name="chk_tenant_subscriptions_status",
        ),
    )


class TenantEntitlementOverride(Base):
    """Tek bir tenant icin plan degerini ezen, gerekceli istisna."""

    __tablename__ = "tenant_entitlement_overrides"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    entitlement_code = Column(String(64), nullable=False)
    value = Column(JSONB, nullable=False)
    reason = Column(Text, nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "entitlement_code",
                         name="uq_tenant_entitlement_overrides"),
    )


# =============================================================================
# Provisioning saga'si
# =============================================================================

class TenantProvisioningOperation(Base):
    """Iki veritabanina yayilan tenant kurulumunun kalici durumu.

    auth_db ve core_db arasinda dagitik transaction YOKTUR; bu yuzden
    kurulum, ayni idempotency anahtariyla tekrar kosuldugunda AYNI
    tenant'a yakinsayan bir saga'dir. Yarim kalan kayitlar otomatik
    SILINMEZ — onarim/retry acikca sunulur.
    """

    __tablename__ = "tenant_provisioning_operations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    # Ayni anahtar + ayni istek => ayni sonuc; ayni anahtar + FARKLI
    # istek => 409 idempotency_conflict.
    idempotency_key = Column(String(128), nullable=False, unique=True)
    request_fingerprint = Column(String(64), nullable=False)

    operation_type = Column(String(32), nullable=False, default="provision")
    step = Column(String(48), nullable=False, default="tenant_record_created")
    status = Column(String(20), nullable=False, default="pending")
    failure_class = Column(String(48), nullable=True)
    # Guvenli metadata; istek govdesi/secret ASLA yazilmaz.
    detail = Column(JSONB, nullable=False, default=dict)

    attempts = Column(Integer, nullable=False, default=0)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','failed')",
            name="chk_tenant_provisioning_status",
        ),
    )


# =============================================================================
# Platform guvenlik duzlemi (tenant rollerinden AYRI)
# =============================================================================

class PlatformAdmin(Base):
    """Hermes SaaS operatoru.

    Bu bir tenant rolu DEGILDIR: `rbac_roles` icinde karsiligi yoktur ve
    hicbir tenant yoneticisi kendi kendine buraya satir ekleyemez.
    """

    __tablename__ = "platform_admins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    # shared/platform_permissions.py katalogundan kod listesi.
    permissions = Column(JSONB, nullable=False, default=list)
    is_active = Column(Boolean, nullable=False, default=True)
    mfa_required = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)


class SupportAccessGrant(Base):
    """Platform Admin'in bir tenant'in is verisine SURELI erisimi.

    Platform Admin'in genel/gorunmez bir RLS bypass'i YOKTUR. Is
    verisine erisim yalnizca bu kayit uzerinden olur: acik tenant,
    gerekce, mod ve son kullanma zamani. Varsayilan salt-okunur ve en
    fazla 30 dakika.
    """

    __tablename__ = "support_access_grants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    actor_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    mode = Column(String(16), nullable=False, default="read_only")
    # Bilet/gerekce zorunludur — denetim izinin anlamli olmasi icin.
    reason = Column(Text, nullable=False)

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "mode IN ('read_only','read_write')",
            name="chk_support_grants_mode",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="chk_support_grants_expiry",
        ),
        Index("idx_support_grants_tenant_expiry", "tenant_id", "expires_at"),
    )


class PlatformAuditEvent(Base):
    """Kontrol duzlemi denetim kaydi.

    ASLA yazilmayanlar: sifre, JWT, API token/hash, SSO secret'i, istek
    govdesi, tenant is kaydi icerigi.
    """

    __tablename__ = "platform_audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    occurred_at = Column(DateTime(timezone=True), default=_now,
                         nullable=False, index=True)

    actor_type = Column(String(24), nullable=False)   # platform_admin|system
    actor_user_id = Column(UUID(as_uuid=True), nullable=True)
    actor_tenant_id = Column(UUID(as_uuid=True), nullable=True)

    target_tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    target_type = Column(String(48), nullable=True)
    target_id = Column(String(64), nullable=True)

    action = Column(String(64), nullable=False, index=True)
    result = Column(String(16), nullable=False, default="success")
    reason = Column(Text, nullable=True)

    request_id = Column(String(64), nullable=True)
    support_grant_id = Column(UUID(as_uuid=True), nullable=True)
    # Yalnizca guvenli before/after metadata'si (durum, plan kodu, rol).
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)

    __table_args__ = (
        CheckConstraint(
            "result IN ('success','denied','error')",
            name="chk_platform_audit_result",
        ),
    )
