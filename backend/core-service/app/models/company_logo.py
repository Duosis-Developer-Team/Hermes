# =============================================================================
# HERMES - Sirket hesabi logosu (docs/tenant-platform/01) — KULLANILMIYOR
# =============================================================================
# 0027'den beri sirket hesabi bir MUSTERI KAYDINA baglanir; ad ve logo
# `customers`/`customer_logos`tan gelir. Yukleme uclari kaldirildi. Tablo
# yalniz additive kurali geregi durur (0025 olusturdu; dusurmek veri
# silmektir) — yeni kod bu modeli KULLANMAZ.
# Musteri logosuyla AYNI kurallar (services/logo_image): PNG/JPEG/WEBP,
# 256 KB, sihirli bayt eslesmesi, SVG yok. Sirket hesabi auth'ta yasar;
# burada hesabin kimligine MANTIKSAL referans tutulur (fiziksel FK yok —
# mikroservis kurali). Hesap basina EN FAZLA bir satir.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base
from .logo_image import logo_check_constraints
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


class CompanyLogo(TenantOwnedMixin, Base):
    __tablename__ = "company_logos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    content = Column(LargeBinary, nullable=False)
    content_type = Column(String(32), nullable=False)
    etag = Column(String(64), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "account_id", name="uq_company_logos_account"),
        *logo_check_constraints("company_logos"),
    )


COMPANY_LOGO_TABLES = ("company_logos",)
