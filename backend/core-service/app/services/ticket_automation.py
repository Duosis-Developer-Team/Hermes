# =============================================================================
# HERMES core — Talep otomasyon kurallari (Dalga D2, 00-plan §4.4)
# =============================================================================
# "Eger <kosullar> ise <eylemler>". Uc tetik:
#   created           talep acildiginda (ayni transaction)
#   customer_replied  musteri public yanit yazdiginda (ayni transaction)
#   schedule          saatlik bakim isi; yas kosulu ZORUNLU; talep basina 1 kez
#
# GUVENLIK / DAYANIKLILIK:
#   - Her kural kendi SAVEPOINT'inde: bir kuralin hatasi talebi acmayi ya da
#     musteri yanitini ASLA bozmaz; hata `ticket_automation_runs`a yazilir.
#   - Eylemler MEVCUT servis fonksiyonlariyla yapilir (durum makinesi, grup
#     uyeligi, oncelik tabani) — otomasyon kural delemez.
#   - Dongu yok: kural eylemleri olay kurallarini yeniden tetiklemez
#     (contextvar); otomasyonun yazdigi mesaj "system" yazarlidir — ilk yanit
#     SLA'sini karsilamaz, musteri yaniti sayilmaz.
#   - Sozlesme degismez: eylemler mevcut olay turlerini uretir; aktor tipi
#     sozlesmedeki `system_job`, gorunen ad "Otomasyon: <kural>".
# =============================================================================

from __future__ import annotations

import contextvars
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from ..models.ticket_helpdesk import TicketAutomation, TicketAutomationRun
from ..models.ticketing import Ticket, TicketMessage
from ..models.user_group import UserGroup
from ..ticket_contract import CATEGORIES, IMPACTS, PRIORITIES, RESOLUTION_CODES, STATUSES
from .ticket_service import TicketValidationError

logger = logging.getLogger("hermes.ticket.automation")

TRIGGERS = ("created", "customer_replied", "schedule")
AGE_BASES = ("created", "updated", "public_activity")
ASSIGNEE_STATES = ("assigned", "unassigned")
ACTION_TYPES = ("set_priority", "assign_group", "assign_user", "add_tags", "internal_note",
                "public_reply", "set_status", "resolve", "notify")
STATUS_ACTIONS = ("in_progress", "waiting_customer")
NOTIFY_TARGETS = ("group", "assignee", "watchers")
MAX_ACTIONS = 10
MAX_TEXT = 5000
SCHEDULE_BATCH = 200

_RUNNING = contextvars.ContextVar("hermes_ticket_automation_running", default=False)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def fold(text: Optional[str]) -> str:
    """TR karakter + buyuk/kucuk harf duyarsiz karsilastirma (istemcideki
    foldSearch ile ayni kural: Ilgaz = ılgaz = ILGAZ)."""
    s = (text or "").replace("İ", "i").replace("I", "ı").lower()
    return s.translate(str.maketrans("ıöüşğç", "iousgc"))


# =============================================================================
# Dogrulama
# =============================================================================

def _ids(values) -> List[str]:
    out = []
    for v in values or []:
        try:
            out.append(str(uuid.UUID(str(v))))
        except (ValueError, TypeError, AttributeError):
            raise TicketValidationError("Invalid identifier in rule.", code="validation_error")
    return out


def _subset(values, allowed, label) -> List[str]:
    vals = [str(v) for v in values or []]
    bad = [v for v in vals if v not in allowed]
    if bad:
        raise TicketValidationError(f"Unknown {label}: {', '.join(bad)}", code="validation_error")
    return vals


def _text(value, label) -> str:
    text = (value or "").strip()
    if not text:
        raise TicketValidationError(f"{label} is required.", code="validation_error")
    if len(text) > MAX_TEXT:
        raise TicketValidationError(f"{label} is too long.", code="validation_error")
    return text


