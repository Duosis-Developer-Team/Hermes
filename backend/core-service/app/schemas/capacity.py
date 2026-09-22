# =============================================================================
# HERMES - Kapasite semalari (PM rework P0 / D1+D2)
# =============================================================================
from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _days_ok(value: List[int]) -> List[int]:
    cleaned = sorted({int(d) for d in value})
    if not cleaned or any(d < 1 or d > 7 for d in cleaned):
        raise ValueError("working_days must be ISO weekday numbers 1..7 (non-empty)")
    return cleaned


class CapacitySettingsUpdate(BaseModel):
    daily_expected_hours: Decimal = Field(..., gt=0, le=24)
    working_days: List[int] = Field(..., description="ISO weekdays, 1=Mon..7=Sun")

    @field_validator("working_days")
    @classmethod
    def _v_days(cls, v):
        return _days_ok(v)


class CapacitySettingsResponse(BaseModel):
    daily_expected_hours: Decimal
    working_days: List[int]
    is_default: bool
    updated_at: Optional[datetime] = None


class HolidayCreate(BaseModel):
    holiday_date: date
    name: str = Field(..., min_length=1, max_length=120)


class HolidayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    holiday_date: date
    name: str


class UserOverrideUpdate(BaseModel):
    daily_expected_hours: Optional[Decimal] = Field(None, gt=0, le=24)
    working_days: Optional[List[int]] = None

    @field_validator("working_days")
    @classmethod
    def _v_days(cls, v):
        return _days_ok(v) if v is not None else None


class UserOverrideResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    daily_expected_hours: Optional[Decimal] = None
    working_days: Optional[List[int]] = None
    updated_at: Optional[datetime] = None


class AbsenceCreate(BaseModel):
    # Bos = kendisi. Baskasi icin worklogs.admin gerekir (router karar verir).
    user_id: Optional[UUID] = None
    start_date: date
    end_date: date
    absence_type: Literal["leave", "sick", "other"] = "leave"
    note: Optional[str] = Field(None, max_length=500)


class AbsenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    start_date: date
    end_date: date
    absence_type: str
    note: Optional[str] = None


class WeekDayResponse(BaseModel):
    date: date
    weekday: int
    is_working_day: bool
    is_holiday: bool
    holiday_name: Optional[str] = None
    is_absent: bool
    absence_type: Optional[str] = None
    absence_id: Optional[UUID] = None
    expected_hours: Decimal
    logged_hours: Decimal
    status: Literal["off", "future", "today", "missing", "partial", "complete"]


class WeekCapacityResponse(BaseModel):
    user_id: UUID
    week_start: date
    week_end: date
    today: date
    daily_expected_hours: Decimal
    working_days: List[int]
    expected_total: Decimal
    logged_total: Decimal
    fill_percent: Optional[int] = None
    missing_days: List[date]
    days: List[WeekDayResponse]
