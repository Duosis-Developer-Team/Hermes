# =============================================================================
# HERMES core — Talep helpdesk katmani (Dalga B) is mantigi
# =============================================================================
# Etiket, hazir yanit (makro), kayitli gorunum, takipci, okundu bilgisi,
# uygulama ici bildirim, talep eden gecmisi ve toplu islem.
#
# SINIRLAR:
#   - Hepsi SAGLAYICI oturumunda calisir (RLS) — cagiran zaten hub kapsamini
#     dogrulamistir; burada ek olarak her talep kapsam predicate'inden gecer.
#   - Donmus sozlesme: `ticket_events` olay turu EKLENMEZ, outbox'a yeni
#     alan GITMEZ. Durum/oncelik/ekip degisiklikleri MEVCUT servis
#     fonksiyonlariyla yapilir (kendi olaylarini zaten yazarlar).
#   - Bildirim yalniz SAGLAYICI kullanicilarina (zil); talep edenin "yeni
#     guncelleme" isareti okundu bilgisinden turetilir (tenant'lar arasi
#     yazma yok).
# =============================================================================

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.ticket_helpdesk import (
    TicketMacro,
    TicketNotification,
    TicketRead,
    TicketTag,
    TicketTagLink,
    TicketView,
    TicketWatcher,
)
from ..models.ticketing import Ticket
from ..models.user_group import UserGroupMember
from ..ticket_contract import OPEN_STATUSES, PRIORITIES
from . import ticket_service, ticket_visibility as visibility
from .ticket_service import TicketValidationError

TAG_COLORS = ("blue", "green", "orange", "red", "purple", "cyan", "gold", "gray")
VIEW_FILTER_KEYS = ("queue", "status", "priority", "category", "group", "tag", "sort", "application", "q")
MAX_BULK = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# =============================================================================
# Etiketler
# =============================================================================

def list_tags(db: Session, *, include_inactive: bool = False) -> List[TicketTag]:
    query = db.query(TicketTag)
    if not include_inactive:
        query = query.filter(TicketTag.is_active.is_(True))
    return query.order_by(TicketTag.name).all()


def save_tag(db: Session, *, name: str, color: str = "blue",
             tag: Optional[TicketTag] = None, is_active: Optional[bool] = None) -> TicketTag:
    clean = " ".join((name or "").split())[:40]
    if not clean:
        raise TicketValidationError("Tag name is required.", code="validation_error")
    if color not in TAG_COLORS:
        raise TicketValidationError("Unknown tag color.", code="validation_error")
    clash = (
        db.query(TicketTag)
        .filter(func.lower(TicketTag.name) == clean.lower())
        .first()
    )
    if clash is not None and (tag is None or clash.id != tag.id):
        raise TicketValidationError("A tag with this name already exists.", code="validation_error")
    if tag is None:
        tag = TicketTag(name=clean, color=color, is_active=True)
        db.add(tag)
    else:
        tag.name, tag.color = clean, color
        if is_active is not None:
            tag.is_active = bool(is_active)
    db.flush()
    return tag


def tags_for(db: Session, ticket_ids: Iterable) -> Dict:
    ids = list(ticket_ids)
    if not ids:
        return {}
    rows = (
        db.query(TicketTagLink.ticket_id, TicketTag)
        .join(TicketTag, TicketTag.id == TicketTagLink.tag_id)
        .filter(TicketTagLink.ticket_id.in_(ids))
        .order_by(TicketTag.name)
        .all()
    )
    out: Dict = {}
    for ticket_id, tag in rows:
        out.setdefault(ticket_id, []).append(tag)
    return out


def set_ticket_tags(db: Session, ticket: Ticket, tag_ids: Sequence[UUID], *, actor_user_id) -> List[TicketTag]:
    wanted = {UUID(str(t)) for t in tag_ids}
    if wanted:
        found = {
            t.id for t in db.query(TicketTag)
            .filter(TicketTag.id.in_(wanted), TicketTag.is_active.is_(True)).all()
        }
        if found != wanted:
            raise TicketValidationError("Unknown or inactive tag.", code="validation_error")
    current = {
        link.tag_id: link for link in
        db.query(TicketTagLink).filter(TicketTagLink.ticket_id == ticket.id).all()
    }
    for tag_id, link in current.items():
        if tag_id not in wanted:
            db.delete(link)
    for tag_id in wanted - set(current):
        db.add(TicketTagLink(ticket_id=ticket.id, tag_id=tag_id,
                             created_by_user_id=actor_user_id))
    db.flush()
    return tags_for(db, [ticket.id]).get(ticket.id, [])


