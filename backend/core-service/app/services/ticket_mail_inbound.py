# =============================================================================
# HERMES core — Gelen e-postadan talep (Dalga D4, VARSAYILAN KAPALI)
# =============================================================================
# `TICKET_MAIL_INBOUND_MAILBOX` bos = hic calismaz. Doluysa dakikalik
# dispatcher bu kutuyu Graph ile okur (Mail.ReadWrite) ve her iletiyi:
#
#   1) Yonlendirir: alici `talep+<slug>@...` → o saglayici; arti eki yoksa
#      destek tenant'i. Saglayicida "gelen e-posta" ayari ACIK olmali.
#   2) Eler (sessizce, yanit vermeden): otomatik/toplu iletiler, kendi
#      gonderdigimiz e-postalar, kimligi dogrulanmamis gonderen (DMARC/
#      compauth gecmemis — sahte "From" ile talep acilamaz), gonderen
#      basina saatlik sinir, ayni iletinin ikinci kez islenmesi.
#   3) Konudaki `[TKT-000123]` + gonderen = talep sahibi → talebe musteri
#      yaniti (portaldaki yanitla AYNI kurallar: bekleyen talep isleme
#      doner, cozulmus talep pencere icinde yeniden acilir). Kapali/iptal
#      talebe gelen yanit yeni talep olur.
#   4) Aksi halde yeni talep: gonderen, bu saglayiciya bagli bir talep eden
#      tenant'in AKTIF uyesi olmali ve `tickets.create` iznine sahip
#      olmali (portal ile ayni yetki). Talep o kullanicinin portalinda
#      gorunur. Tanimayan/yetkisiz gonderene kisa bir aciklama gider.
#   5) Ekler mevcut tarama hattindan gecer (karantina → tarama → temiz);
#      ek ozelligi kapaliysa ya da dosya reddedilirse talebe not dusulur.
#
# Islenen ileti kutuda "Hermes - Islendi", elenen "Hermes - Reddedildi"
# klasorune tasinir. Kalici (DB) karar once yazilir, tasima sonra: tasima
# basarisiz olursa ileti bir sonraki turda tekrar gelir ve
# `internet_message_id` kaydiyla yalnizca tasinir.
# =============================================================================

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from shared.permissions import Perm, TICKETS_ADMIN_COVERS

from ..config import get_settings
from ..models.ticket_mail import TicketMailInbound
from ..models.ticketing import Ticket
from ..ticket_contract import TICKET_NUMBER_PREFIX
from . import support_tenant as support
from . import ticket_mail

logger = logging.getLogger("hermes.ticket.mail.inbound")

PROCESSED_FOLDER = "Hermes - Islendi"
REJECTED_FOLDER = "Hermes - Reddedildi"

TOKEN_RE = re.compile(r"\[\s*" + re.escape(TICKET_NUMBER_PREFIX) + r"(\d{1,12})\s*\]", re.I)
_REPLY_PREFIX_RE = re.compile(r"^\s*((re|fw|fwd|aw|wg|ynt|yan[ıi]t|ilt|[ıi]let|sv|vs)\s*(\[\d+\])?\s*:\s*)+", re.I)
_QUOTE_MARKERS = (
    re.compile(r"^-{2,}\s*(original message|orijinal ileti|özgün ileti)\s*-{2,}", re.I),
    re.compile(r"^_{10,}\s*$"),
    re.compile(r"^on .{4,200} wrote:\s*$", re.I),
    re.compile(r"^.{4,200} tarihinde .{1,200} (şunu )?yazdı:\s*$", re.I),
    re.compile(r"^(from|gönderen|kimden)\s*:\s*\S", re.I),
)
_NOREPLY_LOCALS = ("mailer-daemon", "postmaster", "noreply", "no-reply", "donotreply", "do-not-reply")
BODY_MAX = 20000


# =============================================================================
# Saf yardimcilar (testli)
# =============================================================================

