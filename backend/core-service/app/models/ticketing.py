# =============================================================================
# HERMES — Ortak urun ticket platformu: canonical veri modeli
# =============================================================================
# Kaynak: 01_HERMES/01_HERMES_DATA_MODEL_AND_MIGRATIONS.md
#
# TUM tablolar `TenantOwnedMixin` tasir. Bu, iki seyi OTOMATIK yapar:
#   1) `tenant_id` kolonu + index;
#   2) tablonun RLS envanterine girmesi (app/models/mixins.py
#      `tenant_owned_tables()`), yani migration'in RLS/FORCE politikasi
#      ve `tests/test_rls_isolation.py` katalog kapisi bu tablolari
#      kendiliginden kapsar. Politikasiz bir ticket tablosu CI'da
#      kirmizi olur.
#
# Canonical ticket kayitlari HER ZAMAN Duosis support tenant'ina yazilir
# (`HERMES_SUPPORT_TENANT_ID`). Kaynak uygulama/tenant kimligi AYRI
# alanlarda tasinir (`application_id`, `source_tenant_row_id`,
# `source_ticket_id`) — yani "kimin ticket'i" sorusu tenant_id ile
# DEGIL, source alanlariyla cevaplanir. Bu ayrim, capraz-tenant destek
# vermeyi FORCE RLS'i delmeden mumkun kilar (03 §6).
#
# FK NOTU: burada SADE (tek kolonlu) FK'ler tanimlanir. Migration
# `0007_ticketing_foundation`, mevcut `tenant_enforce.convert_foreign_keys`
# yardimcisini cagirarak bunlari (tenant_id, id) COMPOSITE FK'lere
# donusturur — yani bir tenant'in satiri baska bir tenant'in satirini
# referans EDEMEZ. Tek kaynak korunur: donusum mantigi tek yerde yasar.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..database import Base
# Sozlesme sabitleri ACIK ALT-MODUL importuyla gelir (`from ..X import Y`):
# paket nesnesinden (`from .. import X`) okumak, `app/__init__.py`
# main'i cektigi icin kismi baslatma penceresine denk gelebilir.
from ..ticket_contract import (
    ACTOR_TYPES,
    APPLICATION_STATUSES,
    ATTACHMENT_SCAN_STATUSES,
    ATTACHMENT_VISIBILITY,
    AUTHOR_TYPES,
    CATEGORIES,
    DELIVERY_STATUSES,
    ENVIRONMENTS,
    IMPACTS,
    MESSAGE_FORMATS,
    MESSAGE_VISIBILITY,
    PRIORITIES,
    RESOLUTION_CODES,
    SOURCE_TENANT_STATUSES,
    STATUSES,
)
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


def _in_list(column: str, values) -> str:
    """Enum CHECK ifadesini SOZLESMEDEN uretir.

    Elle yazilan bir IN listesi, katalog degistiginde sessizce
    ayrisirdi; burada tek kaynak `ticket_contract`tir.
    """
    joined = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({joined})"


# =============================================================================
# support_applications — ticket gonderebilen urun entegrasyonu
# =============================================================================

class SupportApplication(TenantOwnedMixin, Base):
    """Kaynak uygulama kaydi (`hermes`, `logislot`, ...).

    `code` IMMUTABLE'dir: ticket'lar, route'lar ve webhook imzalari ona
    baglidir. Yeniden adlandirma bir onboarding islemidir, bir UPDATE
    degil (03 §7).
    """

    __tablename__ = "support_applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), nullable=False, index=True)
    display_name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="active", index=True)
    environment = Column(String(20), nullable=False, default="dev")
    # Kayitli callback — event payload'i URL BELIRLEYEMEZ (05 §7).
    callback_url = Column(Text, nullable=True)
    # Imza anahtari KIMLIGI; SIRRIN KENDISI DB'de DEGIL, secret'tadir.
    webhook_key_id = Column(String(80), nullable=True)
    capabilities_json = Column(
        JSONB, nullable=False, default=dict,
        server_default=text("'{}'::jsonb"),
    )

    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)
    deactivated_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "code", "environment",
            name="uq_support_applications_code_env",
        ),
        CheckConstraint(
            "code ~ '^[a-z][a-z0-9_-]{1,49}$'",
            name="chk_support_applications_code",
        ),
        CheckConstraint(
            _in_list("status", APPLICATION_STATUSES),
            name="chk_support_applications_status",
        ),
        CheckConstraint(
            _in_list("environment", ENVIRONMENTS),
            name="chk_support_applications_environment",
        ),
        # Production callback HTTPS zorunlu; dev'de http'ye izin veren
        # tek yer ayarlardir (config kapisi), sema degil — ama 'live'
        # ortamda VERITABANI da reddeder (savunma derinligi).
        CheckConstraint(
            "callback_url IS NULL OR environment <> 'live' "
            "OR callback_url LIKE 'https://%'",
            name="chk_support_applications_callback_https",
        ),
    )


