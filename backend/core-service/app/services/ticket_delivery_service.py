# =============================================================================
# HERMES core — Giden event teslimati (imzali webhook + retry + dead-letter)
# =============================================================================
# 06 §1-§2: "at least once delivery + idempotent consumer". Exactly-once
# IDDIA EDILMEZ; is sonucu duplicate olmaz cunku consumer `event_id`
# uzerinden inbox tutar.
#
# Guvenlik (05 §7):
#   - callback URL YALNIZCA application kaydindan gelir; payload URL
#     belirleyemez;
#   - HTTPS zorunlu (yerel gelistirme icin acik bir bayrak);
#   - SSRF kapisi: private/loopback/link-local/metadata adresleri
#     reddedilir;
#   - HMAC-SHA256, kanonik `<timestamp>.<raw_body>`, kucuk harf hex;
#   - sir ORTAM DEGISKENINDEN gelir, DB'de/repo'da DEGIL; rotasyon icin
#     iki slot (CURRENT/NEXT) desteklenir ve imza CURRENT ile atilir.
#
# Kilitleme: `FOR UPDATE SKIP LOCKED` — iki dispatcher ayni olayi
# ISLEYEMEZ. Bu, "gunde iki kez ayni bildirim" sinifindan hatalarin
# yapisal onlemidir.
# =============================================================================

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import os
import random
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import (
    SupportApplication,
    TicketDeliveryAttempt,
    TicketOutboxEvent,
)
from ..ticket_contract import (
    DEAD_LETTER_AFTER_SECONDS,
    HEADER_CORRELATION_ID,
    HEADER_EVENT_ID,
    HEADER_KEY_ID,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    MAX_DELIVERY_ATTEMPTS,
    is_retryable_status,
    next_backoff_seconds,
)
from . import ticket_metrics

logger = logging.getLogger("hermes.ticket.delivery")


def _now():
    return datetime.now(timezone.utc)


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class DeliveryConfigError(RuntimeError):
    """Teslimat yapilandirmasi eksik/gecersiz."""


# =============================================================================
# Imza
# =============================================================================

def secret_env_names(application_code: str) -> Tuple[str, str]:
    prefix = get_settings().TICKET_WEBHOOK_SECRET_ENV_PREFIX
    base = f"{prefix}{application_code.upper().replace('-', '_')}"
    return base, f"{base}_NEXT"


def webhook_secret(application_code: str) -> Optional[str]:
    """Aktif imzalama sirri. Yoksa `None` (teslimat yapilamaz).

    Rotasyon: `_NEXT` slotu, consumer'in yeni sirri kabul etmeye
    baslamasi icin ONCEDEN dagitilir; imza yine CURRENT ile atilir.
    Slotlar takas edildiginde kesinti olmaz.
    """
    current, _ = secret_env_names(application_code)
    return (os.environ.get(current) or "").strip() or None


def sign_payload(secret: str, timestamp: str, body: str) -> str:
    """`<timestamp>.<raw_body>` uzerinde HMAC-SHA256, KUCUK HARF HEX.

    Kanonik baytlar sozlesmede sabittir: consumer ayni diziyi kurar.
    Govde, GONDERILEN ham metinle birebir ayni olmalidir — bu yuzden
    imzalanan string ile HTTP govdesi TEK yerden uretilir.
    """
    message = f"{timestamp}.{body}".encode("utf-8")
    return hmac.new(
        secret.encode("utf-8"), message, hashlib.sha256
    ).hexdigest()


# =============================================================================
# Callback URL guvenligi (SSRF)
# =============================================================================

def validate_callback_url(url: str) -> None:
    settings = get_settings()
    if not url:
        raise DeliveryConfigError("callback_url_missing")
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise DeliveryConfigError("callback_scheme_invalid")
    if parsed.scheme == "http" and not \
            settings.TICKET_WEBHOOK_ALLOW_INSECURE_HTTP:
        raise DeliveryConfigError("callback_requires_https")
    host = parsed.hostname
    if not host:
        raise DeliveryConfigError("callback_host_missing")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise DeliveryConfigError("callback_host_unresolvable")

    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        # Cloud metadata (169.254.169.254) link-local araligindadir ve
        # `is_link_local` ile zaten yakalanir.
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            if settings.TICKET_WEBHOOK_ALLOW_INSECURE_HTTP:
                # Yerel gelistirme: acik bayrakla izin verilir.
                continue
            raise DeliveryConfigError("callback_target_not_public")