def headers_of(message: dict) -> Dict[str, str]:
    """Baslik adi → ILK (en ustteki) deger. Alici sunucu kendi dogrulama
    sonucunu en uste ekler; gonderenin iletiye koydugu sahte bir
    `Authentication-Results` daha asagida kalir ve OKUNMAZ."""
    out: Dict[str, str] = {}
    for h in message.get("internetMessageHeaders") or []:
        name = str(h.get("name") or "").strip().lower()
        if name and name not in out:
            out[name] = str(h.get("value") or "")
    return out


def address_of(field: Optional[dict]) -> str:
    return str(((field or {}).get("emailAddress") or {}).get("address") or "").strip().lower()


def ticket_number_from(subject: Optional[str]) -> Optional[int]:
    match = TOKEN_RE.search(subject or "")
    return int(match.group(1)) if match else None


def clean_subject(subject: Optional[str]) -> str:
    text = TOKEN_RE.sub("", subject or "")
    text = _REPLY_PREFIX_RE.sub("", text)
    text = " ".join(text.split())
    return text[:200]


def route_slug(message: dict, mailbox: str) -> Tuple[bool, Optional[str]]:
    """(kutuya mi geldi, arti eki). Alicilar arasinda `local+slug@domain`
    varsa slug; yalniz duz adres varsa None (destek tenant'i)."""
    if "@" not in mailbox:
        return False, None
    local, domain = mailbox.lower().split("@", 1)
    matched, slug = False, None
    for field in (message.get("toRecipients") or []) + (message.get("ccRecipients") or []):
        addr = address_of(field)
        if "@" not in addr:
            continue
        a_local, a_domain = addr.split("@", 1)
        if a_domain != domain:
            continue
        if a_local == local:
            matched = True
        elif a_local.startswith(local + "+") and len(a_local) > len(local) + 1:
            return True, a_local[len(local) + 1:]
    return matched, slug


def is_automated(headers: Dict[str, str], sender: str, own: Tuple[str, ...]) -> bool:
    """Otomatik yanit, toplu ileti, posta listesi, geri donen ileti ya da
    kendi e-postamiz mi? (Bunlara talep acilmaz, yanit da verilmez.)"""
    if not sender or sender in own:
        return True
    if sender.split("@", 1)[0] in _NOREPLY_LOCALS:
        return True
    auto = headers.get("auto-submitted", "").strip().lower()
    if auto and auto != "no":
        return True
    if headers.get("precedence", "").strip().lower() in ("bulk", "junk", "list", "auto_reply"):
        return True
    return any(name in headers for name in
               ("x-hermes-mail", "x-autoreply", "x-autorespond", "list-id", "list-unsubscribe"))


def sender_authenticated(headers: Dict[str, str], sender: str = "") -> bool:
    """Gonderen alan adi dogrulamasi gecti mi? Exchange Online en ustteki
    `Authentication-Results`'a dmarc/compauth sonucunu yazar; sonuc
    `header.from` tasiyorsa gonderenin alan adiyla AYNI olmali. Ayni
    kurulustan gelen iletiler `AuthAs: Internal` tasir (Exchange bu
    basligi kurulus disindan gelen iletilerden siler)."""
    if headers.get("x-ms-exchange-organization-authas", "").strip().lower() == "internal":
        return True
    results = headers.get("authentication-results", "").lower()
    if not (re.search(r"\bdmarc=pass\b", results) or re.search(r"\bcompauth=pass\b", results)):
        return False
    declared = re.search(r"header\.from=([a-z0-9.-]+)", results)
    domain = sender.rsplit("@", 1)[-1].lower() if "@" in sender else ""
    return declared is None or not domain or declared.group(1) == domain


def clean_body(text: Optional[str]) -> str:
    """Duz metin govde: alinti gecmisi kesilir, bosluklar toparlanir."""
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: List[str] = []
    for line in lines:
        stripped = line.strip()
        if out and any(p.match(stripped) for p in _QUOTE_MARKERS):
            break
        if stripped.startswith(">"):
            continue
        out.append(line.rstrip())
    body = "\n".join(out).strip()
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body[:BODY_MAX]


def source_key(internet_message_id: str) -> str:
    return "email-" + hashlib.sha256(internet_message_id.encode("utf-8")).hexdigest()[:40]


