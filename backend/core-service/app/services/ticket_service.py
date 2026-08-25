# =============================================================================
# HERMES core — Canonical ticket servisi (is mantiginin TEK yeri)
# =============================================================================
# Kurallar (Blueprint §9):
#   - `status` alanina yazan TEK yol `_apply_transition`tir; durum
#     makinesi `ticket_state`tedir.
#   - Ticket satiri + olay + outbox AYNI transaction'da yazilir. Servis
#     COMMIT ETMEZ (`flush` eder): unit-of-work siniri route/oturuma
#     aittir — `SET LOCAL app.tenant_id` transaction'a baglidir ve
#     ortada bir commit tenant baglamini dusurur.
#   - Her mutasyon `expected_version` ister; bayat guncelleme 409.
#   - Gorunurluk kararlari BURADA VERILMEZ; `ticket_visibility` verir.
# =============================================================================

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    Ticket,
    TicketAttachment,
    TicketMessage,
    TicketResolution,
)
from ..models.user_group import UserGroup, UserGroupMember
from ..ticket_contract import (
    CLIENT_CONTEXT_ALLOWED_KEYS,
    CLIENT_CONTEXT_FORBIDDEN_SUBSTRINGS,
    CLIENT_CONTEXT_MAX_VALUE_LENGTH,
    DESCRIPTION_MAX_LENGTH,
    EVENT_INTERNAL_NOTE_ADDED,
    EVENT_TICKET_ADMIN_ACCESSED,
    EVENT_TICKET_ASSIGNMENT_CHANGED,
    EVENT_TICKET_ATTACHMENT_READY,
    EVENT_TICKET_CLOSED,
    EVENT_TICKET_CREATED,
    EVENT_TICKET_PRIORITY_CHANGED,
    EVENT_TICKET_PUBLIC_MESSAGE_ADDED,
    EVENT_TICKET_REOPENED,
    EVENT_TICKET_RESOLVED,
    EVENT_TICKET_STATUS_CHANGED,
    MESSAGE_MAX_LENGTH,
    RESOLUTION_SUMMARY_MAX_LENGTH,
    TICKET_COUNTER_KEY,
    TITLE_MAX_LENGTH,
)
from . import ticket_event_service as events
from . import ticket_metrics, ticket_state, tenant_counters
from .ticket_text import sanitize_body, sanitize_single_line


def _now():
    return datetime.now(timezone.utc)


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class TicketConflict(Exception):
    """Optimistic surum catismasi (`ticket_version_conflict`)."""


class TicketValidationError(ValueError):
    """Is kurali ihlali; cagiran yuzey sozlesme koduna cevirir."""

    def __init__(self, message: str, code: str = "validation_error"):
        self.code = code
        super().__init__(message)


# =============================================================================
# Aktor
# =============================================================================

@dataclass(frozen=True)
class Actor:
    """Bir komutu KIMIN verdigi — audit'in tasidigi tek kimlik.

    `role`, durum makinesinin sordugu ROLDUR (requester/agent/admin/
    system); `type` ise audit aktor tipidir. Ikisi bilerek ayridir: bir
    `tenant_user` hem requester (portalda) hem — support tenant'inda —
    agent olabilir.
    """

    type: str
    role: str
    id: Optional[str] = None
    display_name: Optional[str] = None
    user_id: Optional[UUID] = None
    source_user_id: Optional[str] = None
    correlation_id: Optional[str] = None
    reason: Optional[str] = None


# `_apply_transition(outbound_data=...)` icin "verilmedi" isareti:
# `None` ANLAMLI bir degerdir (musteriye olay GONDERME).
_AUTO_OUTBOUND = object()

SYSTEM_ACTOR = Actor(type="system_job", role="system", id="scheduler",
                     display_name="Hermes scheduler")


# =============================================================================
# Yardimcilar
# =============================================================================

def check_version(ticket: Ticket, expected: Optional[int]) -> None:
    """Bayat guncellemeyi reddeder.

    `expected` None ise kontrol YAPILMAZ — bu YALNIZCA sistem/otomatik
    yollar icindir (scheduler, requester reply sonrasi otomatik gecis).
    Kullaniciya donuk her mutasyon surum GONDERMEK ZORUNDADIR; API
    semasi bunu zorunlu kilar.
    """
    if expected is None:
        return
    if int(ticket.version or 1) != int(expected):
        raise TicketConflict(
            "The ticket changed since it was loaded."
        )


