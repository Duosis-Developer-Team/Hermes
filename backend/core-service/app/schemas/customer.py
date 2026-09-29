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
    # Musteri logosu (additive): etag = logonun sha256 hex'i; logo yoksa null.
    # Frontend `/customers/{id}/logo?v=<etag>` ile onbellegi kirar.
    has_logo: bool = False
    logo_etag: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CustomerLogoResponse(BaseModel):
    """PUT /customers/{id}/logo yaniti."""
    has_logo: bool
    logo_etag: Optional[str] = None