def validate_rule(trigger: str, conditions: dict, actions: list) -> tuple:
    """Kurali normalize eder; gecersizse TicketValidationError (422)."""
    if trigger not in TRIGGERS:
        raise TicketValidationError("Unknown trigger.", code="validation_error")
    c = conditions or {}
    clean = {}
    for key, ids in (("application", c.get("application")), ("customer", c.get("customer")),
                     ("group", c.get("group")), ("tags_any", c.get("tags_any"))):
        if ids:
            clean[key] = _ids(ids)
    for key, allowed in (("category", CATEGORIES), ("impact", IMPACTS),
                         ("priority", PRIORITIES), ("status", STATUSES)):
        if c.get(key):
            clean[key] = _subset(c[key], allowed, key)
    if c.get("assignee"):
        if c["assignee"] not in ASSIGNEE_STATES:
            raise TicketValidationError("Unknown assignee condition.", code="validation_error")
        clean["assignee"] = c["assignee"]
    if c.get("text_any"):
        words = [str(w).strip()[:80] for w in c["text_any"] if str(w).strip()]
        if words:
            clean["text_any"] = words[:20]
    age = c.get("age")
    if trigger == "schedule":
        if not age or age.get("basis") not in AGE_BASES:
            raise TicketValidationError("Scheduled rules need an age condition.", code="validation_error")
        hours = int(age.get("hours") or 0)
        if not 1 <= hours <= 24 * 365:
            raise TicketValidationError("Age must be between 1 hour and a year.", code="validation_error")
        clean["age"] = {"basis": age["basis"], "hours": hours}

    if not actions:
        raise TicketValidationError("Add at least one action.", code="validation_error")
    if len(actions) > MAX_ACTIONS:
        raise TicketValidationError(f"At most {MAX_ACTIONS} actions.", code="validation_error")
    out = []
    for a in actions:
        kind = (a or {}).get("type")
        if kind not in ACTION_TYPES:
            raise TicketValidationError("Unknown action.", code="validation_error")
        if kind == "set_priority":
            out.append({"type": kind, "value": _subset([a.get("value")], PRIORITIES, "priority")[0]})
        elif kind == "assign_group":
            out.append({"type": kind, "group_id": _ids([a.get("group_id")])[0]})
        elif kind == "assign_user":
            out.append({"type": kind, "user_id": _ids([a.get("user_id")])[0]})
        elif kind == "add_tags":
            ids = _ids(a.get("tag_ids"))
            if not ids:
                raise TicketValidationError("Choose at least one tag.", code="validation_error")
            out.append({"type": kind, "tag_ids": ids})
        elif kind in ("internal_note", "public_reply"):
            out.append({"type": kind, "body": _text(a.get("body"), "Message")})
        elif kind == "set_status":
            value = _subset([a.get("value")], STATUS_ACTIONS, "status")[0]
            item = {"type": kind, "value": value}
            if value == "waiting_customer":
                item["body"] = _text(a.get("body"), "Question to the customer")
            out.append(item)
        elif kind == "resolve":
            out.append({"type": kind,
                        "resolution_code": _subset([a.get("resolution_code")], RESOLUTION_CODES,
                                                   "resolution code")[0],
                        "summary": _text(a.get("summary"), "Resolution summary")})
        elif kind == "notify":
            out.append({"type": kind, "target": _subset([a.get("target")], NOTIFY_TARGETS, "target")[0]})
    return clean, out


# =============================================================================
# Eslesme
# =============================================================================

def _description(db: Session, ticket: Ticket) -> str:
    first = (
        db.query(TicketMessage.body)
        .filter(TicketMessage.ticket_id == ticket.id)
        .order_by(TicketMessage.sequence)
        .first()
    )
    return first[0] if first else ""


def matches(db: Session, rule: TicketAutomation, ticket: Ticket) -> bool:
    from . import ticket_helpdesk

    c = rule.conditions_json or {}

    def has(key, value):
        return not c.get(key) or str(value) in c[key]

    if not (has("application", ticket.application_id) and has("customer", ticket.source_tenant_row_id)
            and has("group", ticket.assigned_group_id) and has("category", ticket.category)
            and has("impact", ticket.impact) and has("priority", ticket.priority)
            and has("status", ticket.status)):
        return False
    if c.get("assignee") == "assigned" and not ticket.assigned_user_id:
        return False
    if c.get("assignee") == "unassigned" and ticket.assigned_user_id:
        return False
    if c.get("tags_any"):
        tags = {str(t.id) for t in ticket_helpdesk.tags_for(db, [ticket.id]).get(ticket.id, [])}
        if not tags & set(c["tags_any"]):
            return False
    if c.get("text_any"):
        haystack = fold(f"{ticket.title}\n{_description(db, ticket)}")
        if not any(fold(word) in haystack for word in c["text_any"]):
            return False
    return True


# =============================================================================
# Eylemler
# =============================================================================

def _actor(rule: TicketAutomation):
    from .ticket_service import Actor

    return Actor(type="system_job", role="agent", id=f"automation:{rule.id}",
                 display_name=f"Otomasyon: {rule.name}"[:200])


