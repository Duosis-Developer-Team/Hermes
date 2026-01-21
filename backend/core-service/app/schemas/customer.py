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
    pass


class CustomerUpdate(BaseModel):
    """Müşteri güncelleme isteği. Tüm alanlar opsiyonel."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_active: Optional[bool] = None


class CustomerResponse(CustomerBase):
    """Müşteri yanıt şeması."""
    id: UUID
    is_active: bool
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
