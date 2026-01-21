from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List, Optional
import uuid
from datetime import date, datetime

from app.database import get_db
from app.models.timesheet import TimesheetSubmission, TimesheetStatus
from app.models.work_log import WorkLog
from app.schemas.timesheet import TimesheetSubmissionCreate, TimesheetSubmissionResponse, PeriodStatus, TimesheetSubmissionUpdate
from shared.auth import get_current_user, CurrentUser

router = APIRouter(
    prefix="/timesheets",
    tags=["Timesheets"]
)

@router.get("/period-status", response_model=PeriodStatus)
def get_period_status(
    date_val: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Belirtilen tarihin içinde bulunduğu dönem (ay) için durumu hesaplar.
    """
    # 1. Dönem tarihlerini belirle (Aylık dönem varsayımı)
    period_start = date(date_val.year, date_val.month, 1)
    if date_val.month == 12:
        period_end = date(date_val.year + 1, 1, 1).replace(day=1)
    else:
        # Gelecek ayın ilk gününden 1 gün çıkararak bu ayın son gününü bul
        # Alternatif: calendar.monthrange kullanmak
        from calendar import monthrange
        last_day = monthrange(date_val.year, date_val.month)[1]
        period_end = date(date_val.year, date_val.month, last_day)

    # 2. Girilen saatleri topla
    total_hours = db.query(func.sum(WorkLog.duration_hours)).filter(
        WorkLog.user_id == current_user.id,
        WorkLog.date_worked >= period_start,
        WorkLog.date_worked <= period_end
    ).scalar() or 0.0

    # 3. Gerekli saatleri hesapla (Basit mantık: Hafta içi * 8 saat)
    # Şimdilik sabit 160 veya iş günü hesabı
    # Daha gelişmiş versiyonda tatiller vs. eklenebilir
    # numpy dependency removed, simple loop logic suffices
    current_day = period_start
    required_hours = 0
    from datetime import timedelta
    
    temp_day = period_start
    while temp_day <= period_end:
        if temp_day.weekday() < 5: # 0-4 Monday-Friday
            required_hours += 8
        temp_day += timedelta(days=1)


    # 4. Mevcut submission var mı kontrol et
    submission = db.query(TimesheetSubmission).filter(
        TimesheetSubmission.user_id == current_user.id,
        TimesheetSubmission.period_start == period_start,
        TimesheetSubmission.period_end == period_end
    ).first()

    status = submission.status if submission else TimesheetStatus.OPEN
    
    # Ready to submit mantığı (örnek: gerekli saatin %90'ı dolduysa)
    if status == TimesheetStatus.OPEN and total_hours >= required_hours:
        # UI'da "READY TO SUBMIT" göstermek için client tarafı mantığı kullanılabilir 
        # veya status'u client yorumlayabilir. 
        # Biz burada sadece DB status'u dönüyoruz.
        pass

    is_current = (date.today().year == date_val.year and date.today().month == date_val.month)

    return PeriodStatus(
        period_start=period_start,
        period_end=period_end,
        status=status,
        logged_hours=total_hours,
        required_hours=required_hours,
        is_current=is_current,
        submission=submission
    )

@router.post("/submit", response_model=TimesheetSubmissionResponse)
def submit_timesheet(
    submission_in: TimesheetSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    # Check if already submitted
    existing = db.query(TimesheetSubmission).filter(
        TimesheetSubmission.user_id == current_user.id,
        TimesheetSubmission.period_start == submission_in.period_start,
        TimesheetSubmission.period_end == submission_in.period_end
    ).first()

    if existing:
        # Update existing
        existing.status = TimesheetStatus.SUBMITTED
        existing.submitted_at = datetime.now()
        existing.reviewer_id = submission_in.reviewer_id
        existing.submitter_note = submission_in.submitter_note
        db.commit()
        db.refresh(existing)
        return existing
    
    # Create new
    new_submission = TimesheetSubmission(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        period_start=submission_in.period_start,
        period_end=submission_in.period_end,
        status=TimesheetStatus.SUBMITTED,
        reviewer_id=submission_in.reviewer_id,
        submitter_note=submission_in.submitter_note,
        submitted_at=datetime.now()
    )
    db.add(new_submission)
    db.commit()
    db.refresh(new_submission)
    return new_submission
