# =============================================================================
# HERMES core — Ticket olay akisi + giden outbox (TEK URETICI)
# =============================================================================
# Iki ayri defter, TEK yerden yazilir:
#
#   ticket_events        → Hermes'in ic audit/domain akisi. HER SEY buraya
#                          girer (internal not, admin override okuma...).
#   ticket_outbox_events → kaynak uygulamaya GIDECEK olaylar. YALNIZCA
#                          musteri-guvenli anlik.
#
# "Tek uretici" olmasi bir guvenlik ozelligidir: internal icerigin
# webhook'a sizmasi, ancak bu modulde bilincli bir hata ile mumkun olur —
# ve `tests/test_ticket_internal_leakage.py` tam olarak bunu kollar.
# Payload uretimi ASLA ORM nesnesini `model_dump()` ile serialize etmez;
# her alan TEK TEK secilir (allowlist).
#
# Sira garantisi (06 §3): her ticket'ta monoton `sequence`. Consumer
# "mevcut + 1" ise uygular, kucuk/esitse idempotent ack eder, buyukse
# snapshot ile bosluk kapatir. `aggregate_version` ticket'in optimistic
# surumudur.
# =============================================================================

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    Ticket,
    TicketEvent,
    TicketOutboxEvent,
)
from ..ticket_contract import (
    EVENT_TICKET_ASSIGNMENT_CHANGED,
    EVENT_TICKET_ATTACHMENT_READY,
    EVENT_TICKET_CLOSED,
    EVENT_TICKET_CREATED,
    EVENT_TICKET_PUBLIC_MESSAGE_ADDED,
    EVENT_TICKET_REOPENED,
    EVENT_TICKET_RESOLVED,
    EVENT_TICKET_STATUS_CHANGED,
    OUTBOUND_EVENT_TYPES,
    format_ticket_number,
)


def _now():
    return datetime.now(timezone.utc)


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def next_sequence(ticket: Ticket) -> int:
    """Ticket'in bir sonraki olay sirasi. Sayac ticket satirinda tutulur
    (MAX()+1 DEGIL): ayni transaction icinde uretilir ve satir kilidi
    altindadir."""
    ticket.event_sequence = int(ticket.event_sequence or 0) + 1
    return ticket.event_sequence


# =============================================================================
# Musteri-guvenli payload ureticileri (ALLOWLIST)
# =============================================================================
# Her uretici, o olay tipinin kaynak uygulamaya gidecek `data` govdesini
# dondurur. Internal not govdesi, internal root cause, agent kullanici
# kimligi ve teknik teshis alanlari BURAYA GIREMEZ.

def _group_payload(ticket: Ticket) -> dict:
    # Yalnizca GOSTERIM adi: grup UUID'si ve uye kimlikleri disari cikmaz
    # (contract §10: "customer payload only display-safe group name").
    return {"name": ticket.assigned_group_name_snapshot}


def _ticket_core(ticket: Ticket) -> dict:
    return {
        "status": ticket.status,
        "category": ticket.category,
        "impact": ticket.impact,
        "title": ticket.title,
        "assigned_group": _group_payload(ticket),
        "created_at": _iso(ticket.created_at),
        "updated_at": _iso(ticket.updated_at),
    }


def build_created(ticket: Ticket) -> dict:
    return _ticket_core(ticket)


def build_status_changed(
    ticket: Ticket, *, from_status: str, to_status: str,
    actor_type: str, reason: Optional[str],
) -> dict:
    data = {
        "from_status": from_status,
        "to_status": to_status,
        "changed_at": _iso(_now()),
        "changed_by": _customer_facing_actor(actor_type),
    }
    # Gerekce YALNIZCA musterinin KENDI yazdigi durumda geri gonderilir.
    # Agent/admin gerekcesi ic bir not olabilir ve musteri yuzeyine
    # cikmasi bilincli bir karar gerektirir — v1'de cikmaz.
    if reason and actor_type == "tenant_user":
        data["reason"] = reason
    return data


