# =============================================================================
# HERMES auth — Modul erisimi (auth 0007)
# =============================================================================
# Tenant modulleri (super-admin, tenants.enabled_modules) TAVANDIR; bu iki
# tablo tavanin ALTINDA kimin hangi modulu gordugunu belirler:
#   tenant_module_policies — modul basina `everyone` (satir yoksa TRUE:
#       tum IC kullanicilar; bugunku davranis). Sirket hesaplarini KAPSAMAZ.
#   tenant_module_grants   — acik kurallar: kullanici (sirket hesabi dahil)
#       ya da grup (core_db `user_groups`; kimlik opak tutulur).
# Cozum: services/module_access.py.
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
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base


def _now():
    return datetime.now(timezone.utc)


MODULE_ACCESS_TABLES = ("tenant_module_policies", "tenant_module_grants")
PRINCIPAL_TYPES = ("user", "group")


class TenantModulePolicy(Base):
    __tablename__ = "tenant_module_policies"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
                       primary_key=True)
    module = Column(String(40), primary_key=True)
    everyone = Column(Boolean, nullable=False, default=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class TenantModuleGrant(Base):
    __tablename__ = "tenant_module_grants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
                       nullable=False)
    module = Column(String(40), nullable=False)
    principal_type = Column(String(10), nullable=False)
    principal_id = Column(UUID(as_uuid=True), nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "module", "principal_type", "principal_id",
                         name="uq_tenant_module_grants_principal"),
        CheckConstraint("principal_type IN ('user','group')",
                        name="chk_tenant_module_grants_principal_type"),
        Index("idx_tenant_module_grants_principal", "tenant_id", "principal_type", "principal_id"),
    )
