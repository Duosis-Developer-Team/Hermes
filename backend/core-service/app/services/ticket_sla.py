# =============================================================================
# HERMES core — Talep SLA'si (Dalga B): mesai takvimi + saat kurallari
# =============================================================================
# Saglayici basina TEK politika: oncelik → {ilk yanit, cozum} hedefi (mesai
# dakikasi) + mesai takvimi (saat dilimi, haftalik pencereler, tatiller).
# Politika yoksa veya pasifse SLA YOKTUR (sessiz — modul istege baglidir).
#
# Saat kurallari (talep yasam dongusuyle AYNI transaction'da):
#   acilis              → ilk yanit + cozum hedefleri baslar
#   ilk public ajan yaniti → ilk yanit KARSILANDI
#   musteride bekliyor  → cozum saati DURUR (kalan mesai saniyesi saklanir)
#   tekrar ise donus    → saat kaldigi yerden devam eder
#   cozuldu/kapandi/iptal → cozum KARSILANDI (saat durur)
#   yeniden acildi      → cozum hedefi yeniden baslar (tam sure)
#   oncelik degisti     → karsilanmamis hedefler yeni oncelige gore
#
# Ihlal OKUMADA hesaplanir (`clock_state`): ayri bir "ihlal isi" yoktur;
# ekran ve liste filtresi ayni kurali kullanir.
# =============================================================================

from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from ..models.ticket_helpdesk import TicketSlaClock, TicketSlaPolicy
from ..ticket_contract import PRIORITIES

#: Yeni politika icin onerilen varsayilanlar (dakika, mesai).
DEFAULT_TARGETS: Dict[str, Dict[str, int]] = {
    "urgent": {"first_response": 60, "resolution": 240},
    "high": {"first_response": 240, "resolution": 1440},
    "normal": {"first_response": 480, "resolution": 4320},
    "low": {"first_response": 1440, "resolution": 7200},
}
WORKDAY = [["09:00", "18:00"]]
DEFAULT_CALENDAR = {
    "timezone": "Europe/Istanbul",
    "days": {"1": WORKDAY, "2": WORKDAY, "3": WORKDAY, "4": WORKDAY,
             "5": WORKDAY, "6": [], "7": []},
    "holidays": [],
}
#: Hedefin bu oranindan az sure kaldiysa "riskte".
AT_RISK_RATIO = 0.25
_MAX_DAYS = 800   # takvim taramasinin guvenlik siniri


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _minutes(hhmm: str) -> int:
    hh, mm = str(hhmm).split(":", 1)
    return max(0, min(24 * 60, int(hh) * 60 + int(mm)))


class SlaConfigError(ValueError):
    pass


# =============================================================================
# Mesai takvimi
# =============================================================================