# =============================================================================
# Dis bagimliliklar (testte degistirilir)
# =============================================================================

@dataclass
class Member:
    user_id: str
    tenant_id: str
    display_name: str
    email: str
    link_display_name: Optional[str]


def _directory_find(tenant_id: str, email: str) -> Optional[dict]:
    """S2S dizinde tenant'in AKTIF uyesi arasinda birebir e-posta eslesmesi."""
    from .auth_upstream import auth_service_base_url

    token = get_settings().HERMES_S2S_TOKEN_CURRENT
    if not token:
        return None
    try:
        resp = httpx.get(
            f"{auth_service_base_url()}/internal/directory/users",
            params={"tenant_id": tenant_id, "q": email[:100], "limit": 25},
            headers={"Authorization": f"Bearer {token}"}, timeout=10.0,
        )
    except Exception as exc:  # noqa: BLE001 — bulunamadi say (fail-closed)
        logger.warning("inbound directory lookup error class=%s", type(exc).__name__)
        return None
    if resp.status_code != 200:
        return None
    for user in resp.json().get("users") or []:
        if str(user.get("work_email") or "").strip().lower() == email and user.get("is_active", True):
            return user
    return None


def _can_create(user_id: str, tenant_id: str) -> bool:
    from . import authz_client

    try:
        perms = set(authz_client.effective_permissions(user_id, tenant_id=tenant_id))
    except authz_client.AuthzUnavailable:
        return False
    if Perm.TICKETS_ADMIN in perms:
        perms.update(TICKETS_ADMIN_COVERS)
    return Perm.TICKETS_ACCESS in perms and Perm.TICKETS_CREATE in perms


@dataclass
class Deps:
    find_user: Callable[[str, str], Optional[dict]] = _directory_find
    can_create: Callable[[str, str], bool] = _can_create
    fetch_attachments: Optional[Callable[[str], List[dict]]] = None


def find_member(provider_tenant_id: str, email: str, deps: Deps) -> Optional[Member]:
    """Saglayiciya ACIK baglantisi olan talep eden tenant'lardan birinde
    aktif uye + talep acma izni. Ilk eslesen (baglanti olusturma sirasi)."""
    from . import ticket_network as network

    with support.global_session() as gdb:
        links = gdb.execute(sa_text(
            "SELECT requester_tenant_id, requester_display_name FROM ticket_network_links "
            " WHERE provider_tenant_id = CAST(:p AS uuid) AND is_active "
            " ORDER BY created_at"
        ), {"p": provider_tenant_id}).all()
        candidates = [(str(r[0]), r[1]) for r in links if network.provider_available(gdb, r[0])]
    for tenant_id, link_name in candidates:
        user = deps.find_user(tenant_id, email)
        if not user or not deps.can_create(str(user["id"]), tenant_id):
            continue
        return Member(user_id=str(user["id"]), tenant_id=tenant_id,
                      display_name=str(user.get("display_name") or email), email=email,
                      link_display_name=link_name)
    return None


# =============================================================================
# Isleme
# =============================================================================

@dataclass
class Outcome:
    outcome: str            # created | replied | rejected | ignored | duplicate
    reason: Optional[str] = None
    ticket_id: Optional[str] = None

    @property
    def folder(self) -> str:
        return PROCESSED_FOLDER if self.outcome in ("created", "replied", "duplicate") else REJECTED_FOLDER


def _provider_for(slug: Optional[str]) -> Optional[str]:
    if slug is None:
        return support.support_tenant_id()
    with support.global_session() as gdb:
        row = gdb.execute(sa_text("SELECT tenant_id FROM tenant_registry WHERE slug = :s"),
                          {"s": slug}).first()
    return str(row[0]) if row else None