def _bump(ticket: Ticket) -> None:
    ticket.version = int(ticket.version or 1) + 1
    ticket.updated_at = _now()


def sanitize_client_context(raw: Optional[dict]) -> dict:
    """Diagnostics ALLOWLIST'i uygular (05 §4).

    Bilinmeyen anahtar sessizce DUSER (ileri uyumluluk); ama izinli bir
    anahtarin degeri bile token/cookie/parola gibi bir desen tasiyorsa
    REDAKTE edilir — client'in gonderdigine korumasiz guvenmiyoruz.
    """
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key in CLIENT_CONTEXT_ALLOWED_KEYS:
        if key not in raw or raw[key] is None:
            continue
        value = str(raw[key])[:CLIENT_CONTEXT_MAX_VALUE_LENGTH]
        lowered = value.lower()
        if any(bad in lowered
               for bad in CLIENT_CONTEXT_FORBIDDEN_SUBSTRINGS):
            value = "[redacted]"
        # Sayfa yolu: query string ve fragment KESILIR (01 §2).
        if key == "page_path":
            value = value.split("?")[0].split("#")[0]
        out[key] = value
    return out


def group_or_error(db: Session, group_id) -> UserGroup:
    group = db.get(UserGroup, group_id)
    if group is None:
        raise TicketValidationError(
            "The target support group does not exist.",
            code="group_inactive",
        )
    if not group.is_active:
        raise TicketValidationError(
            "The target support group is no longer active.",
            code="group_inactive",
        )
    return group


def is_active_group_member(db: Session, *, group_id, user_id) -> bool:
    return (
        db.query(UserGroupMember.id)
        .filter(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id == user_id,
            UserGroupMember.is_active.is_(True),
        )
        .first()
        is not None
    )


def customer_window_open(ticket: Ticket) -> bool:
    """Resolved ticket icin musteri dogrulama penceresi hala acik mi?"""
    if ticket.resolved_at is None:
        return True
    days = int(get_settings().SUPPORT_AUTO_CLOSE_DAYS or 7)
    deadline = _aware(ticket.resolved_at) + timedelta(days=days)
    return _now() <= deadline


def has_agent_reply(db: Session, ticket: Ticket) -> bool:
    return (
        db.query(TicketMessage.id)
        .filter(
            TicketMessage.ticket_id == ticket.id,
            TicketMessage.author_type == "agent",
        )
        .first()
        is not None
    )


def _next_message_sequence(db: Session, ticket: Ticket) -> int:
    current = (
        db.query(func.max(TicketMessage.sequence))
        .filter(TicketMessage.ticket_id == ticket.id)
        .scalar()
    )
    return int(current or 0) + 1


# =============================================================================
# Olusturma
# =============================================================================

@dataclass
class TicketCreateInput:
    """Kaynaktan bagimsiz create girdisi.

    Hem Hermes portali hem integration ingress'i AYNI yapiyi doldurur;
    boylece iki yuzey icin iki farkli is kurali olusamaz.
    """

    source_ticket_id: str
    requester_source_user_id: str
    title: str
    description: str
    category: str
    impact: str
    requester_display_name: Optional[str] = None
    requester_email: Optional[str] = None
    reproduction_steps: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    error_code: Optional[str] = None
    correlation_id: Optional[str] = None
    occurred_at: Optional[datetime] = None
    client_context: dict = field(default_factory=dict)
    attachment_ids: Sequence[UUID] = field(default_factory=tuple)


