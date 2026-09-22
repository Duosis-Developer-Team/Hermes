# =============================================================================
# HERMES - Kapasite router'i (PM rework P0 / D1+D2)
# =============================================================================
#   /capacity/settings        kiraci varsayilani            users.manage
#   /capacity/holidays        tatil takvimi                 users.manage
#   /capacity/users[/{id}]    kullanici override            users.manage
#   /capacity/absences        izin kayitlari                kendisi | worklogs.admin
#   /capacity/week            efor seridi verisi            kendisi | worklogs.admin
#
# Yetki modeli: ayarlar "Organizasyon" bolumune duser (03-yetenekler §6),
# bu yuzden users.manage. Baskasinin haftasini/iznini gormek ve yazmak,
# efor sayfasindaki mevcut "baskasi adina" kuraliyla ayni izni ister:
# worklogs.admin.
# =============================================================================
from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..authz import require_permissions, user_has
from ..schemas.capacity import (
    AbsenceCreate, AbsenceResponse, CapacitySettingsResponse,
    CapacitySettingsUpdate, HolidayCreate, HolidayResponse,
    UserOverrideResponse, UserOverrideUpdate, WeekCapacityResponse,
)
from ..services import capacity_service as svc
from ..tenant_db import get_tenant_db
from shared.auth import CurrentUser, get_current_user
from shared.exceptions import ConflictError, NotFoundError, ValidationError
from shared.permissions import Perm

router = APIRouter(prefix="/capacity", tags=["Capacity"])


def _raise(exc: Exception):
    if isinstance(exc, NotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message)
    if isinstance(exc, ConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message)
    if isinstance(exc, ValidationError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.message)
    raise exc


def _target_user(current_user: CurrentUser, user_id: Optional[UUID]) -> UUID:
    """Kendisi serbest; baskasi icin worklogs.admin."""
    me = UUID(current_user.id)
    if user_id is None or user_id == me:
        return me
    if not user_has(current_user, Perm.WORKLOGS_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Baska bir kullanicinin kapasitesi icin worklogs.admin gerekir.",
        )
    return user_id


# ---------------------------------------------------------------------------
# Kiraci ayarlari
# ---------------------------------------------------------------------------

@router.get("/settings", response_model=CapacitySettingsResponse)
def get_settings(
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    return svc.effective_settings(db)


@router.put("/settings", response_model=CapacitySettingsResponse)
def update_settings(
    data: CapacitySettingsUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    try:
        svc.upsert_settings(
            db, daily_expected_hours=data.daily_expected_hours,
            working_days=data.working_days, actor_user_id=UUID(admin.id),
        )
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)
    return svc.effective_settings(db)


# ---------------------------------------------------------------------------
# Tatiller
# ---------------------------------------------------------------------------

@router.get("/holidays", response_model=List[HolidayResponse])
def list_holidays(
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    return svc.list_holidays(db, start=start, end=end)


@router.post("/holidays", response_model=HolidayResponse, status_code=status.HTTP_201_CREATED)
def add_holiday(
    data: HolidayCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    try:
        return svc.add_holiday(
            db, holiday_date=data.holiday_date, name=data.name,
            actor_user_id=UUID(admin.id),
        )
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)


@router.delete("/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holiday(
    holiday_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    try:
        svc.delete_holiday(db, holiday_id)
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)
    return None


# ---------------------------------------------------------------------------
# Kullanici override
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[UserOverrideResponse])
def list_overrides(
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    return svc.list_overrides(db)


@router.get("/users/{user_id}", response_model=UserOverrideResponse)
def get_override(
    user_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    row = svc.get_override(db, user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Override yok.")
    return row


@router.put("/users/{user_id}", response_model=UserOverrideResponse)
def upsert_override(
    user_id: UUID,
    data: UserOverrideUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    try:
        return svc.upsert_override(
            db, user_id=user_id, daily_expected_hours=data.daily_expected_hours,
            working_days=data.working_days, actor_user_id=UUID(admin.id),
        )
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_override(
    user_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    try:
        svc.delete_override(db, user_id)
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)
    return None


# ---------------------------------------------------------------------------
# Izinler
# ---------------------------------------------------------------------------

@router.get("/absences", response_model=List[AbsenceResponse])
def list_absences(
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    user_id: Optional[UUID] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    target = _target_user(current_user, user_id)
    return svc.list_absences(db, user_id=target, start=start, end=end)


@router.post("/absences", response_model=AbsenceResponse, status_code=status.HTTP_201_CREATED)
def create_absence(
    data: AbsenceCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    target = _target_user(current_user, data.user_id)
    try:
        return svc.create_absence(
            db, user_id=target, start_date=data.start_date, end_date=data.end_date,
            absence_type=data.absence_type, note=data.note,
            actor_user_id=UUID(current_user.id),
        )
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)


@router.delete("/absences/{absence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_absence(
    absence_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    try:
        row = svc.get_absence(db, absence_id)
        # Sahiplik: kendi izni ya da worklogs.admin. Baskasinin kaydi
        # icin ayni 403 — kaydin varligi zaten kendi listesinde gorunmez.
        _target_user(current_user, row.user_id)
        svc.delete_absence(db, absence_id)
    except (ValidationError, ConflictError, NotFoundError) as exc:
        _raise(exc)
    return None


# ---------------------------------------------------------------------------
# Efor seridi
# ---------------------------------------------------------------------------

@router.get("/week", response_model=WeekCapacityResponse)
def get_week(
    start: date = Query(..., description="Haftanin herhangi bir gunu; Pazartesi'ye yuvarlanir"),
    user_id: Optional[UUID] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    target = _target_user(current_user, user_id)
    return svc.resolve_week(db, user_id=target, week_start=start)
