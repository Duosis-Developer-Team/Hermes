# =============================================================================
# HERMES - Kapasite servisi (PM rework P0 / D1+D2)
# =============================================================================
# Iki katman:
#   1) SAF hesap (`build_week`, `day_status`): veritabani bilmez, tarih ve
#      sayilarla calisir. Efor seridinin tum kurallari burada test edilir.
#   2) DB yardimcilari: ayar/tatil/override/izin okuma-yazma ve haftayi
#      gercek kayitlardan kurma (`resolve_week`).
#
# Durum kurallari (04-roller §4.1 ve §7):
#   - BUGUN hicbir zaman eksik degildir — gun bitmeden eksik sayilmaz.
#   - Gelecek gun 'future'.
#   - Calisma gunu degil / tatil / izin -> 'off' (uyari yok).
#   - Gecmis calisma gunu + 0 saat -> 'missing' (sari nokta, tiklanabilir).
#   - Gecmis calisma gunu + beklenenin alti -> 'partial' (soluk, uyari DEGIL).
#   - Beklenen ve ustu -> 'complete'.
# =============================================================================

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.capacity import (
    ABSENCE_TYPES, TenantCapacitySettings, TenantHoliday, UserAbsence,
    UserCapacityOverride,
)
from ..models.work_log import WorkLog
from shared.exceptions import ConflictError, NotFoundError, ValidationError

DEFAULT_DAILY_HOURS = Decimal("8")
DEFAULT_WORKING_DAYS = (1, 2, 3, 4, 5)   # ISO: 1=Pzt ... 7=Paz

STATUS_OFF = "off"
STATUS_FUTURE = "future"
STATUS_TODAY = "today"
STATUS_MISSING = "missing"
STATUS_PARTIAL = "partial"
STATUS_COMPLETE = "complete"


# -----------------------------------------------------------------------------
# Zaman
# -----------------------------------------------------------------------------

# core_db kiraci saat dilimini bilmez (auth_db.tenants.timezone); bugunku
# tek kiraci gercekligi Europe/Istanbul. Env'den OKUNMAZ: kodun okudugu
# her env anahtari manifestlere bagli olmak zorunda (test_migrations),
# manifest degisikligi ise CD disi/manuel is. Ileride kiraci ayarina
# baglanir; o gun bu sabit kalkar.
CAPACITY_TZ = ZoneInfo("Europe/Istanbul")


def today_in_tenant_tz() -> date:
    """"Bugun" kiraci saat dilimine gore.

    Konteyner UTC'de kosar: gece 00:00-03:00 arasinda UTC tarihi bir gun
    geride kalir ve "dun" 03:00'e kadar eksik gorunmezdi — kullanici
    lehine ama yanlis. Bu yuzden yerel tarih kullanilir.
    """
    return datetime.now(CAPACITY_TZ).date()


def week_monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


# -----------------------------------------------------------------------------
# Dogrulama
# -----------------------------------------------------------------------------

def normalize_working_days(days: Iterable[int]) -> list[int]:
    """1..7 arasi, tekrarsiz, sirali, bos olmayan liste."""
    try:
        cleaned = sorted({int(d) for d in days})
    except (TypeError, ValueError):
        raise ValidationError("Calisma gunleri 1-7 arasi tam sayi olmali.")
    if not cleaned or any(d < 1 or d > 7 for d in cleaned):
        raise ValidationError("Calisma gunleri 1 (Pzt) ile 7 (Paz) arasinda, en az bir gun olmali.")
    return cleaned


def normalize_hours(value) -> Decimal:
    try:
        hours = Decimal(str(value))
    except Exception:  # noqa: BLE001
        raise ValidationError("Gunluk saat sayi olmali.")
    if hours <= 0 or hours > 24:
        raise ValidationError("Gunluk saat 0'dan buyuk, en fazla 24 olmali.")
    return hours.quantize(Decimal("0.01"))


# -----------------------------------------------------------------------------
# 1) SAF hesap
# -----------------------------------------------------------------------------

def day_status(
    *, day: date, today: date, off: bool, expected: Decimal, logged: Decimal,
) -> str:
    if off:
        return STATUS_OFF
    if day > today:
        return STATUS_FUTURE
    if day == today:
        return STATUS_TODAY
    if logged <= 0:
        return STATUS_MISSING
    if logged < expected:
        return STATUS_PARTIAL
    return STATUS_COMPLETE