def create_ticket(
    db: Session,
    *,
    application: SupportApplication,
    source_tenant: SupportSourceTenant,
    group: UserGroup,
    route_version: int,
    data: TicketCreateInput,
    actor: Actor,
) -> Ticket:
    """Canonical ticket + ilk mesaj + ekler + olay + outbox — TEK
    transaction (03 §2, adim 6).

    Duplicate'e karsi IKI katman vardir: cagirandaki idempotency kaydi
    ve buradaki `uq_tickets_source_identity`. Ikincisi, idempotency
    anahtari gonderilmemis bir retry'da bile ayni kaynak ticket'in iki
    kez canonical olmasini engeller.
    """
    started = time.perf_counter()

    existing = (
        db.query(Ticket)
        .filter(
            Ticket.application_id == application.id,
            Ticket.source_tenant_row_id == source_tenant.id,
            Ticket.source_ticket_id == data.source_ticket_id,
        )
        .first()
    )
    if existing is not None:
        # Ayni kaynak ticket zaten canonical: retry'a AYNI kaydi doner.
        return existing

    number = tenant_counters.next_number(
        db, tenant_id=source_tenant.tenant_id,
        counter_key=TICKET_COUNTER_KEY,
    )

    priority = ticket_state.clamp_priority(
        ticket_state.default_priority(data.impact), data.impact
    )

    ticket = Ticket(
        id=uuid.uuid4(),
        number=number,
        application_id=application.id,
        source_tenant_row_id=source_tenant.id,
        source_ticket_id=data.source_ticket_id,
        requester_source_user_id=str(data.requester_source_user_id),
        requester_display_name=sanitize_single_line(
            data.requester_display_name, max_length=200
        ) or None,
        requester_email=(data.requester_email or None),
        title=sanitize_single_line(data.title, max_length=TITLE_MAX_LENGTH),
        category=data.category,
        impact=data.impact,
        priority=priority,
        reproduction_steps=sanitize_body(
            data.reproduction_steps or "", max_length=DESCRIPTION_MAX_LENGTH
        ) or None,
        expected_result=sanitize_body(
            data.expected_result or "", max_length=DESCRIPTION_MAX_LENGTH
        ) or None,
        actual_result=sanitize_body(
            data.actual_result or "", max_length=DESCRIPTION_MAX_LENGTH
        ) or None,
        error_code=sanitize_single_line(
            data.error_code, max_length=80
        ) or None,
        correlation_id=(data.correlation_id or actor.correlation_id),
        occurred_at=data.occurred_at,
        client_context_json=sanitize_client_context(data.client_context),
        status="open",
        assigned_group_id=group.id,
        assigned_group_name_snapshot=group.name,
        assigned_user_id=None,
        route_version=int(route_version or 1),
        last_public_activity_at=_now(),
        version=1,
        event_sequence=0,
    )
    db.add(ticket)
    db.flush()

    # Ilk description bir PUBLIC mesajdir (02 §6): musteri onu
    # conversation'in basinda gorur, agent ayni akista yanitlar.
    message = TicketMessage(
        ticket_id=ticket.id,
        sequence=1,
        visibility="public",
        author_type="requester",
        author_user_id=actor.user_id,
        author_source_user_id=str(data.requester_source_user_id),
        author_display_name=ticket.requester_display_name,
        body=sanitize_body(
            data.description, max_length=DESCRIPTION_MAX_LENGTH
        ),
        body_format="plain",
    )
    db.add(message)
    db.flush()

    attachments = []
    if data.attachment_ids:
        attachments = attach_files(
            db, ticket=ticket, attachment_ids=data.attachment_ids,
            message=message, visibility="public",
            emit_ready=False,
        )

    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_CREATED,
        actor_type=actor.type,
        actor_id=actor.id,
        actor_display_name=actor.display_name,
        correlation_id=ticket.correlation_id,
        metadata={
            "application_code": application.code,
            "source_tenant_id": source_tenant.source_tenant_id,
            "route_version": ticket.route_version,
            "group_id": str(group.id),
        },
        outbound_data=events.build_created(ticket),
        application=application,
        source_tenant=source_tenant,
    )

    if attachments:
        emit_attachment_ready(
            db, ticket, attachments, actor=actor,
            application=application, source_tenant=source_tenant,
        )

    ticket_metrics.ticket_created(application.code, ticket.category)
    ticket_metrics.observe_create_duration(time.perf_counter() - started)
    return ticket


# =============================================================================
# Ek baglama
# =============================================================================

