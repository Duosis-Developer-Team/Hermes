# =============================================================================
# HERMES - Kapasite modeli (PM rework P0 / D1)
# =============================================================================
# "Beklenen efor" bilgisinin TEK kaynagi. Efor seridi (D2) bir gunu ancak
# su uc soruya cevap verebiliyorsa "eksik" sayabilir:
#   - o gun calisma gunu mu?         -> tenant varsayilani + kullanici override
#   - o gun tatil mi?                -> tenant tatil takvimi
#   - kisi o gun izinli mi?          -> kullanici izin kaydi
# Bunlarin hicbiri sema'da yoktu; efor ekrani 8h/40h'i sabit koda gomuyordu.
#
# NEDEN plan_times'a `plan_type` eklenmedi (04-roller §8'in onerisi):
# plan_times.customer_id ve project_id NOT NULL — bir izin kaydinin
# musterisi/projesi yoktur. Kolonlari gevsetmek, PlanTimeCard/recurrence
# mantigini ve atama (accept/reject) akisini izin icin de calistirmak
# demekti. Izin kendi kucuk tablosunda yasar; efor seridi ikisini de okur.
#
# Kullanici kimlikleri auth_db.users'a MANTIKSAL referanstir (mevcut
# mikroservis kurali: fiziksel FK yok).
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, Index, Numeric, String,
    Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..database import Base
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


class TenantCapacitySettings(TenantOwnedMixin, Base):
    """Kiraci varsayilanlari — tenant basina TEK satir.

    Tekillik `task_lifecycle_policy` ile ayni kilitle saglanir: `singleton`
    sabit TRUE ve UNIQUE (enforce fazi bunu (tenant_id, singleton)'a
    donusturur). Satir YOKSA varsayilan tek kapida uygulanir:
    capacity_service.effective_settings().
    """

    __tablename__ = "tenant_capacity_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    singleton = Column(Boolean, nullable=False, default=True)
    # Gunluk beklenen saat (orn. 8.00). Ceyrek saat hassasiyeti yeter.
    daily_expected_hours = Column(Numeric(4, 2), nullable=False, default=8)
    # ISO hafta gunleri: 1=Pzt ... 7=Paz. Varsayilan Pzt-Cum.
    working_days = Column(JSONB, nullable=False, default=lambda: [1, 2, 3, 4, 5])
    updated_at = Column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False,
    )
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("singleton", name="uq_tenant_capacity_settings_single"),
        CheckConstraint("singleton IS TRUE", name="chk_tenant_capacity_singleton"),
        CheckConstraint(
            "daily_expected_hours > 0 AND daily_expected_hours <= 24",
            name="chk_tenant_capacity_hours",
        ),
    )


class TenantHoliday(TenantOwnedMixin, Base):
    """Kiraci tatil takvimi — basit tarih listesi (04-roller §8)."""

    __tablename__ = "tenant_holidays"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    holiday_date = Column(Date, nullable=False)
    name = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        # Ayni gune iki tatil yazilamaz (enforce: tenant-qualified).
        UniqueConstraint("holiday_date", name="uq_tenant_holidays_date"),
    )


class UserCapacityOverride(TenantOwnedMixin, Base):
    """Kullanici basina override — yalniz DOLU alanlar varsayilani ezer.

    Yari zamanli calisan (6 saat, Pzt-Per) buradan tanimlanir. NULL alan
    "kiraci varsayilanini kullan" demektir.
    """

    __tablename__ = "user_capacity_overrides"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    daily_expected_hours = Column(Numeric(4, 2), nullable=True)
    working_days = Column(JSONB, nullable=True)
    updated_at = Column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False,
    )
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_capacity_overrides_user"),
        CheckConstraint(
            "daily_expected_hours IS NULL OR "
            "(daily_expected_hours > 0 AND daily_expected_hours <= 24)",
            name="chk_user_capacity_hours",
        ),
    )


ABSENCE_TYPES = ("leave", "sick", "other")


class UserAbsence(TenantOwnedMixin, Base):
    """Izin/rapor gunu — o gun eksik SAYILMAZ.

    Aralik kapali ([start_date, end_date]). Kullanici kendi izni icin
    yazabilir; baskasi icin `worklogs.admin` gerekir.
    """

    __tablename__ = "user_absences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    absence_type = Column(String(20), nullable=False, default="leave")
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="chk_user_absences_range"),
        CheckConstraint(
            "absence_type IN ('leave', 'sick', 'other')",
            name="chk_user_absences_type",
        ),
        Index("idx_user_absences_user_range", "user_id", "start_date", "end_date"),
    )


# Migration (0009) ve testler bu envanteri kullanir — 0007/0008 deseni.
CAPACITY_TABLES = (
    "tenant_capacity_settings",
    "tenant_holidays",
    "user_capacity_overrides",
    "user_absences",
)