def process_message(message: dict, *, mailbox: str, deps: Optional[Deps] = None) -> Outcome:
    deps = deps or Deps()
    settings = get_settings()
    headers = headers_of(message)
    sender = address_of(message.get("from")) or address_of(message.get("sender"))
    own = tuple(a for a in (mailbox.lower(), (settings.NOTIF_MAIL_SENDER or "").lower()) if a)
    internet_id = str(message.get("internetMessageId") or message.get("id") or "")[:512]

    if is_automated(headers, sender, own):
        return Outcome("ignored", "automated")
    addressed, slug = route_slug(message, mailbox)
    if not addressed:
        return Outcome("ignored", "not_addressed")
    provider = _provider_for(slug)
    if not provider:
        return Outcome("ignored", "unknown_provider")

    try:
        with support.provider_session(provider) as db:
            return _process_in_provider(db, message, provider=provider, sender=sender, headers=headers,
                                        internet_id=internet_id, deps=deps)
    except support.SupportNotConfigured:
        return Outcome("ignored", "provider_unavailable")


def _record(db: Session, *, internet_id: str, sender: str, outcome: str, reason=None,
            ticket_id=None, message_id=None, received_at=None) -> None:
    db.add(TicketMailInbound(
        internet_message_id=internet_id, sender_email=sender[:255] or None, outcome=outcome,
        reason=reason, ticket_id=ticket_id, message_id=message_id, received_at=received_at,
    ))
    db.flush()


def _received_at(message: dict) -> Optional[datetime]:
    raw = message.get("receivedDateTime")
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")) if raw else None
    except ValueError:
        return None


def _reject(db, *, internet_id, sender, reason, subject, received_at, reply: bool) -> Outcome:
    """Reddi kaydeder; `reply` ise (dogrulanmis gonderen) saatte en fazla bir
    kez kisa aciklama gonderir."""
    if reply:
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        already = (db.query(TicketMailInbound)
                   .filter(TicketMailInbound.sender_email == sender, TicketMailInbound.outcome == "rejected",
                           TicketMailInbound.created_at >= since).count())
        if not already:
            ticket_mail.enqueue_inbound_rejection(db, address=sender, reason=reason, subject=subject)
    _record(db, internet_id=internet_id, sender=sender, outcome="rejected", reason=reason, received_at=received_at)
    return Outcome("rejected", reason)


def _process_in_provider(db: Session, message: dict, *, provider: str, sender: str, headers: Dict[str, str],
                         internet_id: str, deps: Deps) -> Outcome:
    settings = get_settings()
    received_at = _received_at(message)
    subject = str(message.get("subject") or "")
    if not ticket_mail.config(db).inbound_enabled:
        return Outcome("ignored", "inbound_disabled")
    if db.query(TicketMailInbound).filter(TicketMailInbound.internet_message_id == internet_id).first():
        return Outcome("duplicate")
    if not sender_authenticated(headers, sender):
        _record(db, internet_id=internet_id, sender=sender, outcome="rejected", reason="unauthenticated",
                received_at=received_at)
        return Outcome("rejected", "unauthenticated")
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = (db.query(TicketMailInbound)
              .filter(TicketMailInbound.sender_email == sender, TicketMailInbound.created_at >= since).count())
    if recent >= int(settings.TICKET_MAIL_INBOUND_PER_SENDER_HOUR):
        _record(db, internet_id=internet_id, sender=sender, outcome="rejected", reason="rate_limited",
                received_at=received_at)
        return Outcome("rejected", "rate_limited")

    body = clean_body((message.get("uniqueBody") or {}).get("content") or (message.get("body") or {}).get("content"))
    number = ticket_number_from(subject)
    ticket = db.query(Ticket).filter(Ticket.number == number).first() if number else None
    if ticket is not None:
        if (ticket.requester_email or "").strip().lower() != sender:
            return _reject(db, internet_id=internet_id, sender=sender, reason="not_requester", subject=subject,
                           received_at=received_at, reply=True)
        if ticket.status not in ("closed", "cancelled"):
            return _reply(db, ticket, message, body=body, sender=sender, internet_id=internet_id,
                          received_at=received_at, deps=deps)

    member = find_member(provider, sender, deps)
    if member is None:
        return _reject(db, internet_id=internet_id, sender=sender, reason="unknown_sender", subject=subject,
                       received_at=received_at, reply=True)
    return _create(db, message, member=member, subject=subject, body=body, internet_id=internet_id,
                   received_at=received_at, deps=deps)


