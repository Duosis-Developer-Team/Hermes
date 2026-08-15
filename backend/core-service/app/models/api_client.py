# =============================================================================
# HERMES - Public API client / token / access / audit modelleri (Stage 2A)
# =============================================================================
# Onaylanan tasarim (hermes_developer_platform_plan.md):
#   - api_clients        : dis entegrasyon istemcisi; scope'lar ve data-access
#                          binding'leri CLIENT uzerindedir (onay #2).
#   - api_tokens         : SAF credential — prefix + SHA-256 hash + omur.
#                          Plaintext ASLA saklanmaz (onay #1: SHA-256).
#   - api_client_access  : object-level erisim binding'leri (union).
#   - api_request_logs   : public istek audit kaydi (govde YOK).
#
# Tum tablolar YENIdir — startup'taki create_all olusturur; mevcut hicbir
# tabloya ALTER uygulanmaz.
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

from .mixins import TenantOwnedMixin
from ..database import Base


class ApiClient(TenantOwnedMixin, Base):
    """Dis entegrasyon istemcisi (service account veya user-bound).

    Izin modeli iki katmandir ve IKISI de client uzerinde yasar:
      - scopes  : operasyon kategorisi izinleri (scope katalogundan)
      - access  : object-level veri erisimi (ApiClientAccess satirlari)
    Token'lar yalnizca kimlik dogrulama malzemesidir; rotate edildiginde
    izinler degismez.
    """

    __tablename__ = "api_clients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

    # 'service' → sunucudan sunucuya entegrasyon;
    # 'user'    → belirli bir Hermes kullanicisi adina calisir ve o
    #             kullanicinin gorebildiginden fazlasini ASLA goremez.
    client_type = Column(String(10), nullable=False, default="service")
    bound_user_id = Column(UUID(as_uuid=True), nullable=True)

    # Token'in calisabilecegi ortam: dev token'i live'da (ve tersi)
    # calismaz — dogrulama zincirinde PUBLIC_API_ENV ile karsilastirilir.
    environment = Column(String(10), nullable=False, default="dev")

    scopes = Column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    # null → deployment default'u (60 req/dk).
    rate_limit_per_min = Column(Integer, nullable=True)

    status = Column(String(10), nullable=False, default="active")
    created_by = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_api_clients_name"),
        CheckConstraint(
            "client_type IN ('service', 'user')",
            name="chk_api_clients_type",
        ),
        CheckConstraint(
            "environment IN ('dev', 'live')",
            name="chk_api_clients_environment",
        ),
        CheckConstraint(
            "status IN ('active', 'disabled')",
            name="chk_api_clients_status",
        ),
        # Amendment #6: user-bound client'ta bagli kullanici zorunlu.
        CheckConstraint(
            "client_type <> 'user' OR bound_user_id IS NOT NULL",
            name="chk_api_clients_user_requires_binding",
        ),
        CheckConstraint(
            "rate_limit_per_min IS NULL OR rate_limit_per_min > 0",
            name="chk_api_clients_rate_limit_positive",
        ),
    )