def add_tags(db: Session, ticket: Ticket, tag_ids: Sequence[UUID], *, actor_user_id) -> None:
    existing = {t.id for t in tags_for(db, [ticket.id]).get(ticket.id, [])}
    set_ticket_tags(db, ticket, list(existing | {UUID(str(t)) for t in tag_ids}),
                    actor_user_id=actor_user_id)


# =============================================================================
# Kayitli gorunumler
# =============================================================================

def clean_view_filters(raw: dict) -> dict:
    out = {}
    for key in VIEW_FILTER_KEYS:
        value = (raw or {}).get(key)
        if value in (None, "", []):
            continue
        out[key] = [str(v)[:64] for v in value][:20] if isinstance(value, list) else str(value)[:120]
    return out


def list_views(db: Session, user_id) -> List[TicketView]:
    return (
        db.query(TicketView)
        .filter((TicketView.owner_user_id == user_id) | TicketView.is_shared.is_(True))
        .order_by(TicketView.position, TicketView.name)
        .all()
    )


# =============================================================================
# Takipciler
# =============================================================================

def watchers_of(db: Session, ticket_id) -> List[UUID]:
    return [r[0] for r in db.query(TicketWatcher.user_id).filter(TicketWatcher.ticket_id == ticket_id).all()]


def set_watching(db: Session, ticket: Ticket, user_id, watching: bool) -> bool:
    row = (
        db.query(TicketWatcher)
        .filter(TicketWatcher.ticket_id == ticket.id, TicketWatcher.user_id == user_id)
        .first()
    )
    if watching and row is None:
        db.add(TicketWatcher(ticket_id=ticket.id, user_id=user_id))
    elif not watching and row is not None:
        db.delete(row)
    db.flush()
    return watching


# =============================================================================
# Okundu bilgisi
# =============================================================================

def mark_read(db: Session, ticket_id, reader: str) -> None:
    row = (
        db.query(TicketRead)
        .filter(TicketRead.ticket_id == ticket_id, TicketRead.reader == str(reader))
        .first()
    )
    if row is None:
        db.add(TicketRead(ticket_id=ticket_id, reader=str(reader), last_read_at=_now()))
    else:
        row.last_read_at = _now()
    db.flush()


def read_map(db: Session, ticket_ids: Iterable, reader: str) -> Dict:
    ids = list(ticket_ids)
    if not ids:
        return {}
    rows = (
        db.query(TicketRead.ticket_id, TicketRead.last_read_at)
        .filter(TicketRead.ticket_id.in_(ids), TicketRead.reader == str(reader))
        .all()
    )
    return {tid: _aware(at) for tid, at in rows}


def agent_unread(ticket: Ticket, last_read) -> bool:
    """Ajan icin: hic acmadigi ACIK talep veya son bakisindan sonra degisen."""
    if last_read is None:
        return ticket.status in OPEN_STATUSES
    updated = _aware(ticket.updated_at)
    return bool(updated and updated > last_read)


def customer_has_update(ticket: Ticket, last_read) -> bool:
    """Talep eden icin: son bakisindan sonra PUBLIC bir hareket var mi?"""
    if last_read is None:
        return False
    activity = _aware(ticket.last_public_activity_at)
    return bool(activity and activity > last_read)


# =============================================================================
# Bildirimler (saglayici kullanicilari)
# =============================================================================

def _group_members(db: Session, group_id) -> List[UUID]:
    return [
        r[0] for r in db.query(UserGroupMember.user_id)
        .filter(UserGroupMember.group_id == group_id, UserGroupMember.is_active.is_(True))
        .all()
    ]


def notify(db: Session, ticket: Ticket, kind: str, *, recipients: Iterable,
           actor_user_id=None, actor_display_name: Optional[str] = None) -> int:
    """Alicilara (eylemi yapan HARIC, tekil) bildirim yazar — ayni
    transaction. (Is kalemi bildirim ayarlari tur-bazlidir; talep
    bildirimleri v1'de her zaman acik.)"""
    sent, seen = 0, set()
    for user_id in recipients:
        if not user_id or user_id in seen or (actor_user_id and str(user_id) == str(actor_user_id)):
            continue
        seen.add(user_id)
        db.add(TicketNotification(
            user_id=user_id, ticket_id=ticket.id, kind=kind,
            actor_display_name=(actor_display_name or None),
        ))
        sent += 1
    db.flush()
    return sent