# =============================================================================
# support_source_tenants — kaynak uygulamadaki musteri hesabi
# =============================================================================

class SupportSourceTenant(TenantOwnedMixin, Base):
    """Kaynak uygulamanin tenant'inin Hermes tarafindaki MAPPING'i.

    Hermes tenant'i DEGILDIR: `source_tenant_id` opaque bir STRING'dir
    (UUID varsayilmaz — baska bir urun slug/int kullanabilir).
    """

    __tablename__ = "support_source_tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    source_tenant_id = Column(String(128), nullable=False)
    source_tenant_slug = Column(String(128), nullable=True)
    display_name = Column(String(200), nullable=False)
    status = Column(String(20), nullable=False, default="active", index=True)
    metadata_json = Column(
        JSONB, nullable=False, default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "application_id", "source_tenant_id",
            name="uq_support_source_tenants_identity",
        ),
        CheckConstraint(
            _in_list("status", SOURCE_TENANT_STATUSES),
            name="chk_support_source_tenants_status",
        ),
    )


# =============================================================================
# support_ticket_routes — kaynak tenant → Duosis grubu
# =============================================================================

class SupportTicketRoute(TenantOwnedMixin, Base):
    """Bir kaynak tenant icin AKTIF hedef support grubu.

    V1'de tenant basina TEK aktif route (D-004). Kismi unique index bunu
    veritabani seviyesinde garanti eder: iki aktif route yazilamaz, yani
    "hangi ekip?" sorusunun iki cevabi olamaz.
    """

    __tablename__ = "support_ticket_routes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    source_tenant_row_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_source_tenants.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    route_version = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    configured_by_actor_type = Column(String(30), nullable=True)
    configured_by_actor_id = Column(String(64), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "source_tenant_row_id", "route_version",
            name="uq_support_routes_version",
        ),
        # Kaynak tenant basina EN FAZLA bir aktif route.
        Index(
            "uq_support_routes_active",
            "tenant_id", "source_tenant_row_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        CheckConstraint(
            "route_version >= 1", name="chk_support_routes_version_min",
        ),
    )


# =============================================================================
# support_integration_clients / tokens — service credential'lari
# =============================================================================
# Public API `api_clients` altyapisi BILEREK yeniden kullanilmadi:
#   - Public API'nin donmus kurali "service client'lar READ-ONLY"dir ve
#     testle kilitlidir; ticket ingress'i tam tersini gerektirir.
#   - Public API'nin tek hata zarfi (code/message/request_id) donmustur;
#     ticket sozlesmesi correlation_id + retryable ISTER.
#   - Support tenant'i SUNUCU KONFIGURASYONUNDAN bilinir, yani public
#     API'deki "token'i bulmadan tenant'i bilemem" tavuk-yumurta
#     problemi BURADA YOKTUR; ayricalikli lookup fonksiyonuna gerek yok.
# Guvenlik ilkeleri (hash'li saklama, prefix, expiry, rotation, revoke,
# last-used) AYNEN korunur ve ayni hash yardimcilari kullanilir.

