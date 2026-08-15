from sqlalchemy import Column, String, Date, Integer, ForeignKey, Text, Enum, DateTime, UUID
from sqlalchemy.sql import func
from app.database import Base
from app.models.mixins import TenantOwnedMixin
import enum

class TimesheetStatus(str, enum.Enum):
    OPEN = "OPEN"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

class TimesheetSubmission(TenantOwnedMixin, Base):
    __tablename__ = "timesheet_submissions"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    status = Column(Enum(TimesheetStatus), default=TimesheetStatus.OPEN, nullable=False)
    
    reviewer_id = Column(UUID(as_uuid=True), nullable=True)
    submitter_note = Column(Text, nullable=True)
    
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