def _apply(db: Session, rule: TicketAutomation, ticket: Ticket) -> None:
    from . import ticket_helpdesk, ticket_service
    from ..models.ticketing import SupportApplication, SupportSourceTenant

    actor = _actor(rule)
    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    for a in rule.actions_json or []:
        kind = a["type"]
        if kind == "set_priority" and ticket.priority != a["value"]:
            ticket_service.set_priority(db, ticket, priority=a["value"], actor=actor, expected_version=None)
        elif kind == "assign_group" and str(ticket.assigned_group_id) != a["group_id"]:
            group = db.get(UserGroup, uuid.UUID(a["group_id"]))
            if group is None or not group.is_active:
                raise TicketValidationError("Target team is not active.", code="validation_error")
            ticket_service.assign_group(db, ticket, group_id=group.id, actor=actor, expected_version=None,
                                        application=app, source_tenant=src)
        elif kind == "assign_user" and str(ticket.assigned_user_id) != a["user_id"]:
            ticket_service.assign_user(db, ticket, user_id=uuid.UUID(a["user_id"]), actor=actor,
                                       expected_version=None)
        elif kind == "add_tags":
            ticket_helpdesk.add_tags(db, ticket, a["tag_ids"], actor_user_id=None)
        elif kind == "internal_note":
            ticket_service.add_message(db, ticket, body=a["body"], visibility="internal", actor=actor,
                                       author_type="system", application=app, source_tenant=src)
        elif kind == "public_reply":
            ticket_service.add_message(db, ticket, body=a["body"], visibility="public", actor=actor,
                                       author_type="system", application=app, source_tenant=src)
        elif kind == "set_status" and ticket.status != a["value"]:
            ticket_service.transition(db, ticket, to_status=a["value"], actor=actor, expected_version=None,
                                      public_message=a.get("body"), application=app, source_tenant=src)
        elif kind == "resolve" and ticket.status not in ("resolved", "closed", "cancelled"):
            ticket_service.resolve(db, ticket, resolution_code=a["resolution_code"],
                                   public_summary=a["summary"], actor=actor, expected_version=None,
                                   application=app, source_tenant=src)
        elif kind == "notify":
            if a["target"] == "group":
                recipients = ticket_helpdesk._group_members(db, ticket.assigned_group_id)
            elif a["target"] == "assignee":
                recipients = [ticket.assigned_user_id] if ticket.assigned_user_id else []
            else:
                recipients = ticket_helpdesk.watchers_of(db, ticket.id)
            ticket_helpdesk.notify(db, ticket, "automation", recipients=recipients,
                                   actor_display_name=rule.name)


def _run(db: Session, rule: TicketAutomation, ticket: Ticket, run_key: str) -> str:
    """Kurali SAVEPOINT icinde uygular; sonucu kaydeder. Asla firlatmaz."""
    outcome, detail = "applied", None
    token = _RUNNING.set(True)
    nested = db.begin_nested()
    try:
        _apply(db, rule, ticket)
        nested.commit()
    except Exception as exc:  # noqa: BLE001 — kural hatasi talep akisini bozmaz
        nested.rollback()
        db.refresh(ticket)
        outcome, detail = "error", (getattr(exc, "code", None) or type(exc).__name__) + ": " + str(exc)[:400]
        logger.warning("automation failed rule=%s ticket=%s detail=%s", rule.id, ticket.id, detail)
    finally:
        _RUNNING.reset(token)
    db.add(TicketAutomationRun(automation_id=rule.id, ticket_id=ticket.id, run_key=run_key[:80],
                               outcome=outcome, detail=detail))
    db.flush()
    return outcome


def active_rules(db: Session, trigger: str) -> List[TicketAutomation]:
    return (
        db.query(TicketAutomation)
        .filter(TicketAutomation.trigger == trigger, TicketAutomation.is_active.is_(True))
        .order_by(TicketAutomation.position, TicketAutomation.created_at)
        .all()
    )


def run_event(db: Session, ticket: Ticket, trigger: str, *, run_key: str) -> int:
    """Olay kurallarini sirayla uygular (ayni transaction). Eylemlerin
    tetikledigi olaylar yeniden kural calistirmaz."""
    if _RUNNING.get():
        return 0
    applied = 0
    for rule in active_rules(db, trigger):
        if matches(db, rule, ticket):
            applied += _run(db, rule, ticket, run_key) == "applied"
    return applied


_AGE_COLUMN = {
    "created": Ticket.created_at,
    "updated": Ticket.updated_at,
    "public_activity": Ticket.last_public_activity_at,
}


def run_schedules(db: Session, *, now: Optional[datetime] = None) -> dict:
    """Zamanli kurallar: yas kosulunu saglayan, henuz bu kuralin calismadigi
    acik/cozulmus talepler (kapanan/iptal edilen haric)."""
    from sqlalchemy import func, select

    now = now or _now()
    summary = {"rules": 0, "applied": 0, "errors": 0}
    for rule in active_rules(db, "schedule"):
        summary["rules"] += 1
        age = (rule.conditions_json or {}).get("age") or {}
        column = _AGE_COLUMN.get(age.get("basis"))
        if column is None:
            continue
        cutoff = now - timedelta(hours=int(age.get("hours") or 0))
        done = select(TicketAutomationRun.ticket_id).where(
            TicketAutomationRun.automation_id == rule.id, TicketAutomationRun.run_key == "schedule")
        candidates = (
            db.query(Ticket)
            .filter(Ticket.status.notin_(("closed", "cancelled")),
                    func.coalesce(column, Ticket.created_at) <= cutoff,
                    Ticket.id.notin_(done))
            .order_by(Ticket.created_at)
            .limit(SCHEDULE_BATCH)
            .all()
        )
        for ticket in candidates:
            if not matches(db, rule, ticket):
                continue
            result = _run(db, rule, ticket, "schedule")
            summary["applied" if result == "applied" else "errors"] += 1
    return summary


def recent_runs(db: Session, rule_id, *, limit: int = 30) -> List[TicketAutomationRun]:
    return (
        db.query(TicketAutomationRun)
        .filter(TicketAutomationRun.automation_id == rule_id)
        .order_by(TicketAutomationRun.ran_at.desc())
        .limit(limit)
        .all()
    )