class ApiToken(TenantOwnedMixin, Base):
    """API token credential'i. Plaintext token ("hms_env_...") YALNIZCA
    olusturma/rotate aninda bir kez gosterilir; burada yalnizca SHA-256
    hex hash'i ve gosterim icin prefix saklanir (amendment #2: indexed
    lookup + sabit-zamanli karsilastirma dogrulama katmanindadir)."""

    __tablename__ = "api_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(
        UUID(as_uuid=True),
        ForeignKey("api_clients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    token_prefix = Column(String(16), nullable=False)
    token_hash = Column(String(64), nullable=False)

    status = Column(String(10), nullable=False, default="active")
    expires_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    last_used_ip = Column(String(45), nullable=True)
    # Amendment #4: rotation izlenebilirligi — yeni token eskiyi isaret eder.
    rotated_from_token_id = Column(
        UUID(as_uuid=True),
        ForeignKey("api_tokens.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_api_tokens_hash"),
        CheckConstraint(
            "status IN ('active', 'revoked')",
            name="chk_api_tokens_status",
        ),
    )


class ApiClientAccess(TenantOwnedMixin, Base):
    """Object-level veri erisim binding'i. Satirlar UNION olusturur.

    Kurallar (amendment #5/#6 — service + schema katmaninda da dogrulanir):
      - 'global' binding baska binding'lerle BIRLIKTE bulunamaz.
      - 'global' disindaki her satirda target_id zorunlu; global'de yasak.
      - Hic binding olmamasi = hic veri (fail closed).
    """

    __tablename__ = "api_client_access"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(
        UUID(as_uuid=True),
        ForeignKey("api_clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    access_type = Column(String(10), nullable=False)
    target_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "access_type IN ('global', 'user', 'group', 'customer', 'project')",
            name="chk_api_client_access_type",
        ),
        # global ↔ target_id iliskisi iki yonlu zorunlu.
        CheckConstraint(
            "(access_type = 'global' AND target_id IS NULL) OR "
            "(access_type <> 'global' AND target_id IS NOT NULL)",
            name="chk_api_client_access_target",
        ),
        UniqueConstraint(
            "client_id",
            "access_type",
            "target_id",
            name="uq_api_client_access_binding",
        ),
        # Postgres UNIQUE, NULL'lari ayri sayar — global satirin tekilligi
        # icin partial unique index gerekir.
        Index(
            "uq_api_client_access_global",
            "client_id",
            unique=True,
            postgresql_where=text("access_type = 'global'"),
        ),
    )


class ApiRequestLog(TenantOwnedMixin, Base):
    """Public API istek audit kaydi. Istek/yanit GOVDESI, Authorization
    header'i veya token degeri ASLA yazilmaz (amendment #10)."""

    __tablename__ = "api_request_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    request_id = Column(String(64), nullable=False)
    client_id = Column(UUID(as_uuid=True), nullable=True)
    token_id = Column(UUID(as_uuid=True), nullable=True)
    method = Column(String(8), nullable=False)
    # Normalize route sablonu (orn. /v1/tasks/{task_code}) — ham URL degil.
    path = Column(String(255), nullable=False)
    status_code = Column(Integer, nullable=False)
    duration_ms = Column(Integer, nullable=False)
    source_ip = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)
    rate_limited = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_api_request_logs_created", "created_at"),
        Index("idx_api_request_logs_client", "client_id", "created_at"),
    )


class ApiIdempotencyKey(TenantOwnedMixin, Base):
    """Public API POST idempotency kaydi (rezervasyon deseni).

    Akis: is mantigi CALISMADAN once (client_id, key) satiri INSERT edilir
    (rezervasyon; response_status NULL). Ayni anahtarla yarisan ikinci
    istek unique constraint'e takilir ve ya replay alir ya 409 doner —
    ayni is kaydinin IKI kez olusmasi imkansizlasir. Is mantigi bitince
    satir yanit anligiyla guncellenir; is mantigi patlarsa rezervasyon
    silinir (anahtar yeniden kullanilabilir).

    Saklanan yanit anligi YALNIZCA public sema govdesidir — Authorization,
    cookie, token, hash veya internal hata detayi tasiyamaz (yazan taraf
    public serializer ciktisidir). 24 saatlik TTL okuma aninda uygulanir;
    fiziksel temizlik retention backlog'undadir.
    """

    __tablename__ = "api_idempotency_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(
        UUID(as_uuid=True),
        ForeignKey("api_clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key = Column(String(128), nullable=False)
    request_hash = Column(String(64), nullable=False)
    # NULL → istek halen isleniyor (rezervasyon).
    response_status = Column(Integer, nullable=True)
    response_body = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "client_id", "key", name="uq_api_idempotency_client_key"
        ),
    )


class ApiCleanupRun(TenantOwnedMixin, Base):
    """Stage 3F operasyonel temizlik kaydi. Admin panelinde "son temizlik"
    gorunurlugu buradan okunur. SANITIZE edilmis: SQL detayi, satir
    icerigi veya hata mesaji TASIMAZ — yalnizca sayilar + hata SINIFI."""

    __tablename__ = "api_cleanup_runs"

    id = Column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    started_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    dry_run = Column(Boolean, nullable=False, default=False)
    trigger = Column(String(16), nullable=False, default="manual")
    # success | failed
    status = Column(String(16), nullable=False)
    request_logs_deleted = Column(Integer, nullable=False, default=0)
    idempotency_keys_deleted = Column(Integer, nullable=False, default=0)
    batches = Column(Integer, nullable=False, default=0)
    # Yalnizca exception SINIF adi (orn. OperationalError) — detay yok.
    failure_class = Column(String(64), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
