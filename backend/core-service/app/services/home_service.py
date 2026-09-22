"""
=============================================================================
HERMES - Ana sayfa blok servisi (PM rework P3 / D3)
=============================================================================
Islerim blogu (04-roller §4.2): liste degil UC KOVA —
  gecikmis  due_date < bugun
  bugun     due_date = bugun
  bu hafta  bugun < due_date <= haftanin son gunu
Ortak kosullar: terminli, arsivlenmemis, durum kategorisi done/cancelled
degil, kullanici owner VEYA (kendi payini bitirmemis) assignee.

"Bugun" kiraci saat dilimine gore (capacity_service ile ayni kapi);
hafta Pazartesi'den baslar. Kova icinde isler PROJEYE gore gruplanir,
grup basligi `Musteri · Proje` + sayi; grup ici sira termin → oncelik;
gruplar en erken termine gore.
=============================================================================
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..authz import user_has
from ..models.plan_time import PlanTime, PlanTimeAssignment
from ..models.project import Project
from ..models.work_item import (
    TERMINAL_CATEGORIES, WorkflowState, WorkItem, WorkItemParticipant,
)
from .capacity_service import CAPACITY_TZ, today_in_tenant_tz, week_monday
from .meeting_service import list_meetings_for_user
from .task_service import is_task_admin
from .work_item_service import _base_query, is_owner

PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3}


def _mine_open_due_items(db: Session, user: CurrentUser, *, due_to: date) -> List[WorkItem]:
    me = UUID(user.id)
    my_open_assignee = select(WorkItemParticipant.work_item_id).where(
        WorkItemParticipant.user_id == me,
        WorkItemParticipant.role == "assignee",
        WorkItemParticipant.completed_at.is_(None),
    )
    q = (
        _base_query(db)
        .join(WorkflowState, WorkflowState.id == WorkItem.state_id)
        .filter(
            WorkItem.archived_at.is_(None),
            WorkItem.due_date.isnot(None),
            WorkItem.due_date <= due_to,
            WorkflowState.category.notin_(TERMINAL_CATEGORIES),
            or_(WorkItem.owner_user_id == me, WorkItem.id.in_(my_open_assignee)),
        )
    )
    return q.all()


def _item_dict(item: WorkItem, user: CurrentUser) -> dict:
    return {
        "id": item.id,
        "item_key": item.item_key,
        "title": item.title,
        "item_type": item.item_type,
        "priority": item.priority,
        "due_date": item.due_date,
        "state_name": item.state.name if item.state else "",
        "state_category": item.state.category if item.state else "",
        "project_id": item.project_id,
        "is_owner": is_owner(user, item),
    }


def _item_sort_key(item: WorkItem):
    # Ayni termin + oncelik → olusturma sirasi (numara; kod METIN olarak
    # karsilastirilirsa TASK-10 < TASK-9 olurdu).
    return (item.due_date, PRIORITY_RANK.get(item.priority, 9), item.item_number)


def group_by_project(items: List[WorkItem], user: CurrentUser) -> List[dict]:
    """Proje gruplari: baslik `Musteri · Proje`, ici termin → oncelik,
    gruplar en erken termin → proje adi."""
    groups: Dict[UUID, dict] = {}
    for item in sorted(items, key=_item_sort_key):
        project: Optional[Project] = item.project
        g = groups.get(item.project_id)
        if g is None:
            g = groups[item.project_id] = {
                "project_id": item.project_id,
                "project_name": project.name if project else "",
                "customer_name": (
                    project.customer.name if project and project.customer else None
                ),
                "count": 0,
                "items": [],
            }
        g["items"].append(_item_dict(item, user))
        g["count"] += 1
    out = list(groups.values())
    out.sort(key=lambda g: (g["items"][0]["due_date"], g["customer_name"] or "", g["project_name"]))
    return out


def _bucket(items: List[WorkItem], user: CurrentUser) -> dict:
    groups = group_by_project(items, user)
    return {"count": sum(g["count"] for g in groups), "groups": groups}


def my_work(db: Session, user: CurrentUser, *, today: Optional[date] = None) -> dict:
    today = today or today_in_tenant_tz()
    week_start = week_monday(today)
    week_end = week_start + timedelta(days=6)
    items = _mine_open_due_items(db, user, due_to=week_end)
    overdue = [i for i in items if i.due_date < today]
    due_today = [i for i in items if i.due_date == today]
    this_week = [i for i in items if today < i.due_date <= week_end]
    return {
        "today": today,
        "week_start": week_start,
        "week_end": week_end,
        "overdue": _bucket(overdue, user),
        "due_today": _bucket(due_today, user),
        "this_week": _bucket(this_week, user),
    }


def has_work_access(user: CurrentUser) -> bool:
    """Islerim/termin verisi: herhangi bir is modulune erisim (task VEYA
    issue) ya da tasks.admin. Fail-closed."""
    return is_task_admin(user) or user_has(user, Perm.TASKS_ACCESS) or user_has(user, Perm.ISSUES_ACCESS)


# -----------------------------------------------------------------------------
# D4 Takvimim — toplanti + planli zaman + termin, gun gun (04-roller §4.3)
# -----------------------------------------------------------------------------

def plan_occurs_on(plan: PlanTime, day: date) -> bool:
    """WeeklyListView ile AYNI kural (tek kaynak olmasi icin buraya da
    yazildi; sapma testle kilitli): baslangictan once asla; weekly ayni
    hafta gunu; monthly 28 gunde bir; one_time/daily baslangic–bitis."""
    if day < plan.start_date:
        return False
    if plan.recurrence == "weekly":
        return day.weekday() == plan.start_date.weekday()
    if plan.recurrence == "monthly":
        return (day - plan.start_date).days % 28 == 0
    return plan.end_date is None or day <= plan.end_date


def _my_plan_assignments(db: Session, me: UUID, *, week_start: date, week_end: date):
    """plan_times.get_my_plan_times ile ayni pencere: tekrarli planlar
    baslangictan sonra hep aday; tek seferlikler araligi kesmeli."""
    return (
        db.query(PlanTimeAssignment)
        .join(PlanTime, PlanTimeAssignment.plan_time_id == PlanTime.id)
        .options(joinedload(PlanTimeAssignment.plan_time).joinedload(PlanTime.customer),
                 joinedload(PlanTimeAssignment.plan_time).joinedload(PlanTime.project))
        .filter(
            PlanTimeAssignment.user_id == me,
            PlanTimeAssignment.status != "rejected",
            PlanTime.start_date <= week_end,
            or_(PlanTime.end_date >= week_start, PlanTime.recurrence.in_(["weekly", "monthly", "daily"])),
        )
        .all()
    )


def _plan_dict(assignment: PlanTimeAssignment) -> dict:
    p = assignment.plan_time
    return {
        "id": p.id,
        "assignment_id": assignment.id,
        "customer_name": p.customer.name if p.customer else None,
        "project_name": p.project.name if p.project else None,
        "start_time": p.start_time,
        "end_time": p.end_time,
        "description": p.description,
        "recurrence": p.recurrence or "one_time",
        "status": assignment.status or "pending",
    }


def _meeting_dict(m) -> dict:
    return {
        "id": m.id,
        "subject": m.subject,
        "start_datetime": m.start_datetime,
        "end_datetime": m.end_datetime,
        "is_online_meeting": bool(m.is_online_meeting),
        "join_url": m.join_url,
    }


def _local_date(dt: datetime) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CAPACITY_TZ).date()


def my_week(db: Session, user: CurrentUser, *, start: Optional[date] = None,
            today: Optional[date] = None) -> dict:
    today = today or today_in_tenant_tz()
    week_start = week_monday(start or today)
    week_end = week_start + timedelta(days=6)
    me = UUID(user.id)
    days = [week_start + timedelta(days=i) for i in range(7)]

    # Toplantilar: HEP kendi katildiklarim (meetings.admin olsam da) —
    # "nerede olmam gerekiyor" sorusu kisiseldir. Gun, kiraci saat
    # dilimine gore; UTC pencere bir gun genis tutulup yerelde kirpilir.
    meetings = list_meetings_for_user(
        db, user, start_date=week_start - timedelta(days=1),
        end_date=week_end + timedelta(days=1), target_user_ids=[me],
    )
    by_day: Dict[date, dict] = {d: {"meetings": [], "plans": [], "items": []} for d in days}
    for m in meetings:
        d = _local_date(m.start_datetime)
        if d in by_day:
            by_day[d]["meetings"].append(_meeting_dict(m))

    for a in _my_plan_assignments(db, me, week_start=week_start, week_end=week_end):
        for d in days:
            if plan_occurs_on(a.plan_time, d):
                by_day[d]["plans"].append(_plan_dict(a))

    if has_work_access(user):
        for item in sorted(_mine_open_due_items(db, user, due_to=week_end), key=_item_sort_key):
            if item.due_date >= week_start:
                by_day[item.due_date]["items"].append(_item_dict(item, user))

    for d in days:
        by_day[d]["plans"].sort(key=lambda p: (p["start_time"] or "", p["project_name"] or ""))

    return {
        "today": today,
        "week_start": week_start,
        "week_end": week_end,
        "days": [{"date": d, "is_today": d == today, **by_day[d]} for d in days],
    }


__all__ = ["my_work", "my_week", "group_by_project", "plan_occurs_on", "has_work_access", "PRIORITY_RANK"]
