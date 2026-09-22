"""
=============================================================================
HERMES - Ana sayfa bloklari (PM rework P3 / D3–D6)
=============================================================================
Blok basina TEK uc (`/home/*`); her uc kendi iznini ister, izni olmayan
istemci blogu render etmez. Yanitlar EKRAN sekline gore hazirlanir
(kova → proje grubu → is): istemci gruplamaz, sunucu "simdi ne" sorusuna
hazir cevap verir (04-roller §4.2).
=============================================================================
"""
from datetime import date
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class HomeWorkItem(BaseModel):
    id: UUID
    item_key: str
    title: str
    item_type: str
    priority: str
    due_date: date
    state_name: str
    state_category: str
    project_id: UUID
    is_owner: bool


class HomeProjectGroup(BaseModel):
    """`Musteri · Proje` + sayi basligi; grup ici sira termin → oncelik."""
    project_id: UUID
    project_name: str
    customer_name: Optional[str] = None
    count: int
    items: List[HomeWorkItem]


class HomeBucket(BaseModel):
    count: int
    groups: List[HomeProjectGroup]


class MyWorkResponse(BaseModel):
    """Islerim blogu (D3): uc kova. Terminsiz isler ana sayfada YOK."""
    today: date
    week_start: date
    week_end: date
    overdue: HomeBucket
    due_today: HomeBucket
    this_week: HomeBucket