def followers(db: Session, ticket: Ticket) -> List[UUID]:
    """Atanan kisi + takipciler."""
    people = list(watchers_of(db, ticket.id))
    if ticket.assigned_user_id:
        people.append(ticket.assigned_user_id)
    return people


def on_created(db: Session, ticket: Ticket) -> None:
    notify(db, ticket, "new_ticket", recipients=_group_members(db, ticket.assigned_group_id))


def on_customer_reply(db: Session, ticket: Ticket, *, actor_display_name=None) -> None:
    recipients = followers(db, ticket) or _group_members(db, ticket.assigned_group_id)
    notify(db, ticket, "customer_replied", recipients=recipients,
           actor_display_name=actor_display_name)


def on_reopened(db: Session, ticket: Ticket, *, actor_user_id=None, actor_display_name=None) -> None:
    recipients = followers(db, ticket) or _group_members(db, ticket.assigned_group_id)
    notify(db, ticket, "reopened", recipients=recipients,
           actor_user_id=actor_user_id, actor_display_name=actor_display_name)


def on_assigned(db: Session, ticket: Ticket, *, actor_user_id=None, actor_display_name=None) -> None:
    if ticket.assigned_user_id:
        notify(db, ticket, "assigned", recipients=[ticket.assigned_user_id],
               actor_user_id=actor_user_id, actor_display_name=actor_display_name)


def list_notifications(db: Session, user_id, *, limit: int = 30) -> List[TicketNotification]:
    return (
        db.query(TicketNotification)
        .filter(TicketNotification.user_id == user_id)
        .order_by(TicketNotification.created_at.desc())
        .limit(limit).all()
    )


def unread_count(db: Session, user_id) -> int:
    return int(
        db.query(func.count(TicketNotification.id))
        .filter(TicketNotification.user_id == user_id, TicketNotification.read_at.is_(None))
        .scalar() or 0
    )


# =============================================================================
# Talep eden gecmisi
# =============================================================================

def requester_history(db: Session, ticket: Ticket, scope: visibility.HubScope,
                      *, limit: int = 8) -> List[Ticket]:
    query = (
        db.query(Ticket)
        .filter(
            Ticket.id != ticket.id,
            Ticket.application_id == ticket.application_id,
            Ticket.source_tenant_row_id == ticket.source_tenant_row_id,
            Ticket.requester_source_user_id == ticket.requester_source_user_id,
        )
    )
    query = visibility.apply_hub_filter(query, scope)
    return query.order_by(Ticket.created_at.desc()).limit(limit).all()


# =============================================================================
# Makro uygulama
# =============================================================================

def visible_macros(db: Session, user_id) -> List[TicketMacro]:
    return (
        db.query(TicketMacro)
        .filter(
            TicketMacro.is_active.is_(True),
            (TicketMacro.is_shared.is_(True)) | (TicketMacro.owner_user_id == user_id),
        )
        .order_by(TicketMacro.name)
        .all()
    )


def validate_macro(*, name, body, visibility, set_status, set_priority) -> None:
    if not " ".join((name or "").split()):
        raise TicketValidationError("Macro name is required.", code="validation_error")
    if visibility not in ("public", "internal"):
        raise TicketValidationError("Unknown visibility.", code="validation_error")
    if set_priority and set_priority not in PRIORITIES:
        raise TicketValidationError("Unknown priority.", code="validation_error")
    if set_status and set_status not in ("in_progress", "waiting_customer"):
        # Cozum/kapatma/yeniden acma makroyla YAPILMAZ: ozet, gerekce ve
        # dogrulama penceresi isteyen ayri akislardir.
        raise TicketValidationError("Macros may only move a ticket to in progress or waiting on customer.",
                                    code="validation_error")
    if set_status == "waiting_customer" and (visibility != "public" or not (body or "").strip()):
        raise TicketValidationError("'Waiting on customer' needs a public message in the macro.",
                                    code="validation_error")