def build_week(
    *,
    week_start: date,
    today: date,
    daily_hours: Decimal,
    working_days: Iterable[int],
    holidays: Optional[dict[date, str]] = None,
    absences: Optional[list[dict]] = None,
    logged_by_day: Optional[dict[date, Decimal]] = None,
) -> dict:
    """Yedi gunluk seridi kurar. Veritabani bilmez.

    `absences`: [{"id", "start_date", "end_date", "absence_type"}]
    """
    week_start = week_monday(week_start)
    working = set(working_days)
    holidays = holidays or {}
    absences = absences or []
    logged_by_day = logged_by_day or {}

    days = []
    expected_total = Decimal("0")
    logged_total = Decimal("0")
    missing: list[date] = []

    for offset in range(7):
        day = week_start + timedelta(days=offset)
        weekday = day.isoweekday()
        is_working = weekday in working
        holiday_name = holidays.get(day)
        absence = next(
            (a for a in absences if a["start_date"] <= day <= a["end_date"]),
            None,
        )
        off = (not is_working) or holiday_name is not None or absence is not None
        expected = Decimal("0") if off else daily_hours
        logged = Decimal(str(logged_by_day.get(day, 0) or 0))
        status = day_status(
            day=day, today=today, off=off, expected=expected, logged=logged,
        )
        if status == STATUS_MISSING:
            missing.append(day)
        expected_total += expected
        logged_total += logged
        days.append({
            "date": day,
            "weekday": weekday,
            "is_working_day": is_working,
            "is_holiday": holiday_name is not None,
            "holiday_name": holiday_name,
            "is_absent": absence is not None,
            "absence_type": absence["absence_type"] if absence else None,
            "absence_id": absence["id"] if absence else None,
            "expected_hours": expected,
            "logged_hours": logged,
            "status": status,
        })

    fill = (
        int((logged_total / expected_total * 100).to_integral_value())
        if expected_total > 0 else None
    )
    return {
        "week_start": week_start,
        "week_end": week_start + timedelta(days=6),
        "today": today,
        "daily_expected_hours": daily_hours,
        "working_days": sorted(working),
        "expected_total": expected_total,
        "logged_total": logged_total,
        "fill_percent": fill,
        "missing_days": missing,
        "days": days,
    }


# -----------------------------------------------------------------------------
# 2) Ayarlar
# -----------------------------------------------------------------------------

def get_settings_row(db: Session) -> Optional[TenantCapacitySettings]:
    return db.query(TenantCapacitySettings).first()


def effective_settings(db: Session) -> dict:
    """Varsayilan TEK kapida uygulanir — satir yoksa 8 saat, Pzt-Cum."""
    row = get_settings_row(db)
    if row is None:
        return {
            "daily_expected_hours": DEFAULT_DAILY_HOURS,
            "working_days": list(DEFAULT_WORKING_DAYS),
            "is_default": True,
            "updated_at": None,
        }
    return {
        "daily_expected_hours": Decimal(row.daily_expected_hours),
        "working_days": list(row.working_days or DEFAULT_WORKING_DAYS),
        "is_default": False,
        "updated_at": row.updated_at,
    }


def upsert_settings(
    db: Session, *, daily_expected_hours, working_days, actor_user_id: UUID,
) -> TenantCapacitySettings:
    hours = normalize_hours(daily_expected_hours)
    days = normalize_working_days(working_days)
    row = get_settings_row(db)
    if row is None:
        row = TenantCapacitySettings(singleton=True)
        db.add(row)
    row.daily_expected_hours = hours
    row.working_days = days
    row.updated_by_user_id = actor_user_id
    db.flush()
    return row


# -----------------------------------------------------------------------------
# 3) Tatiller
# -----------------------------------------------------------------------------

def list_holidays(db: Session, *, start: Optional[date] = None,
                  end: Optional[date] = None) -> list[TenantHoliday]:
    q = db.query(TenantHoliday)
    if start is not None:
        q = q.filter(TenantHoliday.holiday_date >= start)
    if end is not None:
        q = q.filter(TenantHoliday.holiday_date <= end)
    return q.order_by(TenantHoliday.holiday_date.asc()).all()


