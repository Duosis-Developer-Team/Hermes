# =============================================================================
# HERMES PLATFORM - Project Schemas (Pydantic)
# =============================================================================

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class ProjectBase(BaseModel):
    """Proje şemalarının temel sınıfı."""
    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Proje adı",
        examples=["E-Ticaret Platformu", "İç Araçlar Bakımı"]
    )
    customer_id: Optional[UUID] = Field(
        None,
        description="Bağlı müşteri ID'si (iç projeler için NULL)"
    )


class ProjectCreate(ProjectBase):
    """Yeni proje oluşturma isteği (FR 3.3)."""
    project_key: Optional[str] = Field(None, min_length=1, max_length=50)
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = Field(
        None,
        ge=1,
        description="Sözleşme süresi (gün)"
    )


class ProjectUpdate(BaseModel):
    """Proje güncelleme isteği."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    customer_id: Optional[UUID] = None
    project_key: Optional[str] = Field(None, min_length=1, max_length=50)
    is_active: Optional[bool] = None
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = Field(None, ge=1)


class ProjectResponse(ProjectBase):
    """Proje yanıt şeması."""
    id: UUID
    is_active: bool
    created_at: datetime
    customer_name: Optional[str] = Field(None, description="Müşteri adı (varsa)")
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)
