# =============================================================================
# HERMES PLATFORM - Project Model (SQLAlchemy)
# =============================================================================
# Bu dosya, TAD'da (readme2.md) tanımlanan 'projects' tablosunun SQLAlchemy
# model tanımını içerir. Tablo yapısı birebir TAD ile uyumludur.
#
# TAD Referansı (core_db):
# CREATE TABLE projects (
#     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#     customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
#     name VARCHAR(255) NOT NULL,
#     is_active BOOLEAN DEFAULT true,
#     created_at TIMESTAMPTZ DEFAULT now()
# );
#
# PRD Referansı:
# FR 3.3: Ürün/Proje Yönetimi (CRUD)
# Örnek: "X Projesi", "Y Ürünü Bakımı"
# =============================================================================

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .mixins import TenantOwnedMixin
from ..database import Base


class Project(TenantOwnedMixin, Base):
    """
    Proje/Ürün modeli.
    
    Bu model, ekibin üzerinde çalıştığı projeleri veya ürünleri temsil eder.
    Bir proje opsiyonel olarak bir müşteriye bağlı olabilir (iç projeler
    müşterisiz olabilir).
    
    Attributes:
        id (UUID): Benzersiz proje kimliği (Primary Key)
        customer_id (UUID): Bağlı müşteri ID'si (opsiyonel, FK)
        name (str): Proje adı (zorunlu)
        is_active (bool): Proje aktif mi? (soft delete için)
        created_at (datetime): Oluşturulma tarihi
    
    İlişkiler:
        - customer: Projenin bağlı olduğu müşteri (opsiyonel)
        - work_logs: Bu projeye ait zaman girişleri
    
    Tablo Adı: projects
    Veritabanı: core_db
    """
    
    __tablename__ = "projects"
    
    # ==========================================================================
    # Primary Key
    # ==========================================================================
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="Benzersiz proje kimliği"
    )
    
    # ==========================================================================
    # Foreign Key - Customer (Optional)
    # ==========================================================================
    
    # Bir proje müşterisiz olabilir (iç proje)
    # ON DELETE SET NULL: Müşteri silinirse, proje kalır ama customer_id NULL olur
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Bağlı müşteri ID'si (iç projeler için NULL)"
    )
    
    # ==========================================================================
    # Project Information
    # ==========================================================================
    
    name = Column(
        String(255),
        nullable=False,
        index=True,
        comment="Proje adı"
    )

    project_key = Column(
        String(50),
        nullable=True,
        unique=True,
        index=True,
        comment="Proje anahtarı (örn: HER-101)"
    )
    
    # ==========================================================================
    # Contract Information (Optional)
    # ==========================================================================

    contract_start_date = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="Sözleşme başlangıç tarihi (opsiyonel)"
    )

    contract_duration_days = Column(
        Integer,
        nullable=True,
        comment="Sözleşme süresi (gün cinsinden, opsiyonel)"
    )

    # ==========================================================================
    # Status Flag
    # ==========================================================================
    
    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Proje aktif mi? (False = soft deleted)"
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
    # Relationships
    # ==========================================================================
    
    # Projenin bağlı olduğu müşteri
    customer = relationship(
        "Customer",
        back_populates="projects"
    )
    
    work_logs = relationship(
        "WorkLog",
        back_populates="project",
        lazy="dynamic"
    )

    # Projeye ait issue'lar
    issues = relationship(
        "Issue",
        back_populates="project",
        lazy="dynamic",
        cascade="all, delete"
    )

    # Proje üyeleri
    memberships = relationship(
        "ProjectMembership",
        back_populates="project",
        lazy="dynamic",
        cascade="all, delete"
    )
    
    # ==========================================================================
    # String Representation
    # ==========================================================================
    
    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name='{self.name}', customer_id={self.customer_id})>"
    
    def __str__(self) -> str:
        return self.name