def attach_files(
    db: Session,
    *,
    ticket: Ticket,
    attachment_ids: Iterable[UUID],
    message: Optional[TicketMessage] = None,
    resolution: Optional[TicketResolution] = None,
    visibility: str = "public",
    emit_ready: bool = True,
    actor: Optional[Actor] = None,
    application=None,
    source_tenant=None,
) -> List[TicketAttachment]:
    """Taranmis staging nesnelerini ticket'a baglar.

    FAIL-CLOSED: `clean` OLMAYAN hicbir ek baglanmaz. Reddedilen ya da
    taramasi biten-bitmemis bir dosya sessizce eklenmez; cagiran
    `attachment_not_ready` alir ve kullaniciya durum gosterilir.
    """
    ids = [UUID(str(a)) for a in attachment_ids if a]
    if not ids:
        return []
    rows = (
        db.query(TicketAttachment)
        .filter(TicketAttachment.id.in_(ids))
        .all()
    )
    found = {row.id for row in rows}
    missing = [str(i) for i in ids if i not in found]
    if missing:
        raise TicketValidationError(
            "One or more attachments were not found.",
            code="attachment_not_ready",
        )
    if len(rows) > int(get_settings().TICKET_ATTACHMENT_MAX_FILES):
        raise TicketValidationError(
            "Too many attachments for a single ticket.",
            code="validation_error",
        )
    for row in rows:
        if row.attached_at is not None and row.ticket_id != ticket.id:
            raise TicketValidationError(
                "An attachment is already attached to another ticket.",
                code="attachment_not_ready",
            )
        if row.scan_status != "clean":
            raise TicketValidationError(
                "An attachment has not finished scanning or was "
                "rejected.",
                code="attachment_not_ready",
            )
        if row.application_id != ticket.application_id:
            raise TicketValidationError(
                "An attachment belongs to another application.",
                code="attachment_not_ready",
            )
        row.ticket_id = ticket.id
        row.message_id = message.id if message is not None else None
        row.resolution_id = (
            resolution.id if resolution is not None else None
        )
        row.visibility = visibility
        row.source_tenant_row_id = ticket.source_tenant_row_id
        row.attached_at = _now()
        row.expires_at = None
    db.flush()
    if emit_ready:
        emit_attachment_ready(
            db, ticket, rows, actor=actor, application=application,
            source_tenant=source_tenant,
        )
    return rows


def emit_attachment_ready(
    db: Session,
    ticket: Ticket,
    attachments: Iterable[TicketAttachment],
    *,
    actor: Optional[Actor] = None,
    application=None,
    source_tenant=None,
) -> None:
    """`ticket.attachment_ready.v1` — YALNIZCA public ekler icin.

    Internal ekler kaynak uygulamaya duyurulmaz; varliklari bile
    musteri yuzeyine sizmaz.

    Olay, ticket'in KENDI olayindan SONRA yayilmali (create akisinda
    `emit_ready=False` ile ertelenir): consumer'lar sirayi
    `sequence` uzerinden uygular ve heniz bilmedigi bir ticket icin ek
    olayi almak bosluk (gap) olarak gorunurdu.
    """
    who = actor or SYSTEM_ACTOR
    for row in attachments:
        if row.visibility != "public":
            continue
        events.record_event(
            db, ticket,
            event_type=EVENT_TICKET_ATTACHMENT_READY,
            actor_type=who.type, actor_id=who.id,
            actor_display_name=who.display_name,
            correlation_id=who.correlation_id,
            metadata={"attachment_id": str(row.id)},
            outbound_data=events.build_attachment_ready(row),
            application=application, source_tenant=source_tenant,
        )


# =============================================================================
# Mesajlar
# =============================================================================

