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
from datetime import date, datetime
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


# -----------------------------------------------------------------------------
# D4 Takvimim: uc kaynak tek seritte (toplanti · planli zaman · termin)
# -----------------------------------------------------------------------------

class WeekMeeting(BaseModel):
    id: UUID
    subject: str
    start_datetime: datetime
    end_datetime: datetime
    is_online_meeting: bool = False
    join_url: Optional[str] = None


class WeekPlan(BaseModel):
    id: UUID
    assignment_id: UUID
    customer_name: Optional[str] = None
    project_name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None
    recurrence: str = "one_time"
    status: str = "pending"


class WeekDay(BaseModel):
    date: date
    is_today: bool
    meetings: List[WeekMeeting]
    plans: List[WeekPlan]
    items: List[HomeWorkItem]


class MyWeekResponse(BaseModel):
    today: date
    week_start: date
    week_end: date
    days: List[WeekDay]
