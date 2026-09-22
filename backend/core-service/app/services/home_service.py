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

from datetime import date, timedelta
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from shared.auth import CurrentUser

from ..models.project import Project
from ..models.work_item import (
    TERMINAL_CATEGORIES, WorkflowState, WorkItem, WorkItemParticipant,
)
from .capacity_service import today_in_tenant_tz, week_monday
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


__all__ = ["my_work", "group_by_project", "PRIORITY_RANK"]
