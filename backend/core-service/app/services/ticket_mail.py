# =============================================================================
# HERMES core — Talep e-posta bildirimleri (Dalga D4)
# =============================================================================
# Kuyruk (outbox) + gonderici. Kurallar:
#   - Satir kanonik mutasyonla AYNI transaction'da yazilir: talep geri
#     alinirsa e-posta da yoktur; e-posta hatasi talebi ASLA bozmaz.
#   - Talep edene yalniz Hermes uygulamasinin talepleri (portal + e-postayla
#     acilanlar) icin gider. LogiSlot gibi kaynak uygulamalarin kendi
#     webhook'u var; onlarin musterisine Hermes e-posta ATMAZ.
#   - Ekibe: atama, musteri yaniti, yeniden acilis (uygulama ici zil ile
#     ayni alicilar; eylemi yapan haric).
#   - Adres ayrilmis/deneme alan adindaysa (example.com, .test, ...)
#     satir yazilmaz — dev tohum verisi gercek posta kutusuna gitmesin.
#   - Kuyruk her surecte yazilir (API, bakim isi); NOTIFICATIONS_ENABLED +
#     Graph yalnizca GONDEREN surecte aranir.
#   - Gonderim dakikalik `ticket_dispatcher` isinde, saglayici basina;
#     gecici hata = artan beklemeyle yeniden dene, kalici hata = failed,
#     24 saatte gidemeyen = skipped (bayat bildirim gonderilmez).
#   - Loglarda alici adresi maskelenir; govde/icerik loglanmaz.
# =============================================================================

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticket_mail import MAIL_LANGUAGES, TicketMailOutbox, TicketMailSettings
from ..models.ticketing import SupportApplication, Ticket, TicketMessage, TicketResolution
from . import ticket_mail_templates as templates

logger = logging.getLogger("hermes.ticket.mail")

# helpdesk bildirim turu → ekip e-postasi turu
AGENT_KINDS = {
    "assigned": "agent_assigned",
    "customer_replied": "agent_customer_replied",
    "reopened": "agent_reopened",
}
REQUESTER_KINDS = ("reply", "waiting", "resolved", "received", "inbound_rejected")
RETRY_MINUTES = (1, 5, 15, 60)
MAX_ATTEMPTS = len(RETRY_MINUTES) + 1
STALE_AFTER = timedelta(hours=24)
FINISHED_RETENTION_DAYS = 30
# Kalici Graph hatalari: yeniden denemek sonucu degistirmez.
PERMANENT_STATUSES = (400, 403, 404)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# RFC 2606/6761 ayrilmis adlar (dev tohumu: hermes-demo.example.com).
_RESERVED_DOMAINS = ("example.com", "example.org", "example.net")
_RESERVED_TLDS = ("example", "test", "invalid", "localhost", "local")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def deliverable(address: Optional[str]) -> bool:
    """Gercek bir posta kutusuna benzeyen ve ayrilmis alan adinda OLMAYAN
    adres mi?"""
    if not address or not _EMAIL_RE.match(address.strip()):
        return False
    domain = address.strip().rsplit("@", 1)[1].lower()
    if domain.rsplit(".", 1)[-1] in _RESERVED_TLDS:
        return False
    return not any(domain == d or domain.endswith("." + d) for d in _RESERVED_DOMAINS)


def mask(address: Optional[str]) -> str:
    if not address or "@" not in address:
        return "***"
    local, domain = address.split("@", 1)
    return (local[:1] + "***" + (local[-1:] if len(local) > 2 else "")) + "@" + domain


# =============================================================================
# Ayarlar
# =============================================================================

@dataclass(frozen=True)
class MailConfig:
    requester_enabled: bool = True
    agent_enabled: bool = True
    language: str = "tr"
    inbound_enabled: bool = False


def config(db: Session) -> MailConfig:
    """Saglayicinin ayari; satir yoksa varsayilanlar (talep edene ve ekibe
    acik, Turkce, gelen e-posta kapali)."""
    row = db.query(TicketMailSettings).first()
    if row is None:
        return MailConfig()
    return MailConfig(
        requester_enabled=bool(row.requester_enabled), agent_enabled=bool(row.agent_enabled),
        language=row.language if row.language in MAIL_LANGUAGES else "tr",
        inbound_enabled=bool(row.inbound_enabled),
    )


