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
    # PM rework A8 (karar 3): iş kalemleri bu varsayılanı miras alır.
    is_billable_default: bool = True
    # Proje turu + jenerik logo glifi (0016). Renk turden gelir.
    project_type_id: Optional[UUID] = None
    logo_glyph: Optional[str] = Field(None, max_length=32)


class ProjectUpdate(BaseModel):
    """Proje güncelleme isteği."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    customer_id: Optional[UUID] = None
    project_key: Optional[str] = Field(None, min_length=1, max_length=50)
    is_active: Optional[bool] = None
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = Field(None, ge=1)
    is_billable_default: Optional[bool] = None
    project_type_id: Optional[UUID] = None
    logo_glyph: Optional[str] = Field(None, max_length=32)


class ProjectResponse(ProjectBase):
    """Proje yanıt şeması."""
    id: UUID
    is_active: bool
    created_at: datetime
    customer_name: Optional[str] = Field(None, description="Müşteri adı (varsa)")
    contract_start_date: Optional[datetime] = None
    contract_duration_days: Optional[int] = None
    is_billable_default: bool = True
    # Proje logosu (additive): etag = logonun sha256 hex'i; logo yoksa null.
    # Frontend `/projects/{id}/logo?v=<etag>` ile onbellegi kirar.
    has_logo: bool = False
    logo_etag: Optional[str] = None
    # Proje turu (0016): ad + renk anahtari; jenerik logo = tur rengi + glif.
    project_type_id: Optional[UUID] = None
    project_type_name: Optional[str] = None
    project_type_color: Optional[str] = None
    logo_glyph: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ProjectLogoResponse(BaseModel):
    """PUT /projects/{id}/logo yaniti."""
    has_logo: bool
    logo_etag: Optional[str] = None