def add_message(
    db: Session,
    ticket: Ticket,
    *,
    body: str,
    visibility: str,
    actor: Actor,
    author_type: str,
    source_message_id: Optional[str] = None,
    attachment_ids: Sequence[UUID] = (),
    expected_version: Optional[int] = None,
    application: Optional[SupportApplication] = None,
    source_tenant: Optional[SupportSourceTenant] = None,
) -> TicketMessage:
    """Public reply veya internal not ekler.

    Otomatik durum kurallari (02 §6) BURADA uygulanir, cunku "musteri
    cevap yazdi" ile "ticket ise dondu" ayni olayin iki yuzudur:
      - `waiting_customer` + requester reply → `in_progress`
      - `resolved` + requester reply (pencere acikken) → `reopened`
    """
    if visibility not in ("public", "internal"):
        raise TicketValidationError("Unknown message visibility.")
    if author_type == "requester" and visibility != "public":
        raise TicketValidationError(
            "Requesters cannot post internal notes."
        )
    check_version(ticket, expected_version)

    if source_message_id:
        existing = (
            db.query(TicketMessage)
            .filter(
                TicketMessage.ticket_id == ticket.id,
                TicketMessage.source_message_id == source_message_id,
            )
            .first()
        )
        if existing is not None:
            return existing  # idempotent replay

    clean_body = sanitize_body(body, max_length=MESSAGE_MAX_LENGTH)
    if not clean_body:
        raise TicketValidationError("The message body cannot be empty.")

    # Musteriye gorunen agent mesajlarinda YAZAR ADI = EKIP ADI.
    # Bireysel agent kimligini musteri yuzeyine tasimak gereksiz bir
    # PII/organizasyon sizintisidir; ekip adi zaten sozlesmenin
    # "display-safe group name" ilkesidir. Agent tarafi kimin yazdigini
    # `author_user_id` uzerinden (ve audit akisindan) gorur.
    display_name = actor.display_name
    if visibility == "public" and author_type == "agent":
        display_name = ticket.assigned_group_name_snapshot or "Support"

    message = TicketMessage(
        ticket_id=ticket.id,
        sequence=_next_message_sequence(db, ticket),
        visibility=visibility,
        author_type=author_type,
        author_user_id=actor.user_id,
        author_source_user_id=actor.source_user_id,
        author_display_name=display_name,
        body=clean_body,
        body_format="plain",
        source_message_id=source_message_id,
    )
    db.add(message)
    db.flush()

    if attachment_ids:
        attach_files(
            db, ticket=ticket, attachment_ids=attachment_ids,
            message=message, visibility=visibility, actor=actor,
            application=application, source_tenant=source_tenant,
        )

    _bump(ticket)

    if visibility == "public":
        ticket.last_public_activity_at = _now()
        if author_type == "agent" and ticket.first_response_at is None:
            ticket.first_response_at = _now()
            created = _aware(ticket.created_at)
            if created:
                ticket_metrics.observe_first_response(
                    (_now() - created).total_seconds()
                )
        events.record_event(
            db, ticket,
            event_type=EVENT_TICKET_PUBLIC_MESSAGE_ADDED,
            actor_type=actor.type,
            actor_id=actor.id,
            actor_display_name=actor.display_name,
            correlation_id=actor.correlation_id,
            metadata={"message_id": str(message.id)},
            outbound_data=events.build_public_message(ticket, message),
            application=application,
            source_tenant=source_tenant,
        )
    else:
        # Internal not: IC olay akisina girer, outbox'a GIRMEZ.
        events.record_event(
            db, ticket,
            event_type=EVENT_INTERNAL_NOTE_ADDED,
            actor_type=actor.type,
            actor_id=actor.id,
            actor_display_name=actor.display_name,
            correlation_id=actor.correlation_id,
            metadata={"message_id": str(message.id)},
        )
    ticket_metrics.message_added(visibility)

    if author_type == "requester":
        _apply_requester_reply_rules(
            db, ticket, actor=actor,
            application=application, source_tenant=source_tenant,
        )
    return message


def _apply_requester_reply_rules(
    db: Session, ticket: Ticket, *, actor: Actor,
    application=None, source_tenant=None,
) -> None:
    if ticket.status == "waiting_customer":
        _apply_transition(
            db, ticket, to_status="in_progress",
            actor=Actor(type="system_job", role="system",
                        id=actor.id, display_name=actor.display_name,
                        correlation_id=actor.correlation_id),
            application=application, source_tenant=source_tenant,
        )
    elif ticket.status == "resolved" and customer_window_open(ticket):
        _apply_transition(
            db, ticket, to_status="reopened",
            actor=actor, reason="Customer replied to a resolved ticket.",
            application=application, source_tenant=source_tenant,
            event_type=EVENT_TICKET_REOPENED,
        )


# =============================================================================
# Durum gecisleri
# =============================================================================

def _apply_transition(
    db: Session,
    ticket: Ticket,
    *,
    to_status: str,
    actor: Actor,
    reason: Optional[str] = None,
    has_public_message: bool = False,
    has_resolution: bool = False,
    application=None,
    source_tenant=None,
    event_type: Optional[str] = None,
    extra_metadata: Optional[dict] = None,
    outbound_data: Optional[dict] = _AUTO_OUTBOUND,
) -> Ticket:
    """`status` alanina yazan TEK fonksiyon.

    `outbound_data` verilmezse olay tipine gore TURETILIR; verilirse
    (orn. resolve, kendi zengin cozum govdesini tasir) o kullanilir.
    Boylece ayni gecis icin IKI olay yayilmaz.
    """
    from_status = ticket.status
    ticket_state.validate(
        from_status=from_status,
        to_status=to_status,
        role=actor.role,
        has_public_message=has_public_message,
        has_resolution=has_resolution,
        reason=reason,
        within_customer_window=customer_window_open(ticket),
    )

    ticket.status = to_status
    now = _now()
    if to_status == "resolved":
        ticket.resolved_at = now
    if to_status == "closed":
        ticket.closed_at = now
    if to_status in ("reopened", "in_progress"):
        ticket.closed_at = None
    if to_status == "reopened":
        ticket.resolved_at = None
    _bump(ticket)

    chosen_type = event_type or EVENT_TICKET_STATUS_CHANGED
    if outbound_data is not _AUTO_OUTBOUND:
        outbound = outbound_data
    elif chosen_type == EVENT_TICKET_REOPENED:
        outbound = events.build_reopened(
            ticket, actor_type=actor.type, reason=reason
        )
    elif chosen_type == EVENT_TICKET_CLOSED:
        outbound = events.build_closed(ticket, actor_type=actor.type)
    else:
        outbound = events.build_status_changed(
            ticket, from_status=from_status, to_status=to_status,
            actor_type=actor.type, reason=reason,
        )

    metadata = {"from_status": from_status, "to_status": to_status}
    if extra_metadata:
        metadata.update(extra_metadata)

    events.record_event(
        db, ticket,
        event_type=chosen_type,
        actor_type=actor.type,
        actor_id=actor.id,
        actor_display_name=actor.display_name,
        reason=reason,
        metadata=metadata,
        correlation_id=actor.correlation_id,
        outbound_data=outbound,
        application=application,
        source_tenant=source_tenant,
    )
    ticket_metrics.transition(from_status, to_status)
    return ticket


