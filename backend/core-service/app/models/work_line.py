"""
Work Line Model - Çalışma hattı (Support, Development, Infrastructure, etc.)
"""

from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from .mixins import TenantOwnedMixin
from ..database import Base


class WorkLine(TenantOwnedMixin, Base):
    """Work Line modeli - work log seçeneklerinden biri"""
    
    __tablename__ = "work_lines"
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    
    name = Column(String(100), nullable=False, index=True)
    code = Column(String(20), nullable=False, unique=True, index=True)
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    
    def __repr__(self):
        return f"<WorkLine(name='{self.name}', code='{self.code}')>"
