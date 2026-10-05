# =============================================================================
# HERMES - Proje turu (Destek, Talep, Proje...)
# =============================================================================
# Tenant'in kendi tanimladigi proje siniflandirmasi. Iki is yapar:
#   - Efor girisinde projeler ture gore alt basliklar altinda listelenir.
#   - Turun RENGI, projenin jenerik logosunun rengidir (renk + glif).
#
# Renk serbest hex DEGIL: app/project_type_catalog.PROJECT_TYPE_COLORS
# anahtarlarindan biri (gecerlilik serviste dogrulanir; sozluk buyurse
# migration gerekmesin diye DB CHECK'i yok).
#
# Ad tenant icinde buyuk/kucuk harf duyarsiz tekil (ifadeli benzersiz
# index); enforce fazi onu (tenant_id, lower(name))'e cevirir.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


class ProjectType(TenantOwnedMixin, Base):
    """Bir proje turu: ad + renk anahtari."""

    __tablename__ = "project_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    color = Column(String(16), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    __table_args__ = (
        Index("uq_project_types_tenant_name", "tenant_id", func.lower(name), unique=True),
    )

    def __repr__(self) -> str:
        return f"<ProjectType(id={self.id}, name='{self.name}', color='{self.color}')>"


# Migration kapsami (0016): create_all(tables=...) + apply_enforce(only=...).
PROJECT_TYPE_TABLES = ("project_types",)