def transition(
    db: Session,
    ticket: Ticket,
    *,
    to_status: str,
    actor: Actor,
    expected_version: Optional[int],
    reason: Optional[str] = None,
    public_message: Optional[str] = None,
    attachment_ids: Sequence[UUID] = (),
    application=None,
    source_tenant=None,
) -> Ticket:
    """Agent/musteri durum komutu.

    `waiting_customer` gecisi ZORUNLU olarak ayni komutta bir public
    mesaj tasir (02 §3) — "bilgi bekliyoruz" diyip ne istendigini
    yazmamak, musteriyi sessiz bir duvara birakirdi.
    """
    check_version(ticket, expected_version)
    if actor.role not in ("agent", "admin"):
        # Musteri tarafi durum degisikligini ADANMIS uclardan yapar
        # (reopen / confirm-close / cancel) ve reply'in otomatik
        # kurallarindan gecer. Genel `transition` musteriye acilsaydi,
        # ayni istekte hem otomatik kural hem elle gecis calisir ve
        # birbirini gecersiz kilardi.
        raise TicketValidationError(
            "Only support agents can use the generic transition "
            "command.",
            code="forbidden",
        )

    message = None
    if public_message:
        message = add_message(
            db, ticket, body=public_message, visibility="public",
            actor=actor, author_type="agent",
            attachment_ids=attachment_ids,
            application=application, source_tenant=source_tenant,
        )
        # add_message zaten surumu artirdi; gecis kontrolu tekrar
        # yapilmasin diye expected_version tuketildi.

    return _apply_transition(
        db, ticket, to_status=to_status, actor=actor, reason=reason,
        has_public_message=message is not None,
        application=application, source_tenant=source_tenant,
    )


# =============================================================================
# Atama
# =============================================================================

def assign_group(
    db: Session,
    ticket: Ticket,
    *,
    group_id,
    actor: Actor,
    expected_version: Optional[int],
    reason: Optional[str] = None,
    application=None,
    source_tenant=None,
) -> Ticket:
    """Hedef grubu degistirir.

    Yeni grubun uyesi OLMAYAN bir assignee ATOMIK olarak dusurulur
    (02 §5): aksi halde ticket, gorunurlugu olmayan birine atanmis
    gorunurdu — kimsenin bakmadigi bir kuyruk.
    """
    check_version(ticket, expected_version)
    group = group_or_error(db, group_id)
    if ticket.assigned_group_id == group.id:
        return ticket

    previous_group = ticket.assigned_group_name_snapshot
    ticket.assigned_group_id = group.id
    ticket.assigned_group_name_snapshot = group.name

    dropped_assignee = None
    if ticket.assigned_user_id is not None and not is_active_group_member(
        db, group_id=group.id, user_id=ticket.assigned_user_id
    ):
        dropped_assignee = str(ticket.assigned_user_id)
        ticket.assigned_user_id = None

    _bump(ticket)
    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_ASSIGNMENT_CHANGED,
        actor_type=actor.type, actor_id=actor.id,
        actor_display_name=actor.display_name, reason=reason,
        metadata={
            "from_group": previous_group,
            "to_group": group.name,
            "dropped_assignee": dropped_assignee,
        },
        correlation_id=actor.correlation_id,
        outbound_data=events.build_assignment_changed(ticket),
        application=application, source_tenant=source_tenant,
    )
    return ticket


