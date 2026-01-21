"""
Issue Model - Proje görevleri/maddeleri (Jira Task benzeri)
"""

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from ..database import Base


class Issue(Base):
    """
    Issue modeli.
    
    Projeye bağlı görevleri temsil eder (Jira'daki task/issue'lar gibi).
    Her issue benzersiz bir 'issue_key'e sahiptir (örn: PROJ-101).
    """
    
    __tablename__ = "issues"
    
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
    
    issue_key = Column(
        String(50),
        nullable=False,
        index=True,
        comment="Proje bazlı benzersiz anahtar (örn: HER-123)"
    )
    
    summary = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    
    # İlişkiler
    project = relationship("Project", back_populates="issues")
    work_logs = relationship("WorkLog", back_populates="issue", lazy="dynamic")
    
    def __repr__(self):
        return f"<Issue(key='{self.issue_key}', summary='{self.summary}')>"
