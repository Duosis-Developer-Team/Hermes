# =============================================================================
# HERMES PLATFORM - Plan Time Models (SQLAlchemy)
# =============================================================================
# plan_times: Admin tarafından oluşturulan planlı zaman olayları.
# plan_time_assignments: Kullanıcı başına statü (pending/accepted/rejected).
# Many-to-Many with attributes pattern.
# =============================================================================

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Date, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from ..database import Base


class PlanTime(Base):
    """
    Planlı Zaman Olayı modeli.

    Admin tarafından oluşturulur ve belirli kullanıcılara atanır.
    Her atama için bağımsız statü (pending/accepted/rejected) tutulur.

    Tablo Adı: plan_times
    Veritabanı: core_db
    """

    __tablename__ = "plan_times"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="Benzersiz plan time ID"
    )

    # Oluşturan admin (auth_db.users mantıksal FK)
    created_by_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="Oluşturan admin kullanıcının UUID'si"
    )

    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="Müşteri ID'si"
    )

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="Proje ID'si"
    )

    start_date = Column(Date, nullable=False, comment="Başlangıç tarihi")
    end_date = Column(Date, nullable=False, comment="Bitiş tarihi")

    # HH:MM formatında saklanır
    start_time = Column(String(5), nullable=True, comment="Başlangıç saati (HH:MM)")
    end_time = Column(String(5), nullable=True, comment="Bitiş saati (HH:MM)")

    # 'one_time' | 'daily' | 'weekly'
    recurrence = Column(String(10), nullable=False, default='one_time', comment="Tekrar sıklığı")

    description = Column(Text, nullable=True, comment="Plan açıklaması")

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="Oluşturulma tarihi"
    )

    # İlişkiler
    customer = relationship("Customer")
    project = relationship("Project")
    assignments = relationship(
        "PlanTimeAssignment",
        back_populates="plan_time",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<PlanTime(id={self.id}, project_id={self.project_id}, start={self.start_date})>"


class PlanTimeAssignment(Base):
    """
    Kullanıcı başına plan time atama ve statü modeli.

    Her kayıt bir kullanıcının bir plan time olayına olan yanıtını temsil eder.
    Kullanıcı fikir değiştirebilir (accepted ↔ rejected).

    Tablo Adı: plan_time_assignments
    Veritabanı: core_db
    """

    __tablename__ = "plan_time_assignments"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="Benzersiz atama ID"
    )

    plan_time_id = Column(
        UUID(as_uuid=True),
        ForeignKey("plan_times.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="İlişkili plan time ID (CASCADE ile silinir)"
    )

    # Atanan kullanıcı (auth_db.users mantıksal FK)
    user_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="Atanan kullanıcının UUID'si"
    )

    # 'pending' | 'accepted' | 'rejected'
    status = Column(
        String(10),
        nullable=False,
        default='pending',
        comment="Kullanıcının yanıt statüsü"
    )

    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="Son güncelleme tarihi"
    )

    # İlişki
    plan_time = relationship("PlanTime", back_populates="assignments")

    def __repr__(self):
        return f"<PlanTimeAssignment(plan={self.plan_time_id}, user={self.user_id}, status={self.status})>"
