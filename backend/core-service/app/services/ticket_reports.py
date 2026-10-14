# =============================================================================
# HERMES core — Talep raporlari + CSAT (Dalga C, 00-plan §4.3)
# =============================================================================
# Rapor KAPSAMI hub gorunurlugudur: yonetici (`tickets.admin`) saglayicinin
# tamamini, ajan kendi ekiplerinin taleplerini gorur. Ayni predicate
# (`ticket_visibility.hub_predicate`) liste ile rapor arasinda celiski
# birakmaz: "raporda 40 talep var ama listede 12" olamaz.
#
# Sureler DUVAR SAATI dakikasidir (mesai degil); SLA uyumu ise SLA
# saatinin kendi vadesine gore hesaplanir (mesai takvimli). Medyan
# PostgreSQL percentile_cont ile.
# =============================================================================

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from ..models.ticket_helpdesk import TicketCsat, TicketSlaClock
from ..models.ticketing import Ticket, TicketEvent, TicketResolution
from ..models.user_group import UserGroup
from ..ticket_contract import EVENT_TICKET_REOPENED, OPEN_STATUSES
from . import ticket_visibility as visibility
from .ticket_service import TicketValidationError

MAX_DAYS = 366


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _minutes(expr):
    return func.extract("epoch", expr) / 60.0


def _median(values_expr):
    return func.percentile_cont(0.5).within_group(values_expr)


def period(days: Optional[int] = None, start: Optional[datetime] = None,
           end: Optional[datetime] = None):
    end = end or _now()
    start = start or end - timedelta(days=days or 30)
    if end <= start:
        raise TicketValidationError("The report period must end after it starts.", code="validation_error")
    if (end - start).days > MAX_DAYS:
        raise TicketValidationError("The report period can be at most one year.", code="validation_error")
    return start, end


