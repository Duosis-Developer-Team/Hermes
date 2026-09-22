"""
=============================================================================
HERMES - Kayitli gorunum semalari (PM rework P3.5 / E2)
=============================================================================
`filter_json` istemci sozlesmesidir (features/tasks/model/views.js ile
birebir); sunucu yalnizca SEKLINI dogrular (bilinen anahtarlar, boyut),
anlamini yorumlamaz — sorgu yine mevcut /tasks listesi uzerinden kurulur.
Sistem gorunumleri KODDA yasar (istemci), tabloya yazilmaz: kiraci basina
tohum satiri surumlerle drift ederdi.
=============================================================================
"""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ViewScopeLiteral = Literal["personal", "shared"]
ViewLayoutLiteral = Literal["list", "board", "calendar"]

FILTER_KEYS = frozenset({
    "scope", "type", "status", "status_exclude", "priority", "customer_id",
    "project_id", "sub_project_id", "owner", "due", "range", "archive",
    "group_by", "assignee",
})
MAX_FILTER_BYTES = 4096


def _check_filter(value: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("filter_json must be an object")
    unknown = sorted(set(value) - FILTER_KEYS)
    if unknown:
        raise ValueError(f"unknown filter keys: {', '.join(unknown)}")
    import json
    if len(json.dumps(value)) > MAX_FILTER_BYTES:
        raise ValueError("filter_json too large")
    return value


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: ViewScopeLiteral = "personal"
    layout: ViewLayoutLiteral = "list"
    filter_json: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("filter_json")
    @classmethod
    def _filter(cls, v):
        return _check_filter(v)


class SavedViewUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    scope: Optional[ViewScopeLiteral] = None
    layout: Optional[ViewLayoutLiteral] = None
    filter_json: Optional[Dict[str, Any]] = None
    position: Optional[int] = Field(default=None, ge=0, le=10000)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("filter_json")
    @classmethod
    def _filter(cls, v):
        return None if v is None else _check_filter(v)


class SavedViewResponse(BaseModel):
    id: UUID
    name: str
    scope: str
    layout: str
    filter_json: Dict[str, Any]
    owner_user_id: Optional[UUID] = None
    position: Optional[int] = None
    can_edit: bool
    created_at: datetime
    updated_at: datetime


class SavedViewListResponse(BaseModel):
    items: List[SavedViewResponse]