def save_config(db: Session, *, requester_enabled: bool, agent_enabled: bool, language: str,
                inbound_enabled: bool, actor_user_id) -> TicketMailSettings:
    if language not in MAIL_LANGUAGES:
        raise ValueError("Unsupported language.")
    row = db.query(TicketMailSettings).first()
    if row is None:
        row = TicketMailSettings()
        db.add(row)
    row.requester_enabled = bool(requester_enabled)
    row.agent_enabled = bool(agent_enabled)
    row.language = language
    row.inbound_enabled = bool(inbound_enabled)
    row.updated_by_user_id = actor_user_id
    db.flush()
    return row


def inbound_mailbox() -> str:
    return (get_settings().TICKET_MAIL_INBOUND_MAILBOX or "").strip().lower()


def inbound_address(tenant_slug: Optional[str], *, is_support_tenant: bool) -> Optional[str]:
    """Saglayicinin gelen e-posta adresi (arti-adres). Destek tenant'i
    duz adresi de kullanabilir; yine de acik adres arti-adrestir."""
    box = inbound_mailbox()
    if not box or "@" not in box:
        return None
    if is_support_tenant or not tenant_slug:
        return box
    local, domain = box.split("@", 1)
    return f"{local}+{tenant_slug}@{domain}"


# =============================================================================
# Kuyruga yazma (kanonik transaction icinde)
# =============================================================================

def _is_hermes_ticket(db: Session, ticket: Ticket) -> bool:
    app = db.get(SupportApplication, ticket.application_id)
    return bool(app and app.code == get_settings().SUPPORT_HERMES_APPLICATION_CODE)


def enqueue_requester(db: Session, ticket: Ticket, kind: str, *, message_id=None,
                      resolution_id=None) -> Optional[TicketMailOutbox]:
    if kind not in REQUESTER_KINDS:
        return None
    if not config(db).requester_enabled or not _is_hermes_ticket(db, ticket):
        return None
    address = (ticket.requester_email or "").strip().lower()
    if not deliverable(address):
        return None
    row = TicketMailOutbox(
        ticket_id=ticket.id, kind=kind, audience="requester", recipient_email=address,
        message_id=message_id, resolution_id=resolution_id,
    )
    db.add(row)
    db.flush()
    return row


def on_public_reply(db: Session, ticket: Ticket, message: TicketMessage) -> None:
    """Ajan ya da otomasyon musteriye yazdi."""
    if message.visibility == "public" and message.author_type in ("agent", "system"):
        enqueue_requester(db, ticket, "reply", message_id=message.id)


def mark_waiting(db: Session, message_id) -> None:
    """Ayni komutta "musteride bekliyor"a gecildi: yanit e-postasi bilgi
    istegi olarak gider (tek e-posta, iki degil)."""
    if message_id is None:
        return
    (db.query(TicketMailOutbox)
     .filter(TicketMailOutbox.message_id == message_id, TicketMailOutbox.kind == "reply",
             TicketMailOutbox.status == "pending")
     .update({TicketMailOutbox.kind: "waiting"}, synchronize_session=False))


def on_resolved(db: Session, ticket: Ticket, resolution: TicketResolution) -> None:
    enqueue_requester(db, ticket, "resolved", resolution_id=resolution.id)


def on_received(db: Session, ticket: Ticket) -> None:
    """E-postayla acilan talep: numarasiyla alindi bildirimi (yanitlar bu
    numarayla talebe baglanir)."""
    enqueue_requester(db, ticket, "received")


def enqueue_inbound_rejection(db: Session, *, address: str, reason: str, subject: Optional[str]) -> None:
    if not deliverable(address):
        return
    db.add(TicketMailOutbox(
        ticket_id=None, kind="inbound_rejected", audience="requester",
        recipient_email=address.strip().lower(), reason=reason[:40],
        subject_hint=(subject or "")[:200] or None,
    ))
    db.flush()


def enqueue_agents(db: Session, ticket: Ticket, notification_kind: str, user_ids: Iterable,
                   *, actor_display_name: Optional[str] = None) -> int:
    kind = AGENT_KINDS.get(notification_kind)
    if kind is None or not config(db).agent_enabled:
        return 0
    count = 0
    for user_id in dict.fromkeys(u for u in user_ids if u):
        db.add(TicketMailOutbox(
            ticket_id=ticket.id, kind=kind, audience="agent", recipient_user_id=user_id,
            actor_display_name=(actor_display_name or None),
        ))
        count += 1
    if count:
        db.flush()
    return count