def build(db: Session, scope: visibility.HubScope, *, start: datetime, end: datetime,
          group_id: Optional[UUID] = None, tz: str = "Europe/Istanbul") -> dict:
    scoped = [p for p in (visibility.hub_predicate(scope),) if p is not None]
    if group_id:
        scoped.append(Ticket.assigned_group_id == group_id)

    def q(*cols):
        # FROM her zaman `tickets`: kapsam predicate'i ona baglidir; diger
        # tablolar acik JOIN ile eklenir.
        return db.query(*cols).select_from(Ticket).filter(*scoped)

    in_created = and_(Ticket.created_at >= start, Ticket.created_at < end)
    in_resolved = and_(Ticket.resolved_at >= start, Ticket.resolved_at < end)

    created = q(func.count(Ticket.id)).filter(in_created).scalar() or 0
    resolved = q(func.count(Ticket.id)).filter(in_resolved).scalar() or 0
    backlog = q(func.count(Ticket.id)).filter(Ticket.status.in_(OPEN_STATUSES)).scalar() or 0
    median_first = q(_median(_minutes(Ticket.first_response_at - Ticket.created_at))).filter(
        in_created, Ticket.first_response_at.isnot(None)).scalar()
    median_resolution = q(_median(_minutes(Ticket.resolved_at - Ticket.created_at))).filter(
        in_resolved).scalar()
    reopened = (
        q(func.count(TicketEvent.id))
        .join(TicketEvent, TicketEvent.ticket_id == Ticket.id)
        .filter(TicketEvent.event_type == EVENT_TICKET_REOPENED,
                TicketEvent.occurred_at >= start, TicketEvent.occurred_at < end)
        .scalar() or 0
    )

    # --- SLA uyumu ---------------------------------------------------------
    now = _now()
    fr_due = TicketSlaClock.first_response_due_at
    fr_row = (
        q(func.count(TicketSlaClock.id),
          func.sum(case((and_(TicketSlaClock.first_response_at.isnot(None),
                              TicketSlaClock.first_response_at <= fr_due), 1), else_=0)))
        .join(TicketSlaClock, TicketSlaClock.ticket_id == Ticket.id)
        .filter(in_created, fr_due.isnot(None),
                (TicketSlaClock.first_response_at.isnot(None)) | (fr_due < now))
        .one()
    )
    res_due = TicketSlaClock.resolution_due_at
    res_row = (
        q(func.count(TicketSlaClock.id),
          func.sum(case((and_(TicketSlaClock.resolution_at.isnot(None),
                              TicketSlaClock.resolution_at <= res_due), 1), else_=0)))
        .join(TicketSlaClock, TicketSlaClock.ticket_id == Ticket.id)
        .filter(in_resolved, res_due.isnot(None))
        .one()
    )

    def pct(row):
        total, met = int(row[0] or 0), int(row[1] or 0)
        return {"total": total, "met": met, "rate": round(met / total, 4) if total else None}

    # --- CSAT --------------------------------------------------------------
    csat_row = (
        q(func.count(TicketCsat.id), func.avg(TicketCsat.rating),
          func.sum(case((TicketCsat.rating >= 4, 1), else_=0)))
        .join(TicketCsat, TicketCsat.ticket_id == Ticket.id)
        .filter(TicketCsat.updated_at >= start, TicketCsat.updated_at < end)
        .one()
    )
    csat_count = int(csat_row[0] or 0)

    # --- Gunluk seri (yerel gun) -------------------------------------------
    def daily(col, cond):
        day = func.date(func.timezone(tz, col))
        return dict(q(day, func.count(Ticket.id)).filter(cond).group_by(day).all())

    created_by_day = daily(Ticket.created_at, in_created)
    resolved_by_day = daily(Ticket.resolved_at, in_resolved)
    from zoneinfo import ZoneInfo

    # Kovalar YEREL gundur; seri de yerel gunlerle yurur (gece yarisina
    # yakin UTC/yerel tarih farki talepleri seriden dusurmesin).
    local = ZoneInfo(tz)
    series: List[dict] = []
    cursor = start.astimezone(local).date()
    last = end.astimezone(local).date()
    while cursor <= last:
        series.append({"date": cursor.isoformat(),
                       "created": int(created_by_day.get(cursor, 0)),
                       "resolved": int(resolved_by_day.get(cursor, 0))})
        cursor += timedelta(days=1)

    # --- Ekip / ajan / dagilim ---------------------------------------------
    teams: Dict = {}
    for gid, name, n in (
        q(Ticket.assigned_group_id, Ticket.assigned_group_name_snapshot, func.count(Ticket.id))
        .filter(in_created).group_by(Ticket.assigned_group_id, Ticket.assigned_group_name_snapshot).all()
    ):
        teams.setdefault(gid, {"group_id": str(gid), "name": name, "created": 0, "resolved": 0, "open": 0,
                               "median_resolution_minutes": None})["created"] += int(n)
    for gid, n, med in (
        q(Ticket.assigned_group_id, func.count(Ticket.id),
          _median(_minutes(Ticket.resolved_at - Ticket.created_at)))
        .filter(in_resolved).group_by(Ticket.assigned_group_id).all()
    ):
        row = teams.setdefault(gid, {"group_id": str(gid), "name": None, "created": 0, "resolved": 0,
                                     "open": 0, "median_resolution_minutes": None})
        row["resolved"], row["median_resolution_minutes"] = int(n), _round(med)
    for gid, n in (
        q(Ticket.assigned_group_id, func.count(Ticket.id))
        .filter(Ticket.status.in_(OPEN_STATUSES)).group_by(Ticket.assigned_group_id).all()
    ):
        teams.setdefault(gid, {"group_id": str(gid), "name": None, "created": 0, "resolved": 0, "open": 0,
                               "median_resolution_minutes": None})["open"] = int(n)
    names = {g.id: g.name for g in db.query(UserGroup).filter(UserGroup.id.in_(list(teams))).all()} if teams else {}
    for gid, row in teams.items():
        row["name"] = names.get(gid) or row["name"] or "—"

    agents: Dict = {}
    for uid, n in (
        q(TicketResolution.resolved_by_user_id, func.count(TicketResolution.id))
        .join(TicketResolution, TicketResolution.ticket_id == Ticket.id)
        .filter(TicketResolution.resolved_at >= start, TicketResolution.resolved_at < end,
                TicketResolution.resolved_by_user_id.isnot(None))
        .group_by(TicketResolution.resolved_by_user_id).all()
    ):
        agents.setdefault(uid, {"user_id": str(uid), "resolved": 0, "open": 0})["resolved"] = int(n)
    for uid, n in (
        q(Ticket.assigned_user_id, func.count(Ticket.id))
        .filter(Ticket.status.in_(OPEN_STATUSES), Ticket.assigned_user_id.isnot(None))
        .group_by(Ticket.assigned_user_id).all()
    ):
        agents.setdefault(uid, {"user_id": str(uid), "resolved": 0, "open": 0})["open"] = int(n)

    def dist(col):
        return {k: int(v) for k, v in q(col, func.count(Ticket.id)).filter(in_created).group_by(col).all()}

    return {
        "period": {"start": start, "end": end},
        "totals": {
            "created": int(created), "resolved": int(resolved), "backlog": int(backlog),
            "reopened": int(reopened),
            "median_first_response_minutes": _round(median_first),
            "median_resolution_minutes": _round(median_resolution),
        },
        "sla": {"first_response": pct(fr_row), "resolution": pct(res_row)},
        "csat": {
            "responses": csat_count,
            "average": round(float(csat_row[1]), 2) if csat_count else None,
            "satisfied_rate": round(int(csat_row[2] or 0) / csat_count, 4) if csat_count else None,
        },
        "series": series,
        "teams": sorted(teams.values(), key=lambda r: (-r["created"], r["name"])),
        "agents": sorted(agents.values(), key=lambda r: (-r["resolved"], -r["open"])),
        "by_category": dist(Ticket.category),
        "by_priority": dist(Ticket.priority),
    }


def _round(value):
    return round(float(value), 1) if value is not None else None


# =============================================================================
# CSAT
# =============================================================================

CSAT_STATUSES = ("resolved", "closed")


def csat_of(db: Session, ticket_id) -> Optional[TicketCsat]:
    return db.query(TicketCsat).filter(TicketCsat.ticket_id == ticket_id).first()


def submit_csat(db: Session, ticket: Ticket, *, requester: str, rating: int,
                comment: Optional[str]) -> TicketCsat:
    """Talep EDEN (talebin kendisi) puanlar; yalniz cozuldu/kapandi'da."""
    if ticket.status not in CSAT_STATUSES:
        raise TicketValidationError("Only resolved or closed tickets can be rated.", code="validation_error")
    if str(ticket.requester_source_user_id) != str(requester):
        raise TicketValidationError("Only the requester can rate this ticket.", code="forbidden")
    if not 1 <= int(rating) <= 5:
        raise TicketValidationError("Rating must be between 1 and 5.", code="validation_error")
    clean = (comment or "").strip()[:1000] or None
    row = csat_of(db, ticket.id)
    if row is None:
        row = TicketCsat(ticket_id=ticket.id, rating=int(rating), comment=clean,
                         requester_source_user_id=str(requester))
        db.add(row)
    else:
        row.rating, row.comment, row.updated_at = int(rating), clean, _now()
    db.flush()
    return row