def assign_user(
    db: Session,
    ticket: Ticket,
    *,
    user_id: Optional[UUID],
    actor: Actor,
    expected_version: Optional[int],
) -> Ticket:
    """Grup ICINDE bireysel atama (opsiyonel).

    Hedef, ticket'in grubunun AKTIF uyesi olmak zorundadir. Bu, atamanin
    gorunurluk uretmedigi kuralinin ikiz garantisidir: gorunurlugu
    olmayan birine atanamaz.

    Musteriye giden olay YOKTUR: kisi atamasi ic organizasyon bilgisidir.
    """
    check_version(ticket, expected_version)
    if user_id is not None and not is_active_group_member(
        db, group_id=ticket.assigned_group_id, user_id=user_id
    ):
        raise TicketValidationError(
            "The assignee must be an active member of the ticket's "
            "support group.",
            code="validation_error",
        )
    previous = ticket.assigned_user_id
    ticket.assigned_user_id = user_id
    _bump(ticket)
    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_ASSIGNMENT_CHANGED,
        actor_type=actor.type, actor_id=actor.id,
        actor_display_name=actor.display_name,
        metadata={
            "from_user": str(previous) if previous else None,
            "to_user": str(user_id) if user_id else None,
        },
        correlation_id=actor.correlation_id,
    )
    return ticket


def set_priority(
    db: Session, ticket: Ticket, *, priority: str, actor: Actor,
    expected_version: Optional[int],
) -> Ticket:
    check_version(ticket, expected_version)
    clamped = ticket_state.clamp_priority(priority, ticket.impact)
    if clamped != priority:
        raise TicketValidationError(
            "This ticket's impact requires at least "
            f"'{clamped}' priority.",
            code="validation_error",
        )
    previous = ticket.priority
    ticket.priority = clamped
    _bump(ticket)
    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_PRIORITY_CHANGED,
        actor_type=actor.type, actor_id=actor.id,
        actor_display_name=actor.display_name,
        metadata={"from": previous, "to": clamped},
        correlation_id=actor.correlation_id,
    )
    return ticket


# =============================================================================
# Cozum / reopen / kapatma
# =============================================================================

def resolve(
    db: Session,
    ticket: Ticket,
    *,
    resolution_code: str,
    public_summary: str,
    actor: Actor,
    expected_version: Optional[int],
    public_workaround: Optional[str] = None,
    fix_version: Optional[str] = None,
    internal_root_cause: Optional[str] = None,
    internal_note: Optional[str] = None,
    attachment_ids: Sequence[UUID] = (),
    duplicate_of_ticket_id: Optional[UUID] = None,
    application=None,
    source_tenant=None,
) -> TicketResolution:
    """Cozum revizyonu olusturur ve ticket'i `resolved` yapar.

    Her resolve YENI bir revizyondur; onceki cozum silinmez, yalnizca
    `superseded_at` damgasi alir (02 §7). Reopen sonrasi musteri eski
    cozumu de history'de gorebilir.
    """
    check_version(ticket, expected_version)

    summary = sanitize_body(
        public_summary, max_length=RESOLUTION_SUMMARY_MAX_LENGTH
    )
    if len(summary) < 20:
        raise TicketValidationError(
            "The customer-visible resolution summary must be at least "
            "20 characters."
        )

    previous = (
        db.query(TicketResolution)
        .filter(TicketResolution.ticket_id == ticket.id)
        .order_by(TicketResolution.revision.desc())
        .first()
    )
    if previous is not None and previous.superseded_at is None:
        previous.superseded_at = _now()

    revision = int(ticket.resolution_revision or 0) + 1
    resolution = TicketResolution(
        ticket_id=ticket.id,
        revision=revision,
        resolution_code=resolution_code,
        public_summary=summary,
        public_workaround=sanitize_body(
            public_workaround or "", max_length=RESOLUTION_SUMMARY_MAX_LENGTH
        ) or None,
        fix_version=sanitize_single_line(
            fix_version, max_length=120
        ) or None,
        internal_root_cause=sanitize_body(
            internal_root_cause or "", max_length=RESOLUTION_SUMMARY_MAX_LENGTH
        ) or None,
        resolved_by_user_id=actor.user_id,
        resolved_by_display_name=actor.display_name,
        resolved_at=_now(),
    )
    db.add(resolution)
    db.flush()

    if attachment_ids:
        attach_files(
            db, ticket=ticket, attachment_ids=attachment_ids,
            resolution=resolution, visibility="public", actor=actor,
            application=application, source_tenant=source_tenant,
        )

    ticket.current_resolution_id = resolution.id
    ticket.resolution_revision = revision
    if resolution_code == "duplicate" and duplicate_of_ticket_id:
        ticket.duplicate_of_ticket_id = duplicate_of_ticket_id

    _apply_transition(
        db, ticket, to_status="resolved", actor=actor,
        has_resolution=True,
        application=application, source_tenant=source_tenant,
        event_type=EVENT_TICKET_RESOLVED,
        extra_metadata={"resolution_id": str(resolution.id),
                        "resolution_revision": revision,
                        "resolution_code": resolution_code},
        outbound_data=events.build_resolved(ticket, resolution),
    )

    if internal_note:
        add_message(
            db, ticket, body=internal_note, visibility="internal",
            actor=actor, author_type="agent",
            application=application, source_tenant=source_tenant,
        )

    created = _aware(ticket.created_at)
    if created:
        ticket_metrics.observe_resolution(
            (_now() - created).total_seconds()
        )
    return resolution