class Calendar:
    """Haftalik mesai pencereleri + tatiller; `None` = 7/24."""

    def __init__(self, config: Optional[dict]):
        self.always_on = not config
        self.tz = timezone.utc
        self.windows: Dict[int, List[Tuple[int, int]]] = {}
        self.holidays = set()
        if self.always_on:
            return
        try:
            self.tz = ZoneInfo(config.get("timezone") or "UTC")
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise SlaConfigError(f"Unknown timezone: {config.get('timezone')}") from exc
        for key, spans in (config.get("days") or {}).items():
            day = int(key)
            if not 1 <= day <= 7:
                raise SlaConfigError("Weekday must be 1 (Monday) .. 7 (Sunday).")
            parsed = []
            for span in spans or []:
                start, end = _minutes(span[0]), _minutes(span[1])
                if end <= start:
                    raise SlaConfigError("Each working window must end after it starts.")
                parsed.append((start, end))
            self.windows[day] = sorted(parsed)
        for raw in config.get("holidays") or []:
            self.holidays.add(date.fromisoformat(str(raw)))
        # Hic calisma penceresi yoksa takvim anlamsizdir → 7/24 (sonsuz
        # dongu yerine acik bir davranis).
        if not any(self.windows.values()):
            self.always_on = True

    def _day_windows(self, day: date) -> List[Tuple[datetime, datetime]]:
        if day in self.holidays:
            return []
        out = []
        for start, end in self.windows.get(day.isoweekday(), []):
            base = datetime.combine(day, time(0), tzinfo=self.tz)
            out.append((
                (base + timedelta(minutes=start)).astimezone(timezone.utc),
                (base + timedelta(minutes=end)).astimezone(timezone.utc),
            ))
        return out

    def add_seconds(self, start: datetime, seconds: float) -> datetime:
        start = _aware(start)
        if self.always_on or seconds <= 0:
            return start + timedelta(seconds=max(0, seconds))
        remaining = float(seconds)
        day = start.astimezone(self.tz).date()
        for _ in range(_MAX_DAYS):
            for ws, we in self._day_windows(day):
                if we <= start:
                    continue
                begin = max(ws, start)
                available = (we - begin).total_seconds()
                if remaining <= available:
                    return begin + timedelta(seconds=remaining)
                remaining -= available
            day += timedelta(days=1)
        return start + timedelta(seconds=seconds)  # pragma: no cover — guvenlik

    def seconds_between(self, a: datetime, b: datetime) -> float:
        a, b = _aware(a), _aware(b)
        if b <= a:
            return 0.0
        if self.always_on:
            return (b - a).total_seconds()
        total = 0.0
        day = a.astimezone(self.tz).date()
        last = b.astimezone(self.tz).date()
        while day <= last:
            for ws, we in self._day_windows(day):
                lo, hi = max(ws, a), min(we, b)
                if hi > lo:
                    total += (hi - lo).total_seconds()
            day += timedelta(days=1)
        return total


# =============================================================================
# Politika
# =============================================================================

def validate_targets(targets: dict) -> Dict[str, Dict[str, int]]:
    out = {}
    for priority in PRIORITIES:
        row = (targets or {}).get(priority) or {}
        fr, res = row.get("first_response"), row.get("resolution")
        clean = {}
        for key, value in (("first_response", fr), ("resolution", res)):
            if value in (None, ""):
                continue
            value = int(value)
            if value < 1 or value > 60 * 24 * 365:
                raise SlaConfigError(f"{priority}.{key} must be between 1 minute and a year.")
            clean[key] = value
        if clean:
            out[priority] = clean
    return out


def get_policy(db: Session) -> Optional[TicketSlaPolicy]:
    return db.query(TicketSlaPolicy).first()


def _active(db: Session) -> Optional[TicketSlaPolicy]:
    policy = get_policy(db)
    return policy if policy is not None and policy.is_active else None


def _calendar_for(policy: Optional[TicketSlaPolicy]) -> Calendar:
    try:
        return Calendar(policy.calendar_json if policy else None)
    except SlaConfigError:
        # Kaydedilmis takvim bozulduysa SLA 7/24 hesaplanir (yazarken
        # dogrulandigi icin beklenmez); talep akisi ASLA kirilmaz.
        return Calendar(None)


def _targets(policy: TicketSlaPolicy, priority: str) -> Tuple[Optional[int], Optional[int]]:
    row = (policy.targets_json or {}).get(priority) or {}
    return row.get("first_response"), row.get("resolution")


def _clock(db: Session, ticket) -> Optional[TicketSlaClock]:
    return (
        db.query(TicketSlaClock)
        .filter(TicketSlaClock.ticket_id == ticket.id)
        .first()
    )


# =============================================================================
# Saat kurallari (ticket_service kancalari)
# =============================================================================

def start(db: Session, ticket, *, at: Optional[datetime] = None) -> Optional[TicketSlaClock]:
    policy = _active(db)
    if policy is None:
        return None
    fr_min, res_min = _targets(policy, ticket.priority)
    if fr_min is None and res_min is None:
        return None
    cal = _calendar_for(policy)
    opened = _aware(ticket.created_at) or _aware(at) or _now()
    clock = TicketSlaClock(
        ticket_id=ticket.id,
        first_response_target_min=fr_min,
        resolution_target_min=res_min,
        first_response_due_at=cal.add_seconds(opened, fr_min * 60) if fr_min else None,
        resolution_due_at=cal.add_seconds(opened, res_min * 60) if res_min else None,
    )
    db.add(clock)
    db.flush()
    return clock


