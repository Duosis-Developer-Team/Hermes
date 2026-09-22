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

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session, joinedload

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..authz import user_has
from ..models.customer import Customer
from ..models.plan_time import PlanTime, PlanTimeAssignment
from ..models.project import Project
from ..models.project_membership import ProjectMembership
from ..models.work_item import (
    TERMINAL_CATEGORIES, WorkflowState, WorkItem, WorkItemParticipant,
)
from ..models.work_log import WorkLog
from .capacity_service import CAPACITY_TZ, resolve_week, today_in_tenant_tz, week_monday
from .meeting_service import list_meetings_for_user
from .task_service import (
    get_active_group_member_ids, get_assignable_group_ids, get_assignable_user_ids, is_task_admin,
)
from .work_item_service import LEAD_ROLES, _base_query, is_owner, visible_filter

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


__all__ = [
    "my_work", "my_week", "my_team", "org_summary", "group_by_project", "plan_occurs_on",
    "has_work_access", "team_scope", "PRIORITY_RANK", "ORG_THRESHOLDS",
]


# -----------------------------------------------------------------------------
# D5 Ekibim + Dikkat (04-roller §5)
# -----------------------------------------------------------------------------
# Ekip = is yonlendirebildigim kisiler (routing_relations: dogrudan +
# grup uyeleri) ∪ lideri oldugum projelerin uyeleri. tasks.admin icin:
# acik islerde gorunen herkes ∪ aktif proje uyeleri. Ton: karne degil
# KUYRUK — siralama bekleyen is sayisina gore.

ATTENTION_LIMIT = 5


def _led_project_ids(db: Session, me: UUID) -> List[UUID]:
    rows = db.query(ProjectMembership.project_id).filter(
        ProjectMembership.user_id == me,
        ProjectMembership.is_active.is_(True),
        ProjectMembership.member_role.in_(list(LEAD_ROLES)),
    ).all()
    return [r[0] for r in rows]


def _open_items_query(db: Session):
    return (
        _base_query(db)
        .join(WorkflowState, WorkflowState.id == WorkItem.state_id)
        .filter(WorkItem.archived_at.is_(None), WorkflowState.category.notin_(TERMINAL_CATEGORIES))
    )


def team_scope(db: Session, user: CurrentUser) -> Tuple[bool, set, List[UUID]]:
    """(eligible, team_user_ids, led_project_ids)."""
    me = UUID(user.id)
    led = _led_project_ids(db, me)
    admin = is_task_admin(user)
    assigner = user_has(user, Perm.TASKS_ASSIGN) or user_has(user, Perm.ISSUES_ASSIGN)
    if not (admin or assigner or led):
        return False, set(), []
    ids: set = set()
    if admin:
        for owner, in db.query(WorkItem.owner_user_id).filter(
            WorkItem.archived_at.is_(None), WorkItem.owner_user_id.isnot(None)
        ).distinct():
            ids.add(owner)
        for uid, in db.query(WorkItemParticipant.user_id).filter(
            WorkItemParticipant.role == "assignee"
        ).distinct():
            ids.add(uid)
        for uid, in db.query(ProjectMembership.user_id).filter(ProjectMembership.is_active.is_(True)).distinct():
            ids.add(uid)
    else:
        for scope in ("task", "issue"):
            ids.update(get_assignable_user_ids(db, user, scope))
            for gid in get_assignable_group_ids(db, user, scope):
                ids.update(get_active_group_member_ids(db, gid))
        if led:
            for uid, in db.query(ProjectMembership.user_id).filter(
                ProjectMembership.project_id.in_(led), ProjectMembership.is_active.is_(True)
            ).distinct():
                ids.add(uid)
    ids.discard(me)
    return True, ids, led


