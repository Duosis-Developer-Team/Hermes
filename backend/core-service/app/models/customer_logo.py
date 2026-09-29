# =============================================================================
# HERMES - Musteri logosu (opsiyonel marka gorseli)
# =============================================================================
# Musteri basina EN FAZLA bir satir. Baytlar dogrudan veritabaninda tutulur:
# 256 KB tavanli kucuk bir gorsel icin object storage (karantina/tarama
# hatti) gereksiz agirlik olurdu; tavan hem serviste hem DB CHECK'inde.
#
# Guvenlik:
#   - Yalnizca PNG / JPEG / WEBP. SVG YOK: ayni origin'den sunulan SVG
#     script tasiyabilir (stored XSS).
#   - Beyan edilen tip ile sihirli baytlar eslesmek ZORUNDA
#     (customer_logo_service.sniff).
#   - Musteri silinince logo da gider: FK ON DELETE CASCADE; enforce fazi
#     FK'yi (tenant_id, customer_id) composite'ine cevirir — baska
#     tenant'in musterisine logo YAZILAMAZ.
#
# `id` kolonu bilincli: enforce fazi her tenant tablosuna
# UNIQUE (tenant_id, id) ekler; musteri tekilligi ayri UNIQUE ile saglanir.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, LargeBinary, String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base
from .mixins import TenantOwnedMixin

# Tek kaynak: servis ve DB CHECK'i ayni sabiti kullanir.
CUSTOMER_LOGO_MAX_BYTES = 256 * 1024
CUSTOMER_LOGO_CONTENT_TYPES = ("image/png", "image/jpeg", "image/webp")


def _now():
    return datetime.now(timezone.utc)


class CustomerLogo(TenantOwnedMixin, Base):
    """Bir musterinin logosu (bytea + tip + sha256 etag)."""

    __tablename__ = "customer_logos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    content = Column(LargeBinary, nullable=False)
    content_type = Column(String(32), nullable=False)
    # sha256 hex (64 karakter) — HTTP ETag'in govdesi.
    etag = Column(String(64), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False,
    )
    # auth_db.users'a MANTIKSAL referans (mikroservis kurali: fiziksel FK yok).
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("customer_id", name="uq_customer_logos_customer"),
        CheckConstraint(
            f"octet_length(content) > 0 AND octet_length(content) <= {CUSTOMER_LOGO_MAX_BYTES}",
            name="chk_customer_logos_size",
        ),
        CheckConstraint(
            "content_type IN ("
            + ", ".join(f"'{t}'" for t in CUSTOMER_LOGO_CONTENT_TYPES)
            + ")",
            name="chk_customer_logos_content_type",
        ),
        CheckConstraint("char_length(etag) = 64", name="chk_customer_logos_etag"),
    )


# Migration kapsami (0014): create_all(tables=...) + apply_enforce(only=...).
CUSTOMER_LOGO_TABLES = ("customer_logos",)