def _requester_actor(user_id: str, display_name: Optional[str]):
    from .ticket_service import Actor

    return Actor(type="tenant_user", role="requester", id=str(user_id), display_name=display_name,
                 user_id=uuid.UUID(str(user_id)), source_user_id=str(user_id))


def _attachment_note(skipped: int, lang: str) -> str:
    if not skipped:
        return ""
    if lang == "en":
        return f"\n\n[{skipped} attachment(s) in the e-mail could not be added; please attach them in the portal if needed.]"
    return f"\n\n[E-postadaki {skipped} ek dosya eklenemedi; gerekirse portaldan ekleyin.]"


def _import_attachments(db: Session, message: dict, *, application, source_tenant, uploader_id: str,
                        deps: Deps) -> Tuple[List, int]:
    """(temiz ek kimlikleri, eklenemeyen sayisi). Ozellik kapaliysa tum
    dosya ekleri "eklenemedi" sayilir; satir ici gorseller (imza logosu)
    yok sayilir."""
    if not message.get("hasAttachments") or deps.fetch_attachments is None:
        return [], 0
    from . import ticket_attachment_service as attachments
    from .ticket_service import TicketValidationError

    files = [a for a in deps.fetch_attachments(str(message.get("id")))
             if a.get("@odata.type") == "#microsoft.graph.fileAttachment" and not a.get("isInline")]
    if not files:
        return [], 0
    settings = get_settings()
    clean, skipped = [], 0
    for item in files:
        if len(clean) >= int(settings.TICKET_ATTACHMENT_MAX_FILES):
            skipped += 1
            continue
        try:
            data = base64.b64decode(item.get("contentBytes") or "")
            row = attachments.open_upload_session(
                db, application=application, source_tenant=source_tenant, uploader_type="tenant_user",
                uploader_id=uploader_id, file_name=str(item.get("name") or "attachment"),
                size_bytes=len(data), declared_mime=item.get("contentType"),
            )
            row = attachments.store_upload(db, row, data)
        except (attachments.AttachmentDisabled, TicketValidationError, ValueError):
            skipped += 1
            continue
        except Exception:  # noqa: BLE001 — ek, talebi durdurmaz
            logger.warning("inbound attachment failed", exc_info=True)
            skipped += 1
            continue
        if row.scan_status == "clean":
            clean.append(row.id)
        else:
            skipped += 1
    return clean, skipped


def _reply(db: Session, ticket: Ticket, message: dict, *, body: str, sender: str, internet_id: str,
           received_at, deps: Deps) -> Outcome:
    from ..models.ticketing import SupportApplication, SupportSourceTenant
    from . import ticket_helpdesk
    from . import ticket_service

    app = db.get(SupportApplication, ticket.application_id)
    src = db.get(SupportSourceTenant, ticket.source_tenant_row_id)
    lang = ticket_mail.config(db).language
    clean_ids, skipped = _import_attachments(db, message, application=app, source_tenant=src,
                                             uploader_id=ticket.requester_source_user_id, deps=deps)
    text = (body or ("(boş ileti)" if lang == "tr" else "(empty message)")) + _attachment_note(skipped, lang)
    created = ticket_service.add_message(
        db, ticket, body=text, visibility="public",
        actor=_requester_actor(ticket.requester_source_user_id, ticket.requester_display_name or sender),
        author_type="requester", source_message_id=source_key(internet_id), attachment_ids=clean_ids,
        application=app, source_tenant=src,
    )
    ticket_helpdesk.mark_read(db, ticket.id, str(ticket.requester_source_user_id))
    _record(db, internet_id=internet_id, sender=sender, outcome="replied", ticket_id=ticket.id,
            message_id=created.id, received_at=received_at)
    return Outcome("replied", ticket_id=str(ticket.id))


