from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List
from app.models.timesheet import TimesheetStatus

class TimesheetSubmissionBase(BaseModel):
    period_start: date
    period_end: date
    reviewer_id: Optional[int] = None
    submitter_note: Optional[str] = None

class TimesheetSubmissionCreate(TimesheetSubmissionBase):
    pass

class TimesheetSubmissionUpdate(BaseModel):
    status: Optional[TimesheetStatus] = None
    reviewer_id: Optional[int] = None
    submitter_note: Optional[str] = None

class TimesheetSubmissionResponse(TimesheetSubmissionBase):
    id: str
    user_id: int
    status: TimesheetStatus
    submitted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class PeriodStatus(BaseModel):
    period_start: date
    period_end: date
    status: TimesheetStatus = TimesheetStatus.OPEN
    logged_hours: float
    required_hours: float
    is_current: bool = False
    submission: Optional[TimesheetSubmissionResponse] = None
