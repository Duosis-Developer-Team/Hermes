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
from decimal import Decimal
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


# -----------------------------------------------------------------------------
# D5 Ekibim + Dikkat, D6 Organizasyon ozeti (04-roller §5, §6)
# -----------------------------------------------------------------------------

class TeamMember(BaseModel):
    """Kisi basina: acik / gecikmis is, bu hafta girilen / beklenen efor.
    Siralama kisiye degil ISE gore (bekleyen is sayisi)."""
    user_id: UUID
    open_count: int
    overdue_count: int
    logged_hours: Decimal
    expected_hours: Decimal
    missing_days: int


class AttentionItem(HomeWorkItem):
    owner_user_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    project_name: Optional[str] = None
    days_overdue: int = 0


class TeamAttention(BaseModel):
    unassigned_count: int
    unassigned: List[AttentionItem]
    overdue_count: int
    overdue: List[AttentionItem]
    no_effort_user_ids: List[UUID]


class TeamResponse(BaseModel):
    """`eligible=false`: kullanicinin ekibi yok (atama yetkisi ya da proje
    liderligi yok) — istemci blogu render etmez; 403 degil, sessiz."""
    eligible: bool
    today: date
    week_start: date
    week_end: date
    members: List[TeamMember]
    attention: TeamAttention


class OrgSignal(BaseModel):
    key: str
    value: int
    delta: Optional[int] = None
    threshold: int
    level: str


class OrgCustomerRow(BaseModel):
    name: str
    hours: Decimal


class OrgResponse(BaseModel):
    period_start: date
    period_end: date
    total_hours: Decimal
    billable_hours: Decimal
    billable_ratio: Optional[int] = None
    by_customer: List[OrgCustomerRow]
    signals: List[OrgSignal]