def _create(db: Session, message: dict, *, member: Member, subject: str, body: str, internet_id: str,
            received_at, deps: Deps) -> Outcome:
    from . import ticket_helpdesk, ticket_routing, ticket_service

    settings = get_settings()
    lang = ticket_mail.config(db).language
    app = ticket_routing.require_application(db, settings.SUPPORT_HERMES_APPLICATION_CODE)
    with support.global_session() as gdb:
        slug = gdb.execute(sa_text("SELECT slug FROM tenant_registry WHERE tenant_id = CAST(:t AS uuid)"),
                           {"t": member.tenant_id}).scalar() or member.tenant_id
    source_tenant = ticket_routing.ensure_source_tenant(
        db, application=app, source_tenant_id=member.tenant_id,
        display_name=member.link_display_name or slug, slug=slug,
    )
    route, group = ticket_routing.resolve_route(db, source_tenant=source_tenant)
    clean_ids, skipped = _import_attachments(db, message, application=app, source_tenant=source_tenant,
                                             uploader_id=member.user_id, deps=deps)
    title = clean_subject(subject) or ("E-posta talebi" if lang == "tr" else "E-mail request")
    description = (body or title) + _attachment_note(skipped, lang)
    ticket = ticket_service.create_ticket(
        db, application=app, source_tenant=source_tenant, group=group, route_version=route.route_version,
        data=ticket_service.TicketCreateInput(
            source_ticket_id=source_key(internet_id), requester_source_user_id=member.user_id,
            requester_display_name=member.email, requester_email=member.email,
            title=title, description=description, category="question", impact="single_user",
            client_context={}, attachment_ids=clean_ids,
        ),
        actor=_requester_actor(member.user_id, member.email),
    )
    ticket_helpdesk.mark_read(db, ticket.id, member.user_id)
    ticket_mail.on_received(db, ticket)
    _record(db, internet_id=internet_id, sender=member.email, outcome="created", ticket_id=ticket.id,
            received_at=received_at)
    return Outcome("created", ticket_id=str(ticket.id))


# =============================================================================
# Kutu turu (dispatcher'dan)
# =============================================================================

def poll_mailbox(*, client=None, deps_factory: Optional[Callable[[str], Deps]] = None) -> dict:
    """Kutudaki iletileri isler ve klasorlere tasir. Kapaliysa hic
    baglanmaz. Bir iletinin hatasi digerlerini durdurmaz."""
    mailbox = ticket_mail.inbound_mailbox()
    summary = {"status": "disabled", "created": 0, "replied": 0, "rejected": 0, "ignored": 0, "errors": 0}
    if not mailbox:
        return summary
    if client is None:
        from .graph_service import get_graph_client

        client = get_graph_client()
        if not client.is_configured:
            summary["status"] = "graph_not_configured"
            return summary

    def run(coro):
        return asyncio.run(coro)

    messages = run(client.list_inbox(mailbox=mailbox, top=int(get_settings().TICKET_MAIL_INBOUND_BATCH)))
    summary["status"] = "completed"
    folders: Dict[str, str] = {}
    for message in messages:
        mid = str(message.get("id") or "")
        deps = deps_factory(mid) if deps_factory else Deps(
            fetch_attachments=lambda message_id: run(client.list_attachments(mailbox=mailbox, message_id=message_id)))
        try:
            outcome = process_message(message, mailbox=mailbox, deps=deps)
        except Exception as exc:  # noqa: BLE001 — sanitize; ileti reddedilenlere gider
            logger.error("inbound message failed class=%s", type(exc).__name__)
            outcome = Outcome("ignored", "error")
            summary["errors"] += 1
        key = "created" if outcome.outcome == "created" else "replied" if outcome.outcome in ("replied", "duplicate") \
            else "rejected" if outcome.outcome == "rejected" else "ignored"
        summary[key] += 1
        try:
            if outcome.folder not in folders:
                folders[outcome.folder] = run(client.ensure_folder(mailbox=mailbox, name=outcome.folder))
            run(client.move_message(mailbox=mailbox, message_id=mid, folder_id=folders[outcome.folder]))
        except Exception as exc:  # noqa: BLE001 — sonraki turda yeniden denenir
            logger.warning("inbound move failed class=%s", type(exc).__name__)
    return summary
