# =============================================================================
# HERMES PLATFORM - Customer Schemas (Pydantic)
# =============================================================================

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class CustomerBase(BaseModel):
    """Müşteri şemalarının temel sınıfı."""
    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Müşteri adı",
        examples=["ABC Teknoloji A.Ş."]
    )


class CustomerCreate(CustomerBase):
    """Yeni müşteri oluşturma isteği (FR 3.1)."""
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = None


class CustomerUpdate(BaseModel):
    """Müşteri güncelleme isteği. Tüm alanlar opsiyonel."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_active: Optional[bool] = None
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = None


class CustomerResponse(CustomerBase):
    """Müşteri yanıt şeması."""
    id: UUID
    is_active: bool
    created_at: datetime
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)