def reopen(
    db: Session,
    ticket: Ticket,
    *,
    reason: str,
    actor: Actor,
    expected_version: Optional[int],
    application=None,
    source_tenant=None,
) -> Ticket:
    check_version(ticket, expected_version)
    return _apply_transition(
        db, ticket, to_status="reopened", actor=actor, reason=reason,
        application=application, source_tenant=source_tenant,
        event_type=EVENT_TICKET_REOPENED,
    )


def confirm_close(
    db: Session,
    ticket: Ticket,
    *,
    actor: Actor,
    expected_version: Optional[int] = None,
    application=None,
    source_tenant=None,
) -> Ticket:
    return _apply_transition(
        db, ticket, to_status="closed", actor=actor,
        application=application, source_tenant=source_tenant,
        event_type=EVENT_TICKET_CLOSED,
    )


def cancel(
    db: Session,
    ticket: Ticket,
    *,
    reason: str,
    actor: Actor,
    expected_version: Optional[int],
    application=None,
    source_tenant=None,
) -> Ticket:
    """Requester iptali — YALNIZCA is baslamadan (02 §3 matris)."""
    check_version(ticket, expected_version)
    if actor.role == "requester" and not ticket_state.can_requester_cancel(
        status=ticket.status,
        has_agent_reply=has_agent_reply(db, ticket),
    ):
        raise ticket_state.TransitionError(
            "This ticket can no longer be cancelled because support has "
            "already replied. Ask the support team to close it instead.",
        )
    return _apply_transition(
        db, ticket, to_status="cancelled", actor=actor, reason=reason,
        application=application, source_tenant=source_tenant,
    )


def record_admin_access(
    db: Session, ticket: Ticket, *, actor: Actor
) -> None:
    """`tickets.admin` grup sinirini asarak bir ticket'i acti — AUDIT.

    05 §2: admin istisnasi acikca auditlenir. Yalnizca DETAY okumasi
    kaydedilir; liste sorgulari kaydedilmez (gurultu/oran).
    """
    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_ADMIN_ACCESSED,
        actor_type=actor.type, actor_id=actor.id,
        actor_display_name=actor.display_name,
        correlation_id=actor.correlation_id,
        metadata={"group_id": str(ticket.assigned_group_id)},
    )


# =============================================================================
# Scheduler: 7 gunluk otomatik kapatma
# =============================================================================

def auto_close_due_tickets(db: Session, *, limit: int = 500) -> dict:
    """Dogrulama penceresi dolmus `resolved` ticket'lari kapatir (D-007).

    YALNIZCA uygun kayitlar: `resolved` durumunda ve `resolved_at`
    penceresi dolmus olanlar. Baska hicbir durum degismez.
    """
    days = int(get_settings().SUPPORT_AUTO_CLOSE_DAYS or 7)
    cutoff = _now() - timedelta(days=days)
    rows = (
        db.query(Ticket)
        .filter(Ticket.status == "resolved",
                Ticket.resolved_at.isnot(None),
                Ticket.resolved_at <= cutoff)
        .order_by(Ticket.resolved_at)
        .limit(limit)
        .all()
    )
    closed = 0
    for ticket in rows:
        _apply_transition(
            db, ticket, to_status="closed", actor=SYSTEM_ACTOR,
            event_type=EVENT_TICKET_CLOSED,
            extra_metadata={"auto_close_days": days},
        )
        closed += 1
    return {"ok": True, "closed": closed, "window_days": days}