class SupportIntegrationClient(TenantOwnedMixin, Base):
    """Bir kaynak uygulamanin sunucu-sunucu kimligi."""

    __tablename__ = "support_integration_clients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    environment = Column(String(10), nullable=False, default="dev")
    scopes = Column(
        JSONB, nullable=False, default=list,
        server_default=text("'[]'::jsonb"),
    )
    rate_limit_per_min = Column(Integer, nullable=True)
    status = Column(String(10), nullable=False, default="active")
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "name", name="uq_support_clients_name",
        ),
        CheckConstraint(
            "status IN ('active', 'disabled')",
            name="chk_support_clients_status",
        ),
        CheckConstraint(
            _in_list("environment", ENVIRONMENTS),
            name="chk_support_clients_environment",
        ),
        CheckConstraint(
            "rate_limit_per_min IS NULL OR rate_limit_per_min > 0",
            name="chk_support_clients_rate_limit",
        ),
    )


class SupportIntegrationToken(TenantOwnedMixin, Base):
    """Saf credential: prefix + SHA-256 hash. Plaintext ASLA saklanmaz."""

    __tablename__ = "support_integration_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_integration_clients.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    token_prefix = Column(String(24), nullable=False)
    token_hash = Column(String(64), nullable=False)
    status = Column(String(10), nullable=False, default="active")
    expires_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    last_used_ip = Column(String(45), nullable=True)
    rotated_from_token_id = Column(UUID(as_uuid=True), nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "token_hash", name="uq_support_tokens_hash",
        ),
        CheckConstraint(
            "status IN ('active', 'revoked')",
            name="chk_support_tokens_status",
        ),
    )


# =============================================================================
# tickets — canonical aggregate
# =============================================================================

class Ticket(TenantOwnedMixin, Base):
    """Canonical ticket. Tek yasam dongusu, tek numara, tek audit zinciri.

    `version` optimistic concurrency icindir: agent mutasyonlari
    bekledikleri surumu gonderir, bayat guncelleme
    `ticket_version_conflict` alir (02 §9).
    """

    __tablename__ = "tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number = Column(BigInteger, nullable=False)

    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    source_tenant_row_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_source_tenants.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    # Kaynakta uretilen, retry'larda DEGISMEYEN kimlik (02 §2).
    source_ticket_id = Column(String(128), nullable=False)

    # Requester ANLIK GORUNTUSU — support iletisimi icin gereken kadar
    # (05 §4 veri minimizasyonu). Otorite kaynak uygulamadadir.
    requester_source_user_id = Column(String(128), nullable=False,
                                      index=True)
    requester_display_name = Column(String(200), nullable=True)
    requester_email = Column(String(255), nullable=True)

    title = Column(String(200), nullable=False)
    category = Column(String(30), nullable=False, index=True)
    impact = Column(String(30), nullable=False)
    priority = Column(String(10), nullable=False, default="normal",
                      index=True)

    reproduction_steps = Column(Text, nullable=True)
    expected_result = Column(Text, nullable=True)
    actual_result = Column(Text, nullable=True)
    error_code = Column(String(80), nullable=True)
    correlation_id = Column(String(64), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=True)
    client_context_json = Column(
        JSONB, nullable=False, default=dict,
        server_default=text("'{}'::jsonb"),
    )

    status = Column(String(20), nullable=False, default="open", index=True)

    assigned_group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    # Yalnizca GOSTERIM icin; yetkilendirme ASLA snapshot'a bakmaz
    # (D-005: grup uyeligi CANLI kuraldir).
    assigned_group_name_snapshot = Column(String(255), nullable=True)
    assigned_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    route_version = Column(Integer, nullable=False, default=1)

    first_response_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    last_public_activity_at = Column(DateTime(timezone=True), nullable=True)

    # FK DEGIL (bilincli): tickets ↔ ticket_resolutions arasinda dairesel
    # bir FK, create_all/migration sirasini kirilgan yapar. Butunluk
    # servis katmaninda ve `ticket_resolutions.ticket_id` FK'siyle zaten
    # saglanir.
    current_resolution_id = Column(UUID(as_uuid=True), nullable=True)
    resolution_revision = Column(Integer, nullable=False, default=0)

    duplicate_of_ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=True,
    )

    version = Column(Integer, nullable=False, default=1)
    event_sequence = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)
    archived_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_tickets_number"),
        # Ayni kaynak ticket'i IKI kez canonical olamaz — duplicate
        # create'e karsi son savunma (idempotency katmanindan bagimsiz).
        UniqueConstraint(
            "tenant_id", "application_id", "source_tenant_row_id",
            "source_ticket_id", name="uq_tickets_source_identity",
        ),
        CheckConstraint(
            _in_list("status", STATUSES),
            name="chk_tickets_status",
        ),
        CheckConstraint(
            _in_list("category", CATEGORIES),
            name="chk_tickets_category",
        ),
        CheckConstraint(
            _in_list("impact", IMPACTS),
            name="chk_tickets_impact",
        ),
        CheckConstraint(
            _in_list("priority", PRIORITIES),
            name="chk_tickets_priority",
        ),
        CheckConstraint("version >= 1", name="chk_tickets_version_min"),
        Index(
            "idx_tickets_app_status_updated",
            "tenant_id", "application_id", "status",
            text("updated_at DESC"),
        ),
        Index(
            "idx_tickets_group_status_updated",
            "tenant_id", "assigned_group_id", "status",
            text("updated_at DESC"),
        ),
        Index(
            "idx_tickets_assignee_status",
            "tenant_id", "assigned_user_id", "status",
        ),
        Index(
            "idx_tickets_requester_created",
            "tenant_id", "source_tenant_row_id",
            "requester_source_user_id", text("created_at DESC"),
        ),
        Index("idx_tickets_error_code", "tenant_id", "error_code"),
        Index("idx_tickets_correlation", "tenant_id", "correlation_id"),
    )