# =============================================================================
# Gonderim (dakikalik is, saglayici oturumunda)
# =============================================================================

class SendError(Exception):
    def __init__(self, status_code: Optional[int], message: str):
        super().__init__(message)
        self.status_code = status_code


def _default_send(**kwargs) -> None:
    from .graph_service import GraphConfigError, GraphRequestError, get_graph_client

    try:
        asyncio.run(get_graph_client().send_mail(**kwargs))
    except GraphRequestError as exc:
        raise SendError(exc.status_code, exc.message[:200]) from None
    except GraphConfigError as exc:
        raise SendError(None, "graph_not_configured") from exc


def _default_resolve(tenant_id: str, user_ids: List[str]) -> Dict[str, dict]:
    from .task_notifications import _resolve_users

    return asyncio.run(_resolve_users("", user_ids, tenant_id=tenant_id))


def graph_ready() -> bool:
    """Gonderim bu SURECTE mumkun mu? (NOTIFICATIONS_ENABLED + Graph.)
    Kuyruga yazma buna BAGLI DEGILDIR: talep API'de, zamanli otomasyon
    bakim isinde, gonderim dispatcher'da kosar; bayrak yalniz gonderen
    surecte aranir. Gonderilemeyen satir 24 saatte bayatlar."""
    from .graph_service import get_graph_client

    return bool(get_settings().NOTIFICATIONS_ENABLED) and get_graph_client().is_configured


def _retry(row: TicketMailOutbox, error: str, *, permanent: bool, now: datetime) -> None:
    row.attempts = int(row.attempts or 0) + 1
    row.last_error = error[:200]
    if permanent or row.attempts >= MAX_ATTEMPTS:
        row.status = "failed"
    else:
        row.next_attempt_at = now + timedelta(minutes=RETRY_MINUTES[row.attempts - 1])


def dispatch_pending(
    db: Session,
    *,
    tenant_id: str,
    send: Optional[Callable[..., None]] = None,
    resolve_users: Optional[Callable[[str, List[str]], Dict[str, dict]]] = None,
    limit: Optional[int] = None,
    now: Optional[datetime] = None,
) -> dict:
    """Vadesi gelmis satirlari gonderir. Graph hazir degilse satirlara
    dokunmaz (24 saat icinde hazir olursa gider, yoksa bayatlar)."""
    now = now or _now()
    settings = get_settings()
    summary = {"sent": 0, "failed": 0, "retried": 0, "skipped": 0}

    stale = (db.query(TicketMailOutbox)
             .filter(TicketMailOutbox.status == "pending",
                     TicketMailOutbox.created_at < now - STALE_AFTER)
             .update({TicketMailOutbox.status: "skipped", TicketMailOutbox.last_error: "expired"},
                     synchronize_session=False))
    summary["skipped"] += int(stale or 0)

    if send is None and not graph_ready():
        summary["status"] = "graph_not_configured"
        return summary
    send = send or _default_send
    resolve_users = resolve_users or _default_resolve

    rows = (db.query(TicketMailOutbox)
            .filter(TicketMailOutbox.status == "pending", TicketMailOutbox.next_attempt_at <= now)
            .order_by(TicketMailOutbox.created_at)
            .limit(int(limit or settings.TICKET_MAIL_DISPATCH_BATCH))
            .with_for_update(skip_locked=True)
            .all())
    if not rows:
        return summary

    agent_ids = sorted({str(r.recipient_user_id) for r in rows if r.recipient_user_id})
    directory = resolve_users(tenant_id, agent_ids) if agent_ids else {}
    cfg = config(db)
    reply_to = _reply_to(db, tenant_id, cfg)

    for row in rows:
        address = row.recipient_email or (directory.get(str(row.recipient_user_id)) or {}).get("email")
        if not deliverable(address):
            row.status, row.last_error = "skipped", "recipient_unresolved"
            summary["skipped"] += 1
            continue
        try:
            mail = _render(db, row, cfg, reply_to=reply_to)
        except _Gone as gone:
            row.status, row.last_error = "skipped", str(gone)
            summary["skipped"] += 1
            continue
        try:
            send(sender=settings.NOTIF_MAIL_SENDER, to_email=address, subject=mail.subject,
                 html_body=mail.html, inline_images=mail.inline_images,
                 reply_to=reply_to if row.audience == "requester" else None,
                 headers=mail.headers)
        except SendError as exc:
            permanent = exc.status_code in PERMANENT_STATUSES
            _retry(row, str(exc) or "send_failed", permanent=permanent, now=now)
            summary["failed" if row.status == "failed" else "retried"] += 1
            logger.warning("ticket mail not sent kind=%s to=%s status=%s", row.kind, mask(address), exc.status_code)
            continue
        except Exception as exc:  # noqa: BLE001 — bir satir digerlerini durdurmaz
            _retry(row, type(exc).__name__, permanent=False, now=now)
            summary["failed" if row.status == "failed" else "retried"] += 1
            continue
        row.status, row.sent_at, row.last_error = "sent", now, None
        row.attempts = int(row.attempts or 0) + 1
        summary["sent"] += 1
    db.flush()
    return summary