def add_holiday(db: Session, *, holiday_date: date, name: str,
                actor_user_id: UUID) -> TenantHoliday:
    name = (name or "").strip()
    if not name:
        raise ValidationError("Tatil adi zorunlu.")
    exists = db.query(TenantHoliday).filter(
        TenantHoliday.holiday_date == holiday_date
    ).first()
    if exists is not None:
        raise ConflictError(f"{holiday_date.isoformat()} icin zaten bir tatil var.")
    row = TenantHoliday(
        holiday_date=holiday_date, name=name, created_by_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    return row


def delete_holiday(db: Session, holiday_id: UUID) -> None:
    row = db.query(TenantHoliday).filter(TenantHoliday.id == holiday_id).first()
    if row is None:
        raise NotFoundError("Tatil bulunamadi.")
    db.delete(row)
    db.flush()


# -----------------------------------------------------------------------------
# 4) Kullanici override
# -----------------------------------------------------------------------------

def list_overrides(db: Session) -> list[UserCapacityOverride]:
    return db.query(UserCapacityOverride).order_by(
        UserCapacityOverride.updated_at.desc()
    ).all()


def get_override(db: Session, user_id: UUID) -> Optional[UserCapacityOverride]:
    return db.query(UserCapacityOverride).filter(
        UserCapacityOverride.user_id == user_id
    ).first()


def upsert_override(
    db: Session, *, user_id: UUID, daily_expected_hours=None,
    working_days=None, actor_user_id: UUID,
) -> UserCapacityOverride:
    hours = normalize_hours(daily_expected_hours) if daily_expected_hours is not None else None
    days = normalize_working_days(working_days) if working_days is not None else None
    if hours is None and days is None:
        raise ValidationError("Override icin en az bir alan (saat ya da gunler) verilmeli.")
    row = get_override(db, user_id)
    if row is None:
        row = UserCapacityOverride(user_id=user_id)
        db.add(row)
    row.daily_expected_hours = hours
    row.working_days = days
    row.updated_by_user_id = actor_user_id
    db.flush()
    return row


def delete_override(db: Session, user_id: UUID) -> None:
    row = get_override(db, user_id)
    if row is None:
        raise NotFoundError("Override bulunamadi.")
    db.delete(row)
    db.flush()


def user_capacity(db: Session, user_id: UUID) -> dict:
    """Kiraci varsayilani uzerine kullanici override'i (yalniz dolu alanlar)."""
    base = effective_settings(db)
    override = get_override(db, user_id)
    hours = base["daily_expected_hours"]
    days = base["working_days"]
    if override is not None:
        if override.daily_expected_hours is not None:
            hours = Decimal(override.daily_expected_hours)
        if override.working_days:
            days = list(override.working_days)
    return {"daily_expected_hours": hours, "working_days": days}


# -----------------------------------------------------------------------------
# 5) Izinler
# -----------------------------------------------------------------------------

def list_absences(db: Session, *, user_id: Optional[UUID] = None,
                  start: Optional[date] = None,
                  end: Optional[date] = None) -> list[UserAbsence]:
    q = db.query(UserAbsence)
    if user_id is not None:
        q = q.filter(UserAbsence.user_id == user_id)
    if start is not None:
        q = q.filter(UserAbsence.end_date >= start)
    if end is not None:
        q = q.filter(UserAbsence.start_date <= end)
    return q.order_by(UserAbsence.start_date.asc()).all()


def create_absence(
    db: Session, *, user_id: UUID, start_date: date, end_date: date,
    absence_type: str = "leave", note: Optional[str] = None,
    actor_user_id: UUID,
) -> UserAbsence:
    if end_date < start_date:
        raise ValidationError("Bitis tarihi baslangictan once olamaz.")
    if absence_type not in ABSENCE_TYPES:
        raise ValidationError("Gecersiz izin tipi.")
    overlap = db.query(UserAbsence).filter(
        UserAbsence.user_id == user_id,
        UserAbsence.start_date <= end_date,
        UserAbsence.end_date >= start_date,
    ).first()
    if overlap is not None:
        raise ConflictError("Bu tarihlerde zaten bir izin kaydi var.")
    row = UserAbsence(
        user_id=user_id, start_date=start_date, end_date=end_date,
        absence_type=absence_type, note=(note or None),
        created_by_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    return row


def get_absence(db: Session, absence_id: UUID) -> UserAbsence:
    row = db.query(UserAbsence).filter(UserAbsence.id == absence_id).first()
    if row is None:
        raise NotFoundError("Izin kaydi bulunamadi.")
    return row


def delete_absence(db: Session, absence_id: UUID) -> None:
    db.delete(get_absence(db, absence_id))
    db.flush()


# -----------------------------------------------------------------------------
# 6) Hafta cozumu
# -----------------------------------------------------------------------------

def logged_hours_by_day(db: Session, *, user_id: UUID, start: date,
                        end: date) -> dict[date, Decimal]:
    rows = db.query(WorkLog.date_worked, func.sum(WorkLog.duration_hours)).filter(
        WorkLog.user_id == user_id,
        WorkLog.date_worked >= start,
        WorkLog.date_worked <= end,
    ).group_by(WorkLog.date_worked).all()
    return {d: Decimal(str(total or 0)) for d, total in rows}


def resolve_week(db: Session, *, user_id: UUID, week_start: date,
                 today: Optional[date] = None) -> dict:
    start = week_monday(week_start)
    end = start + timedelta(days=6)
    cap = user_capacity(db, user_id)
    holidays = {h.holiday_date: h.name for h in list_holidays(db, start=start, end=end)}
    absences = [
        {"id": a.id, "start_date": a.start_date, "end_date": a.end_date,
         "absence_type": a.absence_type}
        for a in list_absences(db, user_id=user_id, start=start, end=end)
    ]
    week = build_week(
        week_start=start,
        today=today or today_in_tenant_tz(),
        daily_hours=cap["daily_expected_hours"],
        working_days=cap["working_days"],
        holidays=holidays,
        absences=absences,
        logged_by_day=logged_hours_by_day(db, user_id=user_id, start=start, end=end),
    )
    week["user_id"] = user_id
    return week