# =============================================================================
# ticket_messages — conversation
# =============================================================================

class TicketMessage(TenantOwnedMixin, Base):
    """Ilk description dahil TUM conversation ogeleri.

    `visibility` public/internal ayrimini TEK alanda tutar; iki ayri
    tablo yerine tek tablo + serializer ayrimi tercih edildi (Zendesk
    deseni). Sizinti riski serializer katmaninda YAPISAL testle
    kilitlenir.

    Update/delete YOKTUR (02 §6): duzeltme yeni mesajla yapilir.
    """

    __tablename__ = "ticket_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    sequence = Column(Integer, nullable=False)
    visibility = Column(String(10), nullable=False, index=True)
    author_type = Column(String(20), nullable=False)
    author_user_id = Column(UUID(as_uuid=True), nullable=True)
    author_source_user_id = Column(String(128), nullable=True)
    author_display_name = Column(String(200), nullable=True)
    body = Column(Text, nullable=False)
    body_format = Column(String(10), nullable=False, default="plain")
    # Kaynak tarafinda uretilen mesaj kimligi — retry'da ikinci kez
    # yazilmasini engeller.
    source_message_id = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "ticket_id", "sequence",
            name="uq_ticket_messages_sequence",
        ),
        UniqueConstraint(
            "tenant_id", "ticket_id", "source_message_id",
            name="uq_ticket_messages_source",
        ),
        CheckConstraint(
            _in_list("visibility", MESSAGE_VISIBILITY),
            name="chk_ticket_messages_visibility",
        ),
        CheckConstraint(
            _in_list("author_type", AUTHOR_TYPES),
            name="chk_ticket_messages_author_type",
        ),
        CheckConstraint(
            _in_list("body_format", MESSAGE_FORMATS),
            name="chk_ticket_messages_format",
        ),
        # Requester ASLA internal not yazamaz — sema seviyesinde de
        # imkansiz (05: internal sizinti tehdidi).
        CheckConstraint(
            "author_type <> 'requester' OR visibility = 'public'",
            name="chk_ticket_messages_requester_public_only",
        ),
        Index(
            "idx_ticket_messages_ticket_created",
            "tenant_id", "ticket_id", "created_at",
        ),
    )


# =============================================================================
# ticket_resolutions — revizyonlu cozum
# =============================================================================