def _attention_dict(item: WorkItem, user: CurrentUser, today: date) -> dict:
    d = _item_dict(item, user)
    project = item.project
    d.update({
        "owner_user_id": item.owner_user_id,
        "customer_name": project.customer.name if project and project.customer else None,
        "project_name": project.name if project else None,
        "days_overdue": (today - item.due_date).days if item.due_date and item.due_date < today else 0,
    })
    return d


def _item_users(item: WorkItem) -> set:
    users = set()
    if item.owner_user_id:
        users.add(item.owner_user_id)
    for p in item.participants or []:
        if p.role == "assignee" and p.completed_at is None:
            users.add(p.user_id)
    return users


def my_team(db: Session, user: CurrentUser, *, today: Optional[date] = None) -> dict:
    today = today or today_in_tenant_tz()
    week_start = week_monday(today)
    week_end = week_start + timedelta(days=6)
    eligible, ids, led = team_scope(db, user)
    empty = {"unassigned_count": 0, "unassigned": [], "overdue_count": 0, "overdue": [], "no_effort_user_ids": []}
    base = {"eligible": eligible, "today": today, "week_start": week_start, "week_end": week_end}
    if not eligible:
        return {**base, "members": [], "attention": empty}

    open_items = _open_items_query(db).all()
    per_user = {uid: {"open": 0, "overdue": 0} for uid in ids}
    team_overdue: List[WorkItem] = []
    for item in open_items:
        users = _item_users(item) & ids
        if not users:
            continue
        overdue = item.due_date is not None and item.due_date < today
        for uid in users:
            per_user[uid]["open"] += 1
            if overdue:
                per_user[uid]["overdue"] += 1
        if overdue:
            team_overdue.append(item)

    # Sahipsiz isler: gorebildigim acik islerden owner'i olmayanlar (lider
    # icin liderlik ettigi projeler zaten gorunur kumede).
    vis = visible_filter(user)
    unassigned_q = _open_items_query(db).filter(WorkItem.owner_user_id.is_(None))
    if vis is not True:
        unassigned_q = unassigned_q.filter(vis)
    unassigned = sorted(unassigned_q.all(), key=lambda i: (i.created_at, i.item_number))

    members = []
    no_effort: List[UUID] = []
    for uid in ids:
        week = resolve_week(db, user_id=uid, week_start=week_start, today=today)
        missing = len(week.get("missing_days") or [])
        logged = week.get("logged_total") or Decimal("0")
        if missing and Decimal(str(logged)) <= 0:
            no_effort.append(uid)
        members.append({
            "user_id": uid,
            "open_count": per_user[uid]["open"],
            "overdue_count": per_user[uid]["overdue"],
            "logged_hours": logged,
            "expected_hours": week.get("expected_total") or Decimal("0"),
            "missing_days": missing,
        })
    # Kuyruk sirasi: bekleyen (acik) is, sonra gecikmis; kisi adi DEGIL.
    members.sort(key=lambda m: (-m["open_count"], -m["overdue_count"], str(m["user_id"])))
    team_overdue.sort(key=lambda i: (i.due_date, PRIORITY_RANK.get(i.priority, 9), i.item_number))

    return {
        **base,
        "members": members,
        "attention": {
            "unassigned_count": len(unassigned),
            "unassigned": [_attention_dict(i, user, today) for i in unassigned[:ATTENTION_LIMIT]],
            "overdue_count": len(team_overdue),
            "overdue": [_attention_dict(i, user, today) for i in team_overdue[:ATTENTION_LIMIT]],
            "no_effort_user_ids": sorted(no_effort, key=str),
        },
    }


# -----------------------------------------------------------------------------
# D6 Organizasyon ozeti (04-roller §6)
# -----------------------------------------------------------------------------
# Donem KPI'lari mevcut dashboard verisinden (work_logs); anomali
# sinyalleri ucu de mevcut tablolardan SAYIM. Deger, esik asildiginda
# one cikmasinda: esikler burada, istemci yalniz `level`i boyar.
#
#   no_entry_users  son 4 haftada efor girmis olup BU hafta hic girmemis
#                   kisi (gecmis calisma gunu varsa) — core'da kullanici
#                   tablosu yok, tanim work_logs'tan turetilir
#   overdue         acik + termini gecmis is; delta = bu hafta gecikmeye
#                   dusenler (termin son 7 gun icinde)
#   unassigned      acik + sahipsiz is birikmesi

