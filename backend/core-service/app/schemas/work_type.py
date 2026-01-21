# =============================================================================
# HERMES PLATFORM - Work Type Schemas (Pydantic)
# =============================================================================

from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class WorkTypeBase(BaseModel):
    """İş tipi şemalarının temel sınıfı."""
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="İş tipi adı",
        examples=["Geliştirme", "Toplantı", "Destek"]
    )


class WorkTypeCreate(WorkTypeBase):
    """Yeni iş tipi oluşturma isteği (FR 3.2)."""
    pass


class WorkTypeUpdate(BaseModel):
    """İş tipi güncelleme isteği."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None


class WorkTypeResponse(WorkTypeBase):
    """İş tipi yanıt şeması."""
    id: UUID
    is_active: bool
    
    model_config = ConfigDict(from_attributes=True)