class TicketResolution(TenantOwnedMixin, Base):
    """Her resolve YENI bir revizyon uretir; reopen sonrasi eski cozum
    history'de KALIR (02 §7)."""

    __tablename__ = "ticket_resolutions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    revision = Column(Integer, nullable=False)
    resolution_code = Column(String(30), nullable=False)
    public_summary = Column(Text, nullable=False)
    public_workaround = Column(Text, nullable=True)
    fix_version = Column(String(120), nullable=True)
    # Varsayilan olarak MUSTERIYE GITMEZ (05 §4).
    internal_root_cause = Column(Text, nullable=True)
    resolved_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    resolved_by_display_name = Column(String(200), nullable=True)
    resolved_at = Column(DateTime(timezone=True), default=_now,
                         nullable=False)
    superseded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "ticket_id", "revision",
            name="uq_ticket_resolutions_revision",
        ),
        CheckConstraint(
            _in_list("resolution_code", RESOLUTION_CODES),
            name="chk_ticket_resolutions_code",
        ),
        CheckConstraint("revision >= 1",
                        name="chk_ticket_resolutions_revision_min"),
    )


# =============================================================================
# ticket_attachments — metadata (BINARY DB'DE DEGIL)
# =============================================================================

class TicketAttachment(TenantOwnedMixin, Base):
    """Object storage'daki nesnenin metadata'si.

    `ticket_id` BASLANGICTA NULL'dur: upload once staging/quarantine
    olarak acilir, taranir, sonra bir ticket/mesaj/cozume BAGLANIR
    (Zendesk upload-handle deseni). Boylece ticket yazilmadan once
    dosya kabul edilebilir ve reddedilen dosya ticket'i dusurmez.
    """

    __tablename__ = "ticket_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )
    message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ticket_messages.id", ondelete="RESTRICT"),
        nullable=True,
    )
    resolution_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ticket_resolutions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    source_tenant_row_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_source_tenants.id", ondelete="RESTRICT"),
        nullable=True,
    )

    visibility = Column(String(10), nullable=False, default="public")
    uploader_type = Column(String(30), nullable=False)
    uploader_id = Column(String(128), nullable=True)

    # Filename yalnizca GOSTERIM metadata'sidir; object key rastgeledir.
    file_name = Column(String(255), nullable=False)
    object_key = Column(String(400), nullable=False)
    declared_mime_type = Column(String(120), nullable=True)
    detected_mime_type = Column(String(120), nullable=True)
    size_bytes = Column(BigInteger, nullable=False, default=0)
    sha256 = Column(String(64), nullable=True)

    scan_status = Column(String(20), nullable=False, default="pending_scan",
                         index=True)
    scan_engine = Column(String(40), nullable=True)
    scan_error_code = Column(String(60), nullable=True)
    scanned_at = Column(DateTime(timezone=True), nullable=True)

    uploaded_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    attached_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "object_key", name="uq_ticket_attachments_key",
        ),
        CheckConstraint(
            _in_list("scan_status", ATTACHMENT_SCAN_STATUSES),
            name="chk_ticket_attachments_scan_status",
        ),
        CheckConstraint(
            _in_list("visibility", ATTACHMENT_VISIBILITY),
            name="chk_ticket_attachments_visibility",
        ),
        # En fazla TEK sahip: ya mesaj ya cozum (ya da yalnizca ticket).
        CheckConstraint(
            "NOT (message_id IS NOT NULL AND resolution_id IS NOT NULL)",
            name="chk_ticket_attachments_single_owner",
        ),
        CheckConstraint(
            "attached_at IS NULL OR ticket_id IS NOT NULL",
            name="chk_ticket_attachments_attached_needs_ticket",
        ),
        CheckConstraint("size_bytes >= 0",
                        name="chk_ticket_attachments_size"),
        Index(
            "idx_ticket_attachments_ticket",
            "tenant_id", "ticket_id", "created_at",
        ),
    )


# =============================================================================
# ticket_events — immutable audit / domain event
# =============================================================================