def build_public_message(ticket: Ticket, message) -> dict:
    return {
        "message_id": str(message.id),
        "sequence": message.sequence,
        "author_type": message.author_type,
        "author_display_name": message.author_display_name,
        "body": message.body,
        "body_format": message.body_format,
        "created_at": _iso(message.created_at),
    }


def build_assignment_changed(ticket: Ticket) -> dict:
    # Bilerek YALNIZCA grup adi: hangi agent'a atandigi musteri verisi
    # degildir ve Duosis ic organizasyonunu sizdirir.
    return {"assigned_group": _group_payload(ticket)}


def build_resolved(ticket: Ticket, resolution) -> dict:
    return {
        "resolution": {
            "revision": resolution.revision,
            "code": resolution.resolution_code,
            "summary": resolution.public_summary,
            "workaround": resolution.public_workaround,
            "fix_version": resolution.fix_version,
            "resolved_at": _iso(resolution.resolved_at),
            "resolved_by_team": ticket.assigned_group_name_snapshot,
        },
        "status": ticket.status,
        # `internal_root_cause` BILEREK YOK.
    }


def build_reopened(
    ticket: Ticket, *, actor_type: str, reason: Optional[str]
) -> dict:
    data = {
        "reopened_at": _iso(_now()),
        "reopened_by": _customer_facing_actor(actor_type),
        "status": ticket.status,
    }
    if reason and actor_type == "tenant_user":
        data["reason"] = reason
    return data


def build_closed(ticket: Ticket, *, actor_type: str) -> dict:
    return {
        "closed_at": _iso(ticket.closed_at),
        "closed_by": _customer_facing_actor(actor_type),
        "status": ticket.status,
    }


def build_attachment_ready(attachment) -> dict:
    return {
        "attachment_id": str(attachment.id),
        "file_name": attachment.file_name,
        "size_bytes": int(attachment.size_bytes or 0),
        "mime_type": attachment.detected_mime_type
        or attachment.declared_mime_type,
        "visibility": attachment.visibility,
        "message_id": (
            str(attachment.message_id) if attachment.message_id else None
        ),
        # URL YOK: indirme her zaman yetkili bir cagriyla, o anda
        # uretilen kisa omurlu bir erisimle yapilir (05 §5).
    }


def _customer_facing_actor(actor_type: str) -> str:
    """Ic aktor tiplerini musteri sozlugune cevirir.

    `support_agent`/`platform_admin` ayrimi musteri icin anlamsizdir ve
    ic organizasyon bilgisidir; ikisi de "support" olarak gorunur.
    """
    if actor_type == "tenant_user":
        return "customer"
    if actor_type == "system_job":
        return "system"
    if actor_type == "integration_client":
        return "integration"
    return "support"


_BUILDERS = {
    EVENT_TICKET_CREATED,
    EVENT_TICKET_STATUS_CHANGED,
    EVENT_TICKET_PUBLIC_MESSAGE_ADDED,
    EVENT_TICKET_ASSIGNMENT_CHANGED,
    EVENT_TICKET_RESOLVED,
    EVENT_TICKET_REOPENED,
    EVENT_TICKET_CLOSED,
    EVENT_TICKET_ATTACHMENT_READY,
}


# =============================================================================
# Yazma
# =============================================================================

