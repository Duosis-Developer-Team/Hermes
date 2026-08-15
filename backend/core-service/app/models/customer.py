# =============================================================================
# HERMES PLATFORM - Customer Model (SQLAlchemy)
# =============================================================================
# Bu dosya, TAD'da (readme2.md) tanımlanan 'customers' tablosunun SQLAlchemy
# model tanımını içerir. Tablo yapısı birebir TAD ile uyumludur.
#
# TAD Referansı (core_db):
# CREATE TABLE customers (
#     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#     name VARCHAR(255) NOT NULL,
#     is_active BOOLEAN DEFAULT true,
#     created_at TIMESTAMPTZ DEFAULT now()
# );
#
# PRD Referansı:
# FR 3.1: Müşteri Yönetimi (CRUD)
# =============================================================================

import uuid
from datetime import datetime, timezone
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .mixins import TenantOwnedMixin
from ..database import Base


class Customer(TenantOwnedMixin, Base):
    """
    Müşteri modeli.
    
    Bu model, Hermes platformundaki müşterileri temsil eder. Zaman girişleri
    ve projeler birer müşteriye bağlıdır.
    
    Attributes:
        id (UUID): Benzersiz müşteri kimliği (Primary Key)
        name (str): Müşteri adı (zorunlu)
        is_active (bool): Müşteri aktif mi? (soft delete için)
        created_at (datetime): Oluşturulma tarihi
    
    İlişkiler:
        - projects: Bu müşteriye ait projeler
        - work_logs: Bu müşteriye ait zaman girişleri
    
    Tablo Adı: customers
    Veritabanı: core_db
    """
    
    __tablename__ = "customers"
    
    # ==========================================================================
    # Primary Key
    # ==========================================================================
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="Benzersiz müşteri kimliği"
    )
    
    # ==========================================================================
    # Customer Information
    # ==========================================================================
    
    name = Column(
        String(255),
        nullable=False,
        index=True,
        comment="Müşteri adı"
    )
    
    # ==========================================================================
    # Status Flag
    # ==========================================================================
    
    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Müşteri aktif mi? (False = soft deleted)"
    )
    
    # ==========================================================================
    # Timestamps
    # ==========================================================================
    
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="Oluşturulma tarihi"
    )

    # ==========================================================================
    # Contract Information (New)
    # ==========================================================================
    
    contract_start_date = Column(
        DateTime(timezone=True), # Using DateTime for consistency, though Date is sufficient
        nullable=True,
        comment="Sözleşme başlangıç tarihi"
    )
    
    contract_duration_days = Column(
        Integer,
        nullable=True,
        comment="Sözleşme süresi (gün)"
    )
    
    # ==========================================================================
    # Relationships
    # ==========================================================================
    
    # Müşteriye ait projeler
    projects = relationship(
        "Project",
        back_populates="customer",
        lazy="dynamic"
    )
    
    # Müşteriye ait zaman girişleri
    work_logs = relationship(
        "WorkLog",
        back_populates="customer",
        lazy="dynamic"
    )
    
    # ==========================================================================
    # String Representation
    # ==========================================================================
    
    def __repr__(self) -> str:
        return f"<Customer(id={self.id}, name='{self.name}')>"
    
    def __str__(self) -> str:
        return self.name