class TicketEvent(TenantOwnedMixin, Base):
    """Append-only olay akisi. Mesaj GOVDESI kopyalanmaz — yalnizca
    referans (05 §8)."""

    __tablename__ = "ticket_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    sequence = Column(Integer, nullable=False)
    event_type = Column(String(60), nullable=False, index=True)
    aggregate_version = Column(Integer, nullable=False, default=1)
    actor_type = Column(String(30), nullable=False)
    actor_id = Column(String(128), nullable=True)
    actor_display_name = Column(String(200), nullable=True)
    reason = Column(Text, nullable=True)
    metadata_json = Column(
        JSONB, nullable=False, default=dict,
        server_default=text("'{}'::jsonb"),
    )
    correlation_id = Column(String(64), nullable=True)
    occurred_at = Column(DateTime(timezone=True), default=_now,
                         nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "ticket_id", "sequence",
            name="uq_ticket_events_sequence",
        ),
        CheckConstraint(
            _in_list("actor_type", ACTOR_TYPES),
            name="chk_ticket_events_actor_type",
        ),
        Index(
            "idx_ticket_events_ticket_seq",
            "tenant_id", "ticket_id", "sequence",
        ),
    )


# =============================================================================
# ticket_outbox_events — giden webhook kuyrugu
# =============================================================================

class TicketOutboxEvent(TenantOwnedMixin, Base):
    """Canonical mutasyonla AYNI transaction'da yazilan giden olay.

    `payload_json` YALNIZCA musteri-guvenli anligi tasir; internal not
    ve root cause buraya GIREMEZ (ticket_event_service tek uretici,
    yapisal testle kilitli).
    """

    __tablename__ = "ticket_outbox_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), nullable=False,
                      default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    event_type = Column(String(60), nullable=False)
    sequence = Column(Integer, nullable=False)
    aggregate_version = Column(Integer, nullable=False, default=1)
    payload_json = Column(JSONB, nullable=False)
    correlation_id = Column(String(64), nullable=True)

    status = Column(String(16), nullable=False, default="pending",
                    index=True)
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime(timezone=True), default=_now,
                             nullable=False, index=True)
    last_error_code = Column(String(60), nullable=True)
    last_status_code = Column(Integer, nullable=True)
    locked_at = Column(DateTime(timezone=True), nullable=True)
    locked_by = Column(String(64), nullable=True)

    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    dead_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "event_id", name="uq_ticket_outbox_event_id",
        ),
        CheckConstraint(
            _in_list("status", DELIVERY_STATUSES),
            name="chk_ticket_outbox_status",
        ),
        Index(
            "idx_ticket_outbox_due",
            "tenant_id", "status", "next_attempt_at",
        ),
    )


# =============================================================================
# ticket_delivery_attempts — her HTTP denemesinin guvenli kaydi
# =============================================================================

class TicketDeliveryAttempt(TenantOwnedMixin, Base):
    """Yanit GOVDESI saklanmaz: yalnizca status, hata kodu, sure."""

    __tablename__ = "ticket_delivery_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    outbox_event_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ticket_outbox_events.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    attempt_number = Column(Integer, nullable=False)
    result = Column(String(16), nullable=False)
    http_status = Column(Integer, nullable=True)
    error_code = Column(String(60), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    triggered_by = Column(String(20), nullable=False, default="scheduler")
    actor_id = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False, index=True)

    __table_args__ = (
        CheckConstraint(
            "result IN ('delivered', 'retry', 'dead')",
            name="chk_ticket_delivery_result",
        ),
        CheckConstraint(
            "triggered_by IN ('scheduler', 'manual')",
            name="chk_ticket_delivery_trigger",
        ),
    )


# =============================================================================
# ticket_idempotency_records — inbox / replay
# =============================================================================

