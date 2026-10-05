# =============================================================================
# HERMES - Proje turu semalari
# =============================================================================
# Renk serbest metin degil: sabit sozlukten bir anahtar (Literal ile hem
# dogrulanir hem OpenAPI'de listelenir).
# =============================================================================

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProjectTypeColor = Literal[
    "red", "orange", "amber", "yellow", "green", "teal",
    "cyan", "blue", "indigo", "violet", "pink", "slate",
]


def _clean_name(v):
    if v is None:
        return v
    v = " ".join(str(v).split())
    if not v:
        raise ValueError("Name cannot be empty.")
    return v


class ProjectTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, examples=["Destek"])
    color: ProjectTypeColor = Field(..., examples=["blue"])

    _name = field_validator("name")(_clean_name)


class ProjectTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[ProjectTypeColor] = None

    _name = field_validator("name")(_clean_name)


class ProjectTypeResponse(BaseModel):
    id: UUID
    name: str
    color: str
    # Bu turdeki proje sayisi (silme kararinda ve listede gosterilir).
    project_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
