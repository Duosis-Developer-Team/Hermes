# =============================================================================
# HERMES core — Ticket komutlari icin idempotency (rezervasyon deseni)
# =============================================================================
# 06 §1: `(owner, key)` benzersiz; ayni key + AYNI govde saklanan yaniti
# doner, FARKLI govde `idempotency_conflict` uretir.
#
# REZERVASYON deseni kritik: satir, is mantigi CALISMADAN once yazilir.
# Yarisan ikinci istek unique kisitina takilir ve ya replay alir ya
# "halen isleniyor" doner — ayni kaynak ticket'in IKI canonical kayda
# donusmesi yapisal olarak imkansizlasir. (Ikinci savunma:
# `uq_tickets_source_identity`.)
#
# Public API'nin `api_idempotency_keys` mekanizmasi ile ayni ILKE, ayri
# TABLO: sahiplik uzayi farkli (integration client / tenant user) ve
# ticket sozlesmesi kaydin `ticket_id`sini de tasimayi ister.
# =============================================================================

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.ticketing import TicketIdempotencyRecord

TTL_HOURS = 24
_KEY_RE = re.compile(r"^[A-Za-z0-9_\-\.]{8,128}$")

OWNER_INTEGRATION = "integration_client"
OWNER_TENANT_USER = "tenant_user"


class IdempotencyError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _now():
    return datetime.now(timezone.utc)


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def validate_key(key: Optional[str]) -> Optional[str]:
    if key is None:
        return None
    key = key.strip()
    if not _KEY_RE.match(key):
        raise IdempotencyError(
            "invalid_request",
            "Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-.].",
        )
    return key


def request_hash(owner_id: str, route: str, payload) -> str:
    body = json.dumps(
        payload or {}, sort_keys=True, separators=(",", ":"), default=str
    )
    return hashlib.sha256(
        f"{owner_id}\n{route}\n{body}".encode("utf-8")
    ).hexdigest()


class Guard:
    """Kullanim:

        guard = begin(db, ...)
        if guard.replay: return guard.replay_response()
        try:  body = <is mantigi>
        except: guard.release(); raise
        guard.commit(201, body, ticket_id)
    """

    def __init__(self, db: Session, row, replay: Optional[dict]):
        self._db = db
        self._row = row
        self.replay = replay

    @property
    def replay_status(self) -> int:
        return int(self._row.response_status or 200) if self._row else 200

    @property
    def ticket_id(self):
        return self._row.ticket_id if self._row else None

    def release(self) -> None:
        """Is mantigi patlarsa rezervasyonu geri ver.

        `flush` degil `delete + flush`: cagiran transaction'i geri
        alacagi icin satir zaten kaybolur; burada acikca silmek,
        transaction'i geri ALMAYAN yollarda da anahtarin yeniden
        denenebilir kalmasini saglar.
        """
        if self._row is None:
            return
        try:
            self._db.delete(self._row)
            self._db.flush()
        except Exception:  # noqa: BLE001
            pass

    def commit(self, status_code: int, body: dict, ticket_id=None) -> None:
        if self._row is None:
            return
        self._row.response_status = status_code
        self._row.response_body = body
        if ticket_id is not None:
            self._row.ticket_id = ticket_id
        self._db.flush()


def begin(
    db: Session,
    *,
    owner_type: str,
    owner_id: str,
    key: Optional[str],
    route: str,
    payload,
) -> Guard:
    if key is None:
        return Guard(db, None, None)

    digest = request_hash(str(owner_id), route, payload)
    cutoff = _now() - timedelta(hours=TTL_HOURS)

    def _existing():
        return (
            db.query(TicketIdempotencyRecord)
            .filter(
                TicketIdempotencyRecord.owner_type == owner_type,
                TicketIdempotencyRecord.owner_id == str(owner_id),
                TicketIdempotencyRecord.key == key,
            )
            .first()
        )

    row = _existing()
    if row is not None and _aware(row.created_at) < cutoff:
        # TTL doldu → anahtar yeniden kullanilabilir (dokumante).
        db.delete(row)
        db.flush()
        row = None

    if row is None:
        reservation = TicketIdempotencyRecord(
            owner_type=owner_type,
            owner_id=str(owner_id),
            key=key,
            route=route[:160],
            request_hash=digest,
            expires_at=_now() + timedelta(hours=TTL_HOURS),
        )
        # SAVEPOINT sart: cakisma halinde `db.rollback()` cagirmak, DIS
        # transaction'i da geri alir ve onunla birlikte
        # `SET LOCAL app.tenant_id` DUSER — o noktadan sonra RLS altinda
        # hicbir satir gorunmezdi. Ic nokta yalnizca bu INSERT'i geri
        # alir.
        savepoint = db.begin_nested()
        db.add(reservation)
        try:
            db.flush()
            savepoint.commit()
            return Guard(db, reservation, None)
        except IntegrityError:
            savepoint.rollback()
            row = _existing()
            if row is None:  # cok dar yaris penceresi
                raise IdempotencyError(
                    "idempotency_request_in_progress",
                    "A request with this Idempotency-Key is still being "
                    "processed; it is safe to retry.",
                )

    if row.request_hash != digest:
        raise IdempotencyError(
            "idempotency_conflict",
            "This Idempotency-Key was already used with a different "
            "payload.",
        )
    if row.response_status is None:
        raise IdempotencyError(
            "idempotency_request_in_progress",
            "A request with this Idempotency-Key is still being "
            "processed; it is safe to retry.",
        )
    return Guard(db, row, row.response_body)


def purge_expired(db: Session, *, limit: int = 1000) -> int:
    """Suresi dolmus anahtarlari temizler.

    Ticket VERISINE dokunmaz; yalnizca bu operasyonel tabloyu budar.
    """
    rows = (
        db.query(TicketIdempotencyRecord)
        .filter(TicketIdempotencyRecord.expires_at < _now())
        .limit(limit)
        .all()
    )
    for row in rows:
        db.delete(row)
    db.flush()
    return len(rows)


def replay_tuple(guard: Guard) -> Tuple[int, dict]:
    return guard.replay_status, guard.replay or {}