def apply_macro(db: Session, ticket: Ticket, macro: TicketMacro, *, actor, actor_user_id,
                body_override: Optional[str] = None, expected_version: Optional[int] = None,
                application=None, source_tenant=None) -> Ticket:
    """Makroyu TEK transaction'da uygular: mesaj → oncelik → etiket → durum.
    Her adim mevcut servis fonksiyonuyla (kendi kurali + olayi) yapilir."""
    ticket_service.check_version(ticket, expected_version)
    body = (body_override if body_override is not None else macro.body or "").strip()
    public_message = None
    if body and not (macro.set_status == "waiting_customer"):
        ticket_service.add_message(
            db, ticket, body=body, visibility=macro.visibility, actor=actor,
            author_type="agent", application=application, source_tenant=source_tenant,
        )
    elif body:
        public_message = body
    if macro.set_priority and macro.set_priority != ticket.priority:
        ticket_service.set_priority(db, ticket, priority=macro.set_priority, actor=actor,
                                    expected_version=None)
    if macro.add_tag_ids:
        add_tags(db, ticket, macro.add_tag_ids, actor_user_id=actor_user_id)
    if macro.set_status and macro.set_status != ticket.status:
        ticket_service.transition(
            db, ticket, to_status=macro.set_status, actor=actor, expected_version=None,
            public_message=public_message, application=application, source_tenant=source_tenant,
        )
    return ticket


# =============================================================================
# Toplu islem
# =============================================================================

BULK_ACTIONS = ("assign_group", "assign_user", "priority", "status", "add_tag", "remove_tag", "watch")


def bulk_apply(db: Session, scope: visibility.HubScope, ticket_ids: Sequence[UUID], *,
               action: str, value, actor, actor_user_id) -> List[dict]:
    """Her talep AYRI degerlendirilir (kapsam + kural); biri basarisiz olsa
    digerleri uygulanir. Sonuc talep basina {id, ok, error} doner. Toplu
    islemde surum kilidi uygulanmaz (son hal uzerine)."""
    if action not in BULK_ACTIONS:
        raise TicketValidationError("Unknown bulk action.", code="validation_error")
    if not ticket_ids or len(ticket_ids) > MAX_BULK:
        raise TicketValidationError(f"Select between 1 and {MAX_BULK} tickets.", code="validation_error")
    results = []
    for ticket_id in ticket_ids:
        ticket = db.query(Ticket).filter(Ticket.id == ticket_id).with_for_update().first()
        if ticket is None:
            results.append({"id": str(ticket_id), "ok": False, "error": "not_found"})
            continue
        try:
            visibility.assert_hub_can_view(ticket, scope)
            nested = db.begin_nested()
            try:
                _bulk_one(db, ticket, action, value, actor=actor, actor_user_id=actor_user_id)
                nested.commit()
            except Exception:
                nested.rollback()
                raise
            results.append({"id": str(ticket_id), "ok": True, "error": None})
        except visibility.TicketAccessDenied:
            results.append({"id": str(ticket_id), "ok": False, "error": "not_found"})
        except Exception as exc:  # noqa: BLE001 — talep basina rapor
            results.append({"id": str(ticket_id), "ok": False,
                            "error": getattr(exc, "code", None) or "invalid"})
    return results


def _bulk_one(db, ticket, action, value, *, actor, actor_user_id):
    if action == "assign_group":
        ticket_service.assign_group(db, ticket, group_id=value, actor=actor, expected_version=None)
    elif action == "assign_user":
        ticket_service.assign_user(db, ticket, user_id=value, actor=actor, expected_version=None)
    elif action == "priority":
        ticket_service.set_priority(db, ticket, priority=value, actor=actor, expected_version=None)
    elif action == "status":
        if value not in ("in_progress",):
            # Toplu durum yalniz "isleme al": diger hedefler mesaj/ozet/
            # gerekce ister ve talep basina dusunulmelidir.
            raise TicketValidationError("Bulk status supports 'in progress' only.", code="validation_error")
        ticket_service.transition(db, ticket, to_status=value, actor=actor, expected_version=None)
    elif action == "add_tag":
        add_tags(db, ticket, [value], actor_user_id=actor_user_id)
    elif action == "remove_tag":
        current = [t.id for t in tags_for(db, [ticket.id]).get(ticket.id, []) if str(t.id) != str(value)]
        set_ticket_tags(db, ticket, current, actor_user_id=actor_user_id)
    elif action == "watch":
        set_watching(db, ticket, actor_user_id, bool(value))
