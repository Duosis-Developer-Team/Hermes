# =============================================================================
# HERMES PLATFORM - Work Log Schemas (Pydantic)
# =============================================================================
# PRD FR 2.2 gereksinimlerini karşılayan zaman girişi şemaları.
# =============================================================================

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict, field_validator


class WorkLogBase(BaseModel):
    """
    Zaman girişi şemalarının temel sınıfı.
    
    PRD'ye göre zorunlu alanlar:
    - Müşteri (customer_id)
    - İş Tipi (work_type_id)
    - Yapıldığı Tarih (date_worked)
    - Süresi (duration_hours)
    - Açıklama (description)
    - Ürün ya da Proje (project_id)
    
    Not: user_id otomatik olarak token'dan atanır.
    """
    customer_id: UUID = Field(..., description="Müşteri ID'si")
    project_id: UUID = Field(..., description="Proje ID'si")
    work_type_id: UUID = Field(..., description="İş tipi ID'si")
    date_worked: date = Field(..., description="İşin yapıldığı tarih")
    duration_hours: Decimal = Field(
        ...,
        ge=0.25,
        le=24,
        description="Harcanan süre (saat, min: 0.25, max: 24)",
        examples=[2.5, 4.0, 1.25]
    )
    billable_duration_hours: Optional[Decimal] = Field(
        None,
        ge=0,
        le=24,
        description="Faturalandırılacak süre (opsiyonel)",
    )
    description: Optional[str] = Field(
        None,
        max_length=5000,
        description="İş açıklaması"
    )
    
    # Yeni Alanlar (v1.1)
    activity_type_id: Optional[UUID] = Field(None, description="Aktivite tipi ID'si")
    platform_id: Optional[UUID] = Field(None, description="Platform ID'si")
    work_line_id: Optional[UUID] = Field(None, description="İş kolu ID'si")
    issue_id: Optional[UUID] = Field(None, description="Jira issue ID'si")
    issue_key_manual: Optional[str] = Field(None, description="Jira issue key (manuel)")

    # Tasks integration — set by the frontend when a work log is
    # submitted via the Task → Log Time flow. Pure Time Entry rows
    # leave this null.
    task_id: Optional[UUID] = Field(None, description="Bağlı task ID'si")
    
    @field_validator('duration_hours', 'billable_duration_hours', mode='before')
    @classmethod
    def round_duration(cls, v):
        """Süreyi 2 ondalık basamağa yuvarla."""
        if v is not None:
            return round(Decimal(str(v)), 2)
        return v


class WorkLogCreate(WorkLogBase):
    """
    Yeni zaman girişi oluşturma isteği (FR 2.x).
    
    Standart kullanıcı bu şemayı kullanarak zaman girişi yapar.
    user_id token'dan otomatik olarak atanır.
    """
    pass


class WorkLogUpdate(BaseModel):
    """
    Zaman girişi güncelleme isteği.
    
    Sadece sahibi veya Admin güncelleyebilir.
    """
    customer_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    work_type_id: Optional[UUID] = None
    date_worked: Optional[date] = None
    duration_hours: Optional[Decimal] = Field(None, ge=0.25, le=24)
    billable_duration_hours: Optional[Decimal] = Field(None, ge=0, le=24)
    description: Optional[str] = Field(None, max_length=5000)
    activity_type_id: Optional[UUID] = None
    platform_id: Optional[UUID] = None
    work_line_id: Optional[UUID] = None
    issue_id: Optional[UUID] = None
    issue_key_manual: Optional[str] = None


class WorkLogResponse(WorkLogBase):
    """
    Zaman girişi yanıt şeması.
    
    İlişkili kayıtların adlarını da içerir (listeleme için).
    """
    id: int
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    
    # İlişkili kayıtların adları (opsiyonel, listeleme için)
    customer_name: Optional[str] = None
    project_name: Optional[str] = None
    work_type_name: Optional[str] = None
    user_name: Optional[str] = None  # auth-service'den alınır
    
    # Yeni Alanların Adları (v1.1)
    activity_type_name: Optional[str] = None
    platform_name: Optional[str] = None
    work_line_name: Optional[str] = None

    # Explicit IDs for Edit Mode (inherited from Base but ensuring visibility)
    activity_type_id: Optional[UUID] = None
    platform_id: Optional[UUID] = None
    work_line_id: Optional[UUID] = None
    issue_id: Optional[UUID] = None
    issue_key_manual: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)


class WorkLogListResponse(BaseModel):
    """Zaman girişi listesi yanıtı."""
    success: bool = True
    data: List[WorkLogResponse]
    total: int
