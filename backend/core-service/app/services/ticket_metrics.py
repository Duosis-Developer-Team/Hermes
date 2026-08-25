# =============================================================================
# HERMES core — Ticket modulu metrikleri
# =============================================================================
# Drake sozlesmesi (HERMES_METRICS.md) HTTP metriklerini dondurur:
# `http_server_requests_total` ve `http_server_request_duration_seconds`
# adlari/etiketleri DEGISMEZ. Bu modul onlarin YANINA, ticket'a ozel is
# metrikleri ekler (06 §6) — ayni ozel registry'ye kaydolur, boylece
# /metrics ciktisi tek yerden gelir.
#
# ETIKET KARDINALITESI KURALI (06 §6): tenant ID, ticket ID, hata metni
# metrik ETIKETI DEGILDIR. Buradaki tum etiketler KAPALI kumelerden
# gelir (enum'lar + application kodu). `application` teknik olarak acik
# uclu gorunur ama pratikte urun sayisi kadardir (bugun 2) ve onboarding
# bilincli bir karardir.
# =============================================================================

from __future__ import annotations

import logging

from prometheus_client import Counter, Gauge, Histogram

from shared.metrics import REGISTRY

logger = logging.getLogger("hermes.ticket.metrics")


TICKET_CREATED = Counter(
    "ticket_created_total",
    "Support tickets created, by source application and category.",
    ["application", "category"],
    registry=REGISTRY,
)

TICKET_TRANSITION = Counter(
    "ticket_transition_total",
    "Support ticket status transitions.",
    ["from_status", "to_status"],
    registry=REGISTRY,
)

TICKET_MESSAGE = Counter(
    "ticket_message_total",
    "Support ticket messages by visibility (never message bodies).",
    ["visibility"],
    registry=REGISTRY,
)

DELIVERY_ATTEMPT = Counter(
    "ticket_delivery_attempt_total",
    "Outbound/inbound ticket event delivery attempts.",
    ["direction", "result"],
    registry=REGISTRY,
)

WEBHOOK_SIGNATURE_FAILURE = Counter(
    "ticket_webhook_signature_failure_total",
    "Rejected webhook signature verifications, by application.",
    ["application"],
    registry=REGISTRY,
)

ATTACHMENT_SCAN = Counter(
    "ticket_attachment_scan_total",
    "Attachment scan outcomes by result and detected mime type.",
    ["result", "mime"],
    registry=REGISTRY,
)

AUTHZ_DENIED = Counter(
    "ticket_authz_denied_total",
    "Denied ticket authorization checks, by surface and reason.",
    ["surface", "reason"],
    registry=REGISTRY,
)

CREATE_DURATION = Histogram(
    "ticket_create_duration_seconds",
    "Server-side duration of canonical ticket creation.",
    registry=REGISTRY,
)

FIRST_RESPONSE_DURATION = Histogram(
    "ticket_first_response_duration_seconds",
    "Time from ticket creation to the first public agent reply.",
    buckets=(60, 300, 900, 3600, 4 * 3600, 8 * 3600, 24 * 3600,
             3 * 24 * 3600),
    registry=REGISTRY,
)

RESOLUTION_DURATION = Histogram(
    "ticket_resolution_duration_seconds",
    "Time from ticket creation to resolution.",
    buckets=(3600, 4 * 3600, 8 * 3600, 24 * 3600, 3 * 24 * 3600,
             7 * 24 * 3600, 14 * 24 * 3600, 30 * 24 * 3600),
    registry=REGISTRY,
)

DELIVERY_LATENCY = Histogram(
    "ticket_delivery_latency_seconds",
    "Time from outbox enqueue to successful delivery.",
    buckets=(1, 5, 15, 60, 300, 1800, 7200, 86400),
    registry=REGISTRY,
)

ATTACHMENT_SCAN_DURATION = Histogram(
    "ticket_attachment_scan_duration_seconds",
    "Malware scan duration per attachment.",
    registry=REGISTRY,
)

OUTBOX_PENDING = Gauge(
    "ticket_outbox_pending",
    "Outbox events waiting to be delivered.",
    registry=REGISTRY,
)

OUTBOX_DEAD = Gauge(
    "ticket_outbox_dead",
    "Outbox events in the dead-letter state.",
    registry=REGISTRY,
)


def _safe(fn):
    """Olcum HICBIR ZAMAN istegi/isi bozmaz (shared/metrics ile ayni
    ilke). Metrik yazamamak bir teshis kaybidir, bir arıza degil."""
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:  # noqa: BLE001
            logger.debug("ticket metric observation failed", exc_info=True)
    return wrapper


@_safe
def ticket_created(application: str, category: str) -> None:
    TICKET_CREATED.labels(application=application, category=category).inc()


@_safe
def transition(from_status: str, to_status: str) -> None:
    TICKET_TRANSITION.labels(
        from_status=from_status, to_status=to_status
    ).inc()


@_safe
def message_added(visibility: str) -> None:
    TICKET_MESSAGE.labels(visibility=visibility).inc()


@_safe
def delivery_attempt(direction: str, result: str) -> None:
    DELIVERY_ATTEMPT.labels(direction=direction, result=result).inc()


@_safe
def signature_failure(application: str) -> None:
    WEBHOOK_SIGNATURE_FAILURE.labels(application=application).inc()


@_safe
def attachment_scanned(result: str, mime: str) -> None:
    ATTACHMENT_SCAN.labels(result=result, mime=mime or "unknown").inc()


@_safe
def authz_denied(surface: str, reason: str) -> None:
    AUTHZ_DENIED.labels(surface=surface, reason=reason).inc()


@_safe
def observe_create_duration(seconds: float) -> None:
    CREATE_DURATION.observe(seconds)


@_safe
def observe_first_response(seconds: float) -> None:
    FIRST_RESPONSE_DURATION.observe(seconds)


@_safe
def observe_resolution(seconds: float) -> None:
    RESOLUTION_DURATION.observe(seconds)


@_safe
def observe_delivery_latency(seconds: float) -> None:
    DELIVERY_LATENCY.observe(seconds)


@_safe
def observe_scan_duration(seconds: float) -> None:
    ATTACHMENT_SCAN_DURATION.observe(seconds)


@_safe
def set_outbox_gauges(pending: int, dead: int) -> None:
    OUTBOX_PENDING.set(pending)
    OUTBOX_DEAD.set(dead)
