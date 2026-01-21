# =============================================================================
# HERMES PLATFORM - Work Log Model (SQLAlchemy)
# =============================================================================
# Bu dosya, TAD'da (readme2.md) tanımlanan 'work_logs' tablosunun SQLAlchemy
# model tanımını içerir. Tablo yapısı birebir TAD ile uyumludur.
#
# TAD Referansı (core_db):
# CREATE TABLE work_logs (
#     id BIGSERIAL PRIMARY KEY,
#     user_id UUID NOT NULL,
#     customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT NOT NULL,
#     project_id UUID REFERENCES projects(id) ON DELETE RESTRICT NOT NULL,
#     work_type_id UUID REFERENCES work_types(id) ON DELETE RESTRICT NOT NULL,
#     date_worked DATE NOT NULL,
#     duration_hours DECIMAL(5, 2) NOT NULL,
#     description TEXT,
#     created_at TIMESTAMPTZ DEFAULT now(),
#     updated_at TIMESTAMPTZ DEFAULT now()
# );
#
# PRD Referansı:
# FR 2.2: Zaman Girişi Veri Modeli
# =============================================================================

import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from sqlalchemy import Column, BigInteger, String, Date, DateTime, ForeignKey, Text, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from ..database import Base


class WorkLog(Base):
    """
    Zaman Girişi / Yapılan İş modeli.
    
    Bu model, çalışanların yaptıkları işlerin kaydını tutar. Bu, Hermes
    platformunun temel işlevi olan zaman takibinin merkezi veritabanı kaydıdır.
    
    PRD'ye göre zorunlu alanlar:
    - Müşteri (customer_id)
    - İş Tipi (work_type_id)
    - Yapıldığı Tarih (date_worked)
    - Süresi (duration_hours)
    - Açıklama (description)
    - İşi Giren Kişi (user_id - otomatik atanır)
    - Ürün ya da Proje (project_id)
    
    Attributes:
        id (int): Benzersiz kayıt kimliği (Primary Key, BIGSERIAL)
        user_id (UUID): İşi giren kullanıcının ID'si (auth_db.users referansı)
        customer_id (UUID): Müşteri ID'si (FK)
        project_id (UUID): Proje ID'si (FK)
        work_type_id (UUID): İş tipi ID'si (FK)
        date_worked (date): İşin yapıldığı tarih
        duration_hours (Decimal): Harcanan süre (saat, örn: 2.5)
        description (str): İş açıklaması
        created_at (datetime): Kayıt oluşturulma tarihi
        updated_at (datetime): Son güncelleme tarihi
    
    İlişkiler:
        - customer: İlişkili müşteri
        - project: İlişkili proje
        - work_type: İlişkili iş tipi
    
    Tablo Adı: work_logs
    Veritabanı: core_db
    
    Not: v2.0'daki 'is_billable' alanı v1.0'da mevcut değildir.
    """
    
    __tablename__ = "work_logs"
    
    # ==========================================================================
    # Primary Key
    # ==========================================================================
    
    # BIGSERIAL - Otomatik artan büyük tamsayı (yüksek hacimli kayıtlar için)
    id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Benzersiz kayıt kimliği (BIGSERIAL)"
    )
    
    # ==========================================================================
    # User Reference (Logical FK - auth_db.users)
    # ==========================================================================
    
    # NOT: Bu, farklı bir veritabanındaki users tablosuna mantıksal referanstır.
    # Fiziksel FK constraint yok çünkü mikroservis mimarisi kullanılıyor.
    user_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        comment="İşi giren kullanıcının UUID'si (auth_db.users referansı)"
    )
    
    # ==========================================================================
    # Foreign Keys
    # ==========================================================================
    
    # ON DELETE RESTRICT: İlişkili kayıt varken silmeyi engelle
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
    
    work_type_id = Column(
        UUID(as_uuid=True),
        ForeignKey("work_types.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="İş tipi ID'si"
    )

    # Yeni Eklenen İlişkiler (v1.1)
    activity_type_id = Column(
        UUID(as_uuid=True),
        ForeignKey("activity_types.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )

    platform_id = Column(
        UUID(as_uuid=True),
        ForeignKey("platforms.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )

    work_line_id = Column(
        UUID(as_uuid=True),
        ForeignKey("work_lines.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )

    # Issue İlişkisi (Opsiyonel)
    issue_id = Column(
        UUID(as_uuid=True),
        ForeignKey("issues.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    issue_key_manual = Column(String(50), nullable=True, index=True)
    
    # ==========================================================================
    # Work Log Details
    # ==========================================================================
    
    date_worked = Column(
        Date,
        nullable=False,
        index=True,
        comment="İşin yapıldığı tarih"
    )
    
    # DECIMAL(5,2) - 5 basamak, 2 ondalık (max: 999.99 saat)
    duration_hours = Column(
        Numeric(5, 2),
        nullable=False,
        comment="Harcanan süre (saat, örn: 2.50)"
    )
    
    description = Column(
        Text,
        nullable=True,
        comment="İş açıklaması (detaylı notlar)"
    )
    
    # ==========================================================================
    # Timestamps
    # ==========================================================================
    
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="Kayıt oluşturulma tarihi"
    )
    
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="Son güncelleme tarihi"
    )
    
    # ==========================================================================
    # Relationships
    # ==========================================================================
    
    customer = relationship("Customer", back_populates="work_logs")
    project = relationship("Project", back_populates="work_logs")
    work_type = relationship("WorkType", back_populates="work_logs")
    
    # Yeni İlişkiler
    issue = relationship("Issue", back_populates="work_logs")
    # Diğerleri için back_populates tanımlı değilse lazy relationship yeterli olabilir,
    # ama model dosyalarında back_populates tanımladık mı kontrol edelim.
    # ActivityType vb. modellerde back_populates tanımlı değilse burada da gerekmez.
    # Ancak "activity_type.py" dosyasını hatırlıyorum, orada relationship görmemiştim.
    # İlişkiyi tek yönlü (WorkLog -> ActivityType) kurabiliriz.
    
    activity_type = relationship("ActivityType")
    platform = relationship("Platform")
    work_line = relationship("WorkLine")
    
    # ==========================================================================
    # String Representation
    # ==========================================================================
    
    def __repr__(self) -> str:
        return (
            f"<WorkLog(id={self.id}, user_id={self.user_id}, "
            f"date={self.date_worked}, hours={self.duration_hours})>"
        )
    
    def __str__(self) -> str:
        return f"WorkLog #{self.id}: {self.duration_hours}h on {self.date_worked}"
