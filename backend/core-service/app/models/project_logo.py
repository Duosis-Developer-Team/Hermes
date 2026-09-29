# =============================================================================
# HERMES - Proje logosu (opsiyonel marka gorseli)
# =============================================================================
# customer_logos'un birebir aynasi (0014 deseni), anahtar proje:
#   - Proje basina EN FAZLA bir satir; baytlar veritabaninda (256 KB tavan
#     hem serviste hem DB CHECK'inde — logo_image tek kaynak).
#   - Yalnizca PNG / JPEG / WEBP; SVG YOK. Beyan edilen tip ile sihirli
#     baytlar eslesmek ZORUNDA (services/logo_image.validate).
#   - Proje silinince logo da gider: FK ON DELETE CASCADE; enforce fazi
#     FK'yi (tenant_id, project_id) composite'ine cevirir — baska tenant'in
#     projesine logo YAZILAMAZ.
#
# `id` kolonu bilincli: enforce fazi her tenant tablosuna
# UNIQUE (tenant_id, id) ekler; proje tekilligi ayri UNIQUE ile saglanir.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, ForeignKey, LargeBinary, String, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base
from .logo_image import LOGO_CONTENT_TYPES, LOGO_MAX_BYTES, logo_check_constraints
from .mixins import TenantOwnedMixin

PROJECT_LOGO_MAX_BYTES = LOGO_MAX_BYTES
PROJECT_LOGO_CONTENT_TYPES = LOGO_CONTENT_TYPES


def _now():
    return datetime.now(timezone.utc)


class ProjectLogo(TenantOwnedMixin, Base):
    """Bir projenin logosu (bytea + tip + sha256 etag)."""

    __tablename__ = "project_logos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
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
        UniqueConstraint("project_id", name="uq_project_logos_project"),
        *logo_check_constraints("project_logos"),
    )


# Migration kapsami (0015): create_all(tables=...) + apply_enforce(only=...).
PROJECT_LOGO_TABLES = ("project_logos",)
