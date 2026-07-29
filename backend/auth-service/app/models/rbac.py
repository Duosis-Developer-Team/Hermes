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
    """Dinamik rol: izin kumesi tasiyan, runtime'da yonetilen kayit."""

    __tablename__ = "rbac_roles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stabil, degismez slug — programatik esletirmelerin tek anahtari.
    code = Column(String(64), nullable=False, unique=True, index=True)
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
        UniqueConstraint("user_id", "role_id",
                         name="uq_rbac_user_roles_user_role"),
    )