ORG_THRESHOLDS = {"no_entry_users": 1, "overdue": 5, "unassigned": 3}
ORG_CUSTOMER_LIMIT = 5


def _signal(key: str, value: int, *, delta: Optional[int] = None, warn: bool) -> dict:
    return {
        "key": key, "value": value, "delta": delta,
        "threshold": ORG_THRESHOLDS[key], "level": "warn" if warn else "ok",
    }


def org_summary(db: Session, user: CurrentUser, *, start: Optional[date] = None,
                end: Optional[date] = None, today: Optional[date] = None) -> dict:
    today = today or today_in_tenant_tz()
    period_end = end or today
    period_start = start or period_end.replace(day=1)
    if period_start > period_end:
        period_start, period_end = period_end, period_start

    total, billable = db.query(
        func.coalesce(func.sum(WorkLog.duration_hours), 0),
        func.coalesce(func.sum(WorkLog.billable_duration_hours), 0),
    ).filter(WorkLog.date_worked >= period_start, WorkLog.date_worked <= period_end).one()
    total = Decimal(str(total))
    billable = Decimal(str(billable))
    ratio = int(round(billable / total * 100)) if total > 0 else None

    by_customer = [
        {"name": name, "hours": Decimal(str(hours))}
        for name, hours in db.query(Customer.name, func.sum(WorkLog.duration_hours).label("hours"))
        .join(WorkLog, WorkLog.customer_id == Customer.id)
        .filter(WorkLog.date_worked >= period_start, WorkLog.date_worked <= period_end)
        .group_by(Customer.name).order_by(desc("hours")).limit(ORG_CUSTOMER_LIMIT).all()
    ]

    week_start = week_monday(today)
    week_end = week_start + timedelta(days=6)
    recent = {
        r[0] for r in db.query(WorkLog.user_id).filter(
            WorkLog.date_worked >= week_start - timedelta(days=28),
            WorkLog.date_worked < week_start,
        ).distinct()
    }
    this_week = {
        r[0] for r in db.query(WorkLog.user_id).filter(
            WorkLog.date_worked >= week_start, WorkLog.date_worked <= week_end,
        ).distinct()
    }
    # Pazartesi gunu kimse "girmemis" sayilmaz: gecmis calisma gunu yok.
    no_entry = len(recent - this_week) if today > week_start else 0

    open_q = db.query(WorkItem).join(WorkflowState, WorkflowState.id == WorkItem.state_id).filter(
        WorkItem.archived_at.is_(None), WorkflowState.category.notin_(TERMINAL_CATEGORIES),
    )
    overdue_count = open_q.filter(WorkItem.due_date.isnot(None), WorkItem.due_date < today).count()
    overdue_new = open_q.filter(
        WorkItem.due_date.isnot(None), WorkItem.due_date < today,
        WorkItem.due_date >= today - timedelta(days=7),
    ).count()
    unassigned = open_q.filter(WorkItem.owner_user_id.is_(None)).count()

    return {
        "period_start": period_start,
        "period_end": period_end,
        "total_hours": total,
        "billable_hours": billable,
        "billable_ratio": ratio,
        "by_customer": by_customer,
        "signals": [
            _signal("no_entry_users", no_entry, warn=no_entry >= ORG_THRESHOLDS["no_entry_users"]),
            _signal("overdue", overdue_count, delta=overdue_new,
                    warn=overdue_count >= ORG_THRESHOLDS["overdue"] or overdue_new >= 1),
            _signal("unassigned", unassigned, warn=unassigned >= ORG_THRESHOLDS["unassigned"]),
        ],
    }