def _reply_to(db: Session, tenant_id: str, cfg: MailConfig) -> Optional[str]:
    """Gelen e-posta acik ve sunucuda yapilandirilmissa yanit adresi
    saglayicinin arti-adresidir; degilse Reply-To konmaz."""
    if not cfg.inbound_enabled or not inbound_mailbox():
        return None
    from sqlalchemy import text as sa_text
    from . import support_tenant as support

    slug = db.execute(sa_text("SELECT slug FROM tenant_registry WHERE tenant_id = CAST(:t AS uuid)"),
                      {"t": str(tenant_id)}).scalar()
    return inbound_address(slug, is_support_tenant=support.is_support_tenant(tenant_id))


class _Gone(Exception):
    """Bildirimin konusu artik yok (talep/mesaj bulunamadi)."""


def _render(db: Session, row: TicketMailOutbox, cfg: MailConfig, *, reply_to: Optional[str]):
    ticket = db.get(Ticket, row.ticket_id) if row.ticket_id else None
    if row.ticket_id and ticket is None:
        raise _Gone("ticket_missing")
    message = db.get(TicketMessage, row.message_id) if row.message_id else None
    if row.message_id and message is None:
        raise _Gone("message_missing")
    resolution = db.get(TicketResolution, row.resolution_id) if row.resolution_id else None
    if row.kind == "agent_customer_replied" and ticket is not None:
        message = (db.query(TicketMessage)
                   .filter(TicketMessage.ticket_id == ticket.id, TicketMessage.visibility == "public",
                           TicketMessage.author_type == "requester")
                   .order_by(TicketMessage.sequence.desc()).first())
    settings = get_settings()
    return templates.render(
        row.kind, lang=cfg.language, ticket=ticket, message=message, resolution=resolution,
        actor_display_name=row.actor_display_name, reason=row.reason, subject_hint=row.subject_hint,
        app_base_url=settings.APP_BASE_URL, provider_tenant_id=str(row.tenant_id),
        replies_by_email=bool(reply_to),
    )


def purge_finished(db: Session, *, older_than_days: int = FINISHED_RETENTION_DAYS) -> int:
    """Sonuclanmis (gonderildi/basarisiz/atlandi) satirlari budar —
    operasyonel tablo; talep kaydi degildir."""
    cutoff = _now() - timedelta(days=older_than_days)
    return int(db.query(TicketMailOutbox)
               .filter(TicketMailOutbox.status.in_(("sent", "failed", "skipped")),
                       TicketMailOutbox.created_at < cutoff)
               .delete(synchronize_session=False) or 0)


INBOUND_RETENTION_DAYS = 90


def purge_inbound_log(db: Session, *, older_than_days: int = INBOUND_RETENTION_DAYS) -> int:
    from ..models.ticket_mail import TicketMailInbound

    cutoff = _now() - timedelta(days=older_than_days)
    return int(db.query(TicketMailInbound).filter(TicketMailInbound.created_at < cutoff)
               .delete(synchronize_session=False) or 0)


def delivery_overview(db: Session, *, days: int = 7, limit: int = 20) -> dict:
    since = _now() - timedelta(days=days)
    counts = dict(
        db.query(TicketMailOutbox.status, func.count())
        .filter(TicketMailOutbox.created_at >= since)
        .group_by(TicketMailOutbox.status).all()
    )
    recent = (db.query(TicketMailOutbox)
              .order_by(TicketMailOutbox.created_at.desc()).limit(limit).all())
    return {"counts": {s: int(counts.get(s, 0)) for s in ("pending", "sent", "failed", "skipped")},
            "recent": recent}