class TicketIdempotencyRecord(TenantOwnedMixin, Base):
    """`(owner, key)` benzersiz; ayni key + AYNI govde saklanan yaniti
    doner, FARKLI govde `idempotency_conflict` uretir (06 §1).

    Rezervasyon deseni: is mantigi CALISMADAN once satir yazilir, boylece
    yarisan iki istek ayni canonical ticket'i IKI kez uretemez.
    """

    __tablename__ = "ticket_idempotency_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_type = Column(String(24), nullable=False)
    owner_id = Column(String(64), nullable=False)
    key = Column(String(128), nullable=False)
    route = Column(String(160), nullable=False)
    request_hash = Column(String(64), nullable=False)
    response_status = Column(Integer, nullable=True)
    response_body = Column(JSONB, nullable=True)
    ticket_id = Column(UUID(as_uuid=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "owner_type", "owner_id", "key",
            name="uq_ticket_idempotency_owner_key",
        ),
        CheckConstraint(
            "owner_type IN ('integration_client', 'tenant_user')",
            name="chk_ticket_idempotency_owner_type",
        ),
    )


# =============================================================================
# support_audit_events — ticket DISI yonetim/konfigurasyon audit'i
# =============================================================================

class SupportAuditEvent(TenantOwnedMixin, Base):
    """Route/application/credential/delivery islemlerinin append-only
    kaydi. Ticket'a bagli olaylar `ticket_events`te yasar; burasi
    ticket'a baglanamayan yonetim islemleri icindir (05 §8)."""

    __tablename__ = "support_audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_type = Column(String(40), nullable=False, index=True)
    subject_id = Column(String(64), nullable=True)
    action = Column(String(60), nullable=False, index=True)
    actor_type = Column(String(30), nullable=False)
    actor_id = Column(String(128), nullable=True)
    actor_display_name = Column(String(200), nullable=True)
    reason = Column(Text, nullable=True)
    metadata_json = Column(
        JSONB, nullable=False, default=dict,
        server_default=text("'{}'::jsonb"),
    )
    correlation_id = Column(String(64), nullable=True)
    source_ip = Column(String(45), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False, index=True)

    __table_args__ = (
        CheckConstraint(
            _in_list("actor_type", ACTOR_TYPES),
            name="chk_support_audit_actor_type",
        ),
    )


# Migration ve testlerin kullandigi OTORITER liste. Elle tutulan tek
# yer burasi ve tek amaci "bu revizyonun YARATTIGI tablolar" demektir;
# RLS/politika kapsami yine `TenantOwnedMixin`den turetilir.
class TicketDownloadGrant(TenantOwnedMixin, Base):
    """Tek kullanimlik, kisa omurlu indirme izni.

    NEDEN VAR: kaynak uygulama (LogiSlot) kendi kullanicisinin
    TARAYICISINI indirme adresine yonlendirir; tarayicida Hermes bearer
    token'i YOKTUR. Bearer isteyen bir uc bu akista kullanilamaz.

    NE **DEGILDIR**: object storage'in imzali URL'i. Depo private kalir
    ve disariya hic acilmaz; bu izin YALNIZCA Hermes'in kendi ucunda
    gecerlidir ve baytlar yine Hermes uzerinden akar. Yani "kalici/imzali
    URL yok" kuralinin amaci (yetki kontrolu Hermes'te kalsin, depo
    disariya acilmasin) korunur.

    Sinirlar tasarimin PARCASI: tek kullanim (`used_at`), kisa TTL,
    tek bir eke bagli ve veren client'a bagli. Token'in KENDISI DB'de
    DEGILDIR — yalnizca SHA-256 ozeti tutulur.
    """

    __tablename__ = "ticket_download_grants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attachment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ticket_attachments.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_applications.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    source_tenant_row_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_source_tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    #: SHA-256(token) — token'in duz hali HICBIR YERDE saklanmaz.
    token_hash = Column(String(64), nullable=False, index=True)
    issued_to_client_id = Column(String(64), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)


TICKETING_TABLES = (
    "support_applications",
    "support_source_tenants",
    "support_ticket_routes",
    "support_integration_clients",
    "support_integration_tokens",
    "tickets",
    "ticket_messages",
    "ticket_resolutions",
    "ticket_attachments",
    "ticket_events",
    "ticket_outbox_events",
    "ticket_delivery_attempts",
    "ticket_idempotency_records",
    "support_audit_events",
    "ticket_download_grants",
)