def record_event(
    db: Session,
    ticket: Ticket,
    *,
    event_type: str,
    actor_type: str,
    actor_id: Optional[str] = None,
    actor_display_name: Optional[str] = None,
    reason: Optional[str] = None,
    metadata: Optional[dict] = None,
    correlation_id: Optional[str] = None,
    outbound_data: Optional[dict] = None,
    application: Optional[SupportApplication] = None,
    source_tenant: Optional[SupportSourceTenant] = None,
) -> TicketEvent:
    """Ic olayi yazar; `outbound_data` verilmisse outbox'a da kuyruklar.

    ONEMLI: cagiran, `outbound_data`yi YUKARIDAKI builder'lardan
    almalidir. Serbest bir sozluk gecirmek, sozlesme disi/riskli alan
    sizdirmanin yoludur — bu yuzden outbox yazimi burada, olay tipi
    kapali kumeye karsi dogrulanarak yapilir.
    """
    # Kapali kume kontrolu EN BASTA: gecersiz bir olay tipi, ticket'in
    # sira sayacini ILERLETMEDEN reddedilmeli (yoksa basarisiz bir cagri
    # akista bosluk birakirdi).
    if outbound_data is not None and event_type not in OUTBOUND_EVENT_TYPES:
        raise ValueError(
            f"'{event_type}' is not an outbound event type; it must "
            "never reach a source application."
        )

    sequence = next_sequence(ticket)
    event = TicketEvent(
        ticket_id=ticket.id,
        sequence=sequence,
        event_type=event_type,
        aggregate_version=int(ticket.version or 1),
        actor_type=actor_type,
        actor_id=str(actor_id) if actor_id else None,
        actor_display_name=actor_display_name,
        reason=reason,
        metadata_json=metadata or {},
        correlation_id=correlation_id,
        occurred_at=_now(),
    )
    db.add(event)

    if outbound_data is not None:
        _enqueue(
            db, ticket,
            event_type=event_type,
            sequence=sequence,
            data=outbound_data,
            correlation_id=correlation_id,
            application=application,
            source_tenant=source_tenant,
        )
    db.flush()
    return event


def _enqueue(
    db: Session,
    ticket: Ticket,
    *,
    event_type: str,
    sequence: int,
    data: dict,
    correlation_id: Optional[str],
    application: Optional[SupportApplication],
    source_tenant: Optional[SupportSourceTenant],
) -> Optional[TicketOutboxEvent]:
    """Canonical mutasyonla AYNI transaction'da outbox satiri.

    Zarf (envelope) BURADA olusturulur ve olduğu gibi saklanir:
    dispatcher yeniden uretmez, yalnizca imzalar ve gonderir. Boylece
    imzalanan baytlar ile audit'te gorunen icerik AYNIDIR.
    """
    app = application or db.get(SupportApplication, ticket.application_id)
    src = source_tenant or db.get(
        SupportSourceTenant, ticket.source_tenant_row_id
    )

    # KAYITLI CALLBACK YOKSA KUYRUGA GIRMEZ.
    # Iki gercek durum: (a) Hermes'in KENDI portali — canonical veriyi
    # zaten dogrudan okur, webhook'a ihtiyaci yoktur; (b) henuz callback
    # yapilandirilmamis yeni bir uygulama. Ikisinde de satir yazmak,
    # 24 saat sonra dead-letter'a dusecek sahte bir kuyruk uretirdi ve
    # "dead-letter 0" release kapisini kalici olarak kirmis olurdu.
    # Gecmis olaylar, callback sonradan tanimlandiginda consumer'in
    # reconciliation/snapshot cagrisiyla kapanir (06 §4).
    if app is None or not (app.callback_url or "").strip():
        return None

    event_id = uuid.uuid4()
    envelope = {
        "event_id": str(event_id),
        "event_type": event_type,
        "occurred_at": _iso(_now()),
        "application_code": app.code if app else None,
        "source_tenant_id": src.source_tenant_id if src else None,
        "source_ticket_id": ticket.source_ticket_id,
        "ticket_id": str(ticket.id),
        "ticket_number": format_ticket_number(ticket.number),
        "aggregate_version": int(ticket.version or 1),
        "sequence": sequence,
        "data": data,
    }
    row = TicketOutboxEvent(
        event_id=event_id,
        ticket_id=ticket.id,
        application_id=ticket.application_id,
        event_type=event_type,
        sequence=sequence,
        aggregate_version=int(ticket.version or 1),
        payload_json=envelope,
        correlation_id=correlation_id,
        status="pending",
        attempts=0,
        next_attempt_at=_now(),
    )
    db.add(row)
    return row