# =============================================================================
# Kuyruk isleme
# =============================================================================

def claim_due(
    db: Session, *, limit: int, worker_id: str
) -> List[TicketOutboxEvent]:
    """Zamani gelmis olaylari KILITLEYEREK alir.

    `FOR UPDATE SKIP LOCKED`, es zamanli dispatcher'larin ayni satiri
    islemesini engeller; kilidi alamayan digerine gecer, beklemez.
    """
    rows = (
        db.query(TicketOutboxEvent)
        .filter(
            TicketOutboxEvent.status == "pending",
            TicketOutboxEvent.next_attempt_at <= _now(),
        )
        .order_by(TicketOutboxEvent.next_attempt_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
        .all()
    )
    now = _now()
    for row in rows:
        row.status = "in_flight"
        row.locked_at = now
        row.locked_by = worker_id[:64]
    db.flush()
    return rows


def _record_attempt(
    db: Session,
    row: TicketOutboxEvent,
    *,
    result: str,
    http_status: Optional[int],
    error_code: Optional[str],
    duration_ms: int,
    triggered_by: str,
    actor_id: Optional[str],
) -> None:
    db.add(TicketDeliveryAttempt(
        outbox_event_id=row.id,
        attempt_number=int(row.attempts or 0),
        result=result,
        http_status=http_status,
        error_code=error_code,
        duration_ms=duration_ms,
        triggered_by=triggered_by,
        actor_id=str(actor_id) if actor_id else None,
    ))
    ticket_metrics.delivery_attempt("outbound", result)


def _fail(
    db: Session,
    row: TicketOutboxEvent,
    *,
    error_code: str,
    http_status: Optional[int],
    duration_ms: int,
    retryable: bool,
    triggered_by: str,
    actor_id: Optional[str],
) -> None:
    """Basarisiz denemeyi kaydeder ve SONRAKI denemeyi zamanlar.

    Dead-letter iki kosuldan biriyle: deneme tavani veya 24 saat
    (06 §2). Retryable OLMAYAN bir hata (orn. 400/403) beklemeden
    dead'e duser — 24 saat boyunca ayni 400'u tekrarlamak, gercek
    sorunu gizleyen gurultuden baska bir sey degildir.
    """
    row.attempts = int(row.attempts or 0) + 1
    row.last_error_code = error_code
    row.last_status_code = http_status
    row.locked_at = None
    row.locked_by = None

    created = _aware(row.created_at) or _now()
    aged_out = (_now() - created).total_seconds() >= DEAD_LETTER_AFTER_SECONDS
    exhausted = row.attempts >= MAX_DELIVERY_ATTEMPTS

    if not retryable or aged_out or exhausted:
        row.status = "dead"
        row.dead_at = _now()
        result = "dead"
    else:
        delay = next_backoff_seconds(row.attempts)
        # Jitter: ayni anda olen bir consumer geri geldiginde tum
        # kuyrugun ayni saniyede vurmasini onler.
        jitter = random.uniform(0, delay * 0.2)
        row.status = "pending"
        row.next_attempt_at = _now() + timedelta(seconds=delay + jitter)
        result = "retry"

    _record_attempt(
        db, row, result=result, http_status=http_status,
        error_code=error_code, duration_ms=duration_ms,
        triggered_by=triggered_by, actor_id=actor_id,
    )


def deliver_one(
    db: Session,
    row: TicketOutboxEvent,
    *,
    application: Optional[SupportApplication] = None,
    triggered_by: str = "scheduler",
    actor_id: Optional[str] = None,
    client: Optional[httpx.Client] = None,
) -> str:
    """Tek olayi gonderir; sonucu ('delivered'|'retry'|'dead') doner."""
    settings = get_settings()
    app = application or db.get(SupportApplication, row.application_id)
    started = time.perf_counter()

    if app is None:
        _fail(db, row, error_code="application_missing", http_status=None,
              duration_ms=0, retryable=False, triggered_by=triggered_by,
              actor_id=actor_id)
        return "dead"

    secret = webhook_secret(app.code)
    if not secret:
        # Sir yoksa GONDERMEYIZ ve imzasiz gondermeyi ASLA denemeyiz.
        # Retryable: operator sirri tanimladiginda kuyruk kendiliginden
        # akar.
        _fail(db, row, error_code="signing_secret_missing",
              http_status=None, duration_ms=0, retryable=True,
              triggered_by=triggered_by, actor_id=actor_id)
        return "retry"

    try:
        validate_callback_url(app.callback_url or "")
    except DeliveryConfigError as exc:
        _fail(db, row, error_code=str(exc), http_status=None,
              duration_ms=0, retryable=False, triggered_by=triggered_by,
              actor_id=actor_id)
        return "dead"

    # Imzalanan baytlar ile gonderilen govde TEK kaynaktan uretilir.
    body = json.dumps(
        row.payload_json, separators=(",", ":"), sort_keys=True,
        default=str,
    )
    timestamp = str(int(_now().timestamp()))
    signature = sign_payload(secret, timestamp, body)
    headers = {
        "content-type": "application/json",
        HEADER_EVENT_ID: str(row.event_id),
        HEADER_TIMESTAMP: timestamp,
        HEADER_SIGNATURE: signature,
        HEADER_KEY_ID: app.webhook_key_id or "v1",
        HEADER_CORRELATION_ID: row.correlation_id or str(uuid.uuid4()),
        "user-agent": "Hermes-Support/1.0",
    }

    owns_client = client is None
    http = client or httpx.Client(
        timeout=float(settings.TICKET_WEBHOOK_TIMEOUT_SECONDS),
        follow_redirects=False,
    )
    try:
        response = http.post(
            app.callback_url, content=body.encode("utf-8"),
            headers=headers,
        )
        status_code = response.status_code
    except httpx.HTTPError as exc:
        duration_ms = int((time.perf_counter() - started) * 1000)
        _fail(db, row, error_code=f"transport_{type(exc).__name__}",
              http_status=None, duration_ms=duration_ms, retryable=True,
              triggered_by=triggered_by, actor_id=actor_id)
        return "retry"
    finally:
        if owns_client:
            http.close()

    duration_ms = int((time.perf_counter() - started) * 1000)

    if 200 <= status_code < 300:
        row.status = "delivered"
        row.sent_at = _now()
        row.attempts = int(row.attempts or 0) + 1
        row.locked_at = None
        row.locked_by = None
        row.last_error_code = None
        row.last_status_code = status_code
        _record_attempt(
            db, row, result="delivered", http_status=status_code,
            error_code=None, duration_ms=duration_ms,
            triggered_by=triggered_by, actor_id=actor_id,
        )
        created = _aware(row.created_at)
        if created:
            ticket_metrics.observe_delivery_latency(
                (_now() - created).total_seconds()
            )
        return "delivered"

    if status_code in (401, 403):
        ticket_metrics.signature_failure(app.code)

    _fail(
        db, row, error_code=f"http_{status_code}", http_status=status_code,
        duration_ms=duration_ms, retryable=is_retryable_status(status_code),
        triggered_by=triggered_by, actor_id=actor_id,
    )
    return "dead" if row.status == "dead" else "retry"


def dispatch_pending(db: Session, *, limit: Optional[int] = None) -> dict:
    """Bir tur: kilitle → gonder → sonucu yaz.

    Uygulama nesneleri tur basina BIR kez okunur (N+1 onlemi) ve tek bir
    HTTP baglanti havuzu paylasilir.
    """
    settings = get_settings()
    batch = int(limit or settings.TICKET_DISPATCH_BATCH_SIZE)
    worker_id = f"{socket.gethostname()[:40]}:{os.getpid()}"

    rows = claim_due(db, limit=batch, worker_id=worker_id)
    if not rows:
        _publish_gauges(db)
        return {"ok": True, "claimed": 0, "delivered": 0, "retry": 0,
                "dead": 0}

    app_ids = {row.application_id for row in rows}
    apps = {
        app.id: app
        for app in db.query(SupportApplication)
        .filter(SupportApplication.id.in_(app_ids))
        .all()
    }

    summary = {"delivered": 0, "retry": 0, "dead": 0}
    with httpx.Client(
        timeout=float(settings.TICKET_WEBHOOK_TIMEOUT_SECONDS),
        follow_redirects=False,
    ) as client:
        for row in rows:
            result = deliver_one(
                db, row, application=apps.get(row.application_id),
                client=client,
            )
            summary[result] = summary.get(result, 0) + 1
    db.flush()
    _publish_gauges(db)
    return {"ok": True, "claimed": len(rows), **summary}


def reclaim_stuck(db: Session, *, older_than_minutes: int = 15) -> int:
    """Cokmus bir dispatcher'in birakligi `in_flight` satirlari kurtarir.

    Kilit sahibi olen bir surecse satir sonsuza dek `in_flight` kalirdi —
    yani olay sessizce hic gonderilmezdi.
    """
    cutoff = _now() - timedelta(minutes=older_than_minutes)
    result = db.execute(
        text(
            "UPDATE ticket_outbox_events "
            "   SET status = 'pending', locked_at = NULL, "
            "       locked_by = NULL "
            " WHERE status = 'in_flight' AND locked_at < :cutoff"
        ),
        {"cutoff": cutoff},
    )
    return int(result.rowcount or 0)


def replay(
    db: Session, row: TicketOutboxEvent, *, actor
) -> TicketOutboxEvent:
    """Olu bir olayi elle yeniden kuyruklar — AYNI `event_id` ile.

    Ayni kimlikle gondermek onemlidir: consumer'in inbox'i olayi bir kez
    uyguladiysa tekrar uygulamaz (idempotent). Yeni bir kimlik uretmek,
    musteriye ikinci bir bildirim gondermek demekti.
    """
    row.status = "pending"
    row.next_attempt_at = _now()
    row.locked_at = None
    row.locked_by = None
    row.dead_at = None
    db.flush()
    return row


def _publish_gauges(db: Session) -> None:
    try:
        pending = (
            db.query(func.count(TicketOutboxEvent.id))
            .filter(TicketOutboxEvent.status.in_(("pending", "in_flight")))
            .scalar()
        )
        dead = (
            db.query(func.count(TicketOutboxEvent.id))
            .filter(TicketOutboxEvent.status == "dead")
            .scalar()
        )
        ticket_metrics.set_outbox_gauges(int(pending or 0), int(dead or 0))
    except Exception:  # noqa: BLE001 — olcum isi bozmaz
        logger.debug("outbox gauge publish failed", exc_info=True)


def delivery_stats(db: Session) -> dict:
    """Admin teslimat kartlari icin ozet (icerik TASIMAZ)."""
    counts = dict(
        db.query(TicketOutboxEvent.status, func.count(TicketOutboxEvent.id))
        .group_by(TicketOutboxEvent.status)
        .all()
    )
    oldest_pending = (
        db.query(func.min(TicketOutboxEvent.next_attempt_at))
        .filter(TicketOutboxEvent.status == "pending")
        .scalar()
    )
    last_success = (
        db.query(func.max(TicketOutboxEvent.sent_at))
        .filter(TicketOutboxEvent.status == "delivered")
        .scalar()
    )
    return {
        "pending": int(counts.get("pending", 0)),
        "in_flight": int(counts.get("in_flight", 0)),
        "delivered": int(counts.get("delivered", 0)),
        "dead": int(counts.get("dead", 0)),
        "oldest_pending_at": oldest_pending,
        "last_success_at": last_success,
    }
