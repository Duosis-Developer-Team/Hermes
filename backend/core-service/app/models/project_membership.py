"""
Project Membership Model - Proje üyelikleri ve roller
"""

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Date, CheckConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from .mixins import TenantOwnedMixin
from ..database import Base


class ProjectMembership(TenantOwnedMixin, Base):
    """
    Proje Üyeliği modeli.
    
    Hangi kullanıcının hangi projede, hangi rolde çalıştığını belirtir.
    user_id auth-service'deki Users tablosuna mantıksal referanstır.
    """
    
    __tablename__ = "project_memberships"
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    user_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="Auth DB'deki kullanıcı ID"
    )
    
    member_role = Column(String(80), nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    
    is_active = Column(Boolean, default=True, nullable=False)
    
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    # İlişkiler
    project = relationship("Project", back_populates="memberships")
    
    # Constraintler (SQLAlchemy tarafında da tanımlı olsun, DB'de zaten var)
    __table_args__ = (
        UniqueConstraint('project_id', 'user_id', name='uq_memberships_project_user'),
        CheckConstraint('(end_date IS NULL OR start_date IS NULL OR end_date >= start_date)', name='chk_membership_dates'),
    )
    
    def __repr__(self):
        return f"<ProjectMembership(project='{self.project_id}', user='{self.user_id}')>"
