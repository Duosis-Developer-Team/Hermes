# =============================================================================
# HERMES Auth Service - RBAC modelleri (additive, create_all ile gelir)
# =============================================================================
# Tasarim (CTO onayli, 17.07.2026):
#   - Rol dogrudan KULLANICIYA atanir (Hermes'te tenant/facility boyutu
#     yok — LogiSlot'un membership katmani bilerek alinmadi).
#   - Izinler ayri tablo degil, rolun ustunde JSONB listesi (LogiSlot
#     deseni). Efektif izin = aktif rollerin birlesimi; deny yok.
#   - `code` STABIL slug'dir: seed/migration/bootstrap esletirmeleri HEP
#     code ile yapilir (LogiSlot'un isimle-esletirme kirilganligi ders).
#   - is_system=True → ad/izin/aktiflik kilitli, silinemez (yalnizca
#     aciklama duzenlenebilir).
#   - Mevcut hicbir tablo/sutun DEGISMEZ; users.is_admin turetilmis hale
#     gelir (rbac_service.sync_is_admin) ama sutun yerinde kalir.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..database import Base


def _now():
    return datetime.now(timezone.utc)


class RbacRole(Base):
    """Dinamik rol: izin kumesi tasiyan, runtime'da yonetilen kayit.

    WS2'den itibaren rol TENANT'A AITTIR. `system-admin` artik "global
    Hermes yoneticisi" degil, o tenant'in yoneticisidir; Platform Super
    Admin AYRI bir guvenlik duzlemidir (`platform_admins`).
    """

    __tablename__ = "rbac_roles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # WS2 expand fazinda NULLABLE: mevcut satirlarin tenant'i 0003
    # backfill'inde yazilir, NOT NULL 0004'te verilir.
    #
    # FK modelde BILEREK tanimli DEGIL: sema fazlari (expand → backfill
    # → enforce) migration'larda yasar. FK'yi modele koymak, cutover
    # ONCESI semayi kuran 0001_baseline'i henuz var olmayan `tenants`
    # tablosuna bagimli kilardi. Gercek kisit 0004'te eklenir.
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # Stabil, degismez slug — programatik esletirmelerin tek anahtari.
    # Benzersizlik TENANT ICINDEDIR (uq_rbac_roles_tenant_code, 0004);
    # ayni `system-admin` kodu her tenant'ta ayri bir satirdir.
    code = Column(String(64), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # shared/permissions.py katalogundan kod listesi. Katalog disi
    # degerler yazimda 422; okuma yolunda ayrica filtrelenir.
    permissions = Column(JSONB, nullable=False, default=list)
    is_system = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)


class RbacUserRole(Base):
    """Kullanici ↔ rol atamasi (N-M)."""

    __tablename__ = "rbac_user_roles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Atama da tenant-scoped'tir: ayni kimlik A'da admin, B'de member
    # olabilir. 0004'te (tenant_id, user_id) uyelige composite FK ile
    # baglanir — baska tenant'in uyesine rol verilemez. FK'nin modelde
    # olmama gerekcesi icin RbacRole.tenant_id notuna bakin.
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role_id = Column(
        UUID(as_uuid=True),
        ForeignKey("rbac_roles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), default=_now,
                        nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        # Tenant-qualified benzersizlik (0004'te eski global kisit
        # dusurulur): ayni kullanici, ayni rolu iki kez alamaz — ama
        # bu kural her tenant icinde AYRI isler.
        UniqueConstraint("tenant_id", "user_id", "role_id",
                         name="uq_rbac_user_roles_tenant_user_role"),
    )