def on_first_response(db: Session, ticket, *, at: Optional[datetime] = None) -> None:
    clock = _clock(db, ticket)
    if clock is not None and clock.first_response_at is None:
        clock.first_response_at = at or _now()


def on_status(db: Session, ticket, *, from_status: str, to_status: str,
              at: Optional[datetime] = None) -> None:
    clock = _clock(db, ticket)
    if clock is None:
        return
    at = at or _now()
    cal = _calendar_for(_active(db) or get_policy(db))
    if to_status == "waiting_customer":
        if clock.paused_at is None and clock.resolution_at is None and clock.resolution_due_at:
            # Yukari yuvarla: duraklama hedefi ASLA kisaltmamali.
            clock.remaining_seconds = math.ceil(cal.seconds_between(at, clock.resolution_due_at))
            clock.paused_at = at
        return
    if to_status in ("resolved", "closed", "cancelled"):
        if clock.resolution_at is None:
            clock.resolution_at = at
        clock.paused_at = None
        clock.remaining_seconds = None
        return
    if to_status == "reopened":
        clock.resolution_at = None
        clock.paused_at = None
        clock.remaining_seconds = None
        if clock.resolution_target_min:
            clock.resolution_due_at = cal.add_seconds(at, clock.resolution_target_min * 60)
        return
    # Diger tum gecisler (bekleme → isleme vb.): duraklama bitti.
    if clock.paused_at is not None:
        clock.resolution_due_at = cal.add_seconds(at, max(0, clock.remaining_seconds or 0))
        clock.paused_at = None
        clock.remaining_seconds = None


def on_priority(db: Session, ticket) -> None:
    clock = _clock(db, ticket)
    policy = _active(db)
    if clock is None or policy is None:
        return
    fr_min, res_min = _targets(policy, ticket.priority)
    cal = _calendar_for(policy)
    opened = _aware(ticket.created_at) or _now()
    if clock.first_response_at is None and fr_min:
        clock.first_response_target_min = fr_min
        clock.first_response_due_at = cal.add_seconds(opened, fr_min * 60)
    if clock.resolution_at is None and res_min and clock.paused_at is None:
        clock.resolution_target_min = res_min
        clock.resolution_due_at = cal.add_seconds(opened, res_min * 60)


# =============================================================================
# Okuma: ekran durumu
# =============================================================================

def _leg(due, met, target_min, now, paused=None) -> Optional[dict]:
    due, met = _aware(due), _aware(met)
    if due is None:
        return None
    if met is not None:
        status = "met" if met <= due else "breached"
    elif paused is not None:
        status = "paused"
    elif now > due:
        status = "breached"
    elif target_min and (due - now).total_seconds() < target_min * 60 * AT_RISK_RATIO:
        status = "at_risk"
    else:
        status = "ok"
    return {"due_at": due, "met_at": met, "target_minutes": target_min, "status": status}


def clock_state(clock: Optional[TicketSlaClock], *, now: Optional[datetime] = None) -> Optional[dict]:
    if clock is None:
        return None
    now = now or _now()
    first = _leg(clock.first_response_due_at, clock.first_response_at,
                 clock.first_response_target_min, now)
    resolution = _leg(clock.resolution_due_at, clock.resolution_at,
                      clock.resolution_target_min, now, paused=clock.paused_at)
    legs = [leg for leg in (first, resolution) if leg]
    worst = "ok"
    for candidate in ("breached", "at_risk", "paused", "ok", "met"):
        if any(leg["status"] == candidate for leg in legs):
            worst = candidate
            break
    return {"first_response": first, "resolution": resolution, "status": worst}


def clocks_for(db: Session, ticket_ids) -> Dict:
    ids = list(ticket_ids)
    if not ids:
        return {}
    rows = db.query(TicketSlaClock).filter(TicketSlaClock.ticket_id.in_(ids)).all()
    return {row.ticket_id: row for row in rows}
