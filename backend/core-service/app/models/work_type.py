# =============================================================================
# HERMES PLATFORM - Work Type Model (SQLAlchemy)
# =============================================================================
# Bu dosya, TAD'da (readme2.md) tanımlanan 'work_types' tablosunun SQLAlchemy
# model tanımını içerir. Tablo yapısı birebir TAD ile uyumludur.
#
# TAD Referansı (core_db):
# CREATE TABLE work_types (
#     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#     name VARCHAR(100) NOT NULL,
#     is_active BOOLEAN DEFAULT true
# );
#
# PRD Referansı:
# FR 3.2: İş Tipi Yönetimi (CRUD)
# Örnek iş tipleri: "Geliştirme", "Toplantı", "Destek"
# =============================================================================

import uuid
from sqlalchemy import Column, String, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .mixins import TenantOwnedMixin
from ..database import Base


class WorkType(TenantOwnedMixin, Base):
    """
    İş Tipi modeli.
    
    Bu model, yapılan işlerin kategorilerini temsil eder.
    Örnek: "Geliştirme", "Toplantı", "Destek", "Analiz", "Test"
    
    Zaman girişi yapılırken bu listeden bir iş tipi seçilir.
    
    Attributes:
        id (UUID): Benzersiz iş tipi kimliği (Primary Key)
        name (str): İş tipi adı (zorunlu, max 100 karakter)
        is_active (bool): İş tipi aktif mi? (soft delete için)
    
    İlişkiler:
        - work_logs: Bu iş tipine ait zaman girişleri
    
    Tablo Adı: work_types
    Veritabanı: core_db
    
    Not: v2.0'daki 'is_billable_default' alanı v1.0'da mevcut değildir.
    """
    
    __tablename__ = "work_types"
    
    # ==========================================================================
    # Primary Key
    # ==========================================================================
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="Benzersiz iş tipi kimliği"
    )
    
    # ==========================================================================
    # Work Type Information
    # ==========================================================================
    
    name = Column(
        String(100),
        nullable=False,
        index=True,
        comment="İş tipi adı (örn: Geliştirme, Toplantı)"
    )
    
    # ==========================================================================
    # Status Flag
    # ==========================================================================
    
    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="İş tipi aktif mi? (False = soft deleted)"
    )
    
    # ==========================================================================
    # Relationships
    # ==========================================================================
    
    # Bu iş tipine ait zaman girişleri
    work_logs = relationship(
        "WorkLog",
        back_populates="work_type",
        lazy="dynamic"
    )
    
    # ==========================================================================
    # String Representation
    # ==========================================================================
    
    def __repr__(self) -> str:
        return f"<WorkType(id={self.id}, name='{self.name}')>"
    
    def __str__(self) -> str:
        return self.name
