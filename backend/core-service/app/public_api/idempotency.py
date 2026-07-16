# =============================================================================
# HERMES Public API - Idempotency (Stage 3C)
# =============================================================================
# `Idempotency-Key` header'i tum public POST endpoint'lerinde OPSIYONELDIR.
# Semantik (onayli):
#   - ayni key + ayni kanonik govde  → saklanan yanit + Idempotency-Replayed: true
#   - ayni key + FARKLI govde        → 409 conflict
#   - islenmekte olan ayni key       → 409 conflict (yarisan istek)
#   - 24 saat TTL: suresi dolan anahtar YENIDEN kullanilabilir (dokumante)
#
# Es-zamanlilik garantisi REZERVASYON deseniyle saglanir: is mantigi
# calismadan ONCE (client_id, key) satiri insert edilir (UNIQUE). Yarisan
# ikinci istek insert'te takilir → ayni is kaydi iki kez OLUSAMAZ. Is
# mantigi basarisiz olursa rezervasyon silinir (anahtar tekrar denenebilir).
#
# Yanit anligi yalnizca public sema govdesidir — Authorization/cookie/
# token/hash/stack asla girmez (kaynak: public serializer ciktisi).
# =============================================================================

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.api_client import ApiIdempotencyKey
from .errors import PublicAPIError

IDEMPOTENCY_HEADER = "Idempotency-Key"
TTL_HOURS = 24
_KEY_RE = re.compile(r"^[A-Za-z0-9_\-\.]{8,128}$")


def canonical_hash(client_id, method: str, path: str, payload: dict) -> str:
    """Deterministik istek ozeti: client kimligi + method + normalize route
    (path parametreleri dahil) + sirali-anahtar kanonik JSON. Query
    parametresi tasiyan POST'umuz yok; eklenirse normalize edilerek buraya
    girer."""
    body = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"),
                      default=str)
    return hashlib.sha256(
        f"{client_id}\n{method}\n{path}\n{body}".encode("utf-8")
    ).hexdigest()


def validate_idempotency_key(key: Optional[str]) -> Optional[str]:
    """Header degerini dogrular; None → idempotency korumasi yok (v1'de
    header OPSIYONEL — dokumante: anahtarsiz retry'lar korunmaz). Bicimsiz
    anahtar 400 invalid_request."""
    if key is None:
        return None
    key = key.strip()
    if not _KEY_RE.match(key):
        raise PublicAPIError(
            "invalid_request",
            "Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-.].",
        )
    return key


class IdempotencyGuard:
    """Write endpoint akisi:

        guard = begin_idempotency(db, ctx.client.id, key, req_hash)
        if guard.replay is not None: return guard.replay
        try:    body = <is mantigi>
        except: guard.release(); raise
        guard.commit(status_code, body)
    """

    def __init__(self, db: Session, row: Optional[ApiIdempotencyKey],
                 replay: Optional[JSONResponse]):
        self._db = db
        self._row = row
        self.replay = replay

    def release(self) -> None:
        """Is mantigi basarisiz → rezervasyonu geri ver (best-effort)."""
        if self._row is None:
            return
        try:
            self._db.delete(self._row)
            self._db.commit()
        except Exception:  # noqa: BLE001
            self._db.rollback()

    def commit(self, status_code: int, body: dict) -> None:
        if self._row is None:
            return
        try:
            self._row.response_status = status_code
            self._row.response_body = body
            self._db.commit()
        except Exception:  # noqa: BLE001
            self._db.rollback()


def begin_idempotency(
    db: Session, client_id, key: Optional[str], request_hash: str
) -> IdempotencyGuard:
    if key is None:
        return IdempotencyGuard(db, None, None)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=TTL_HOURS)

    def _existing():
        return (
            db.query(ApiIdempotencyKey)
            .filter(
                ApiIdempotencyKey.client_id == client_id,
                ApiIdempotencyKey.key == key,
            )
            .first()
        )

    row = _existing()
    if row is not None:
        created = row.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created is not None and created < cutoff:
            # TTL doldu → anahtar yeniden kullanilabilir.
            db.delete(row)
            db.commit()
            row = None

    if row is None:
        reservation = ApiIdempotencyKey(
            client_id=client_id, key=key, request_hash=request_hash
        )
        db.add(reservation)
        try:
            db.commit()
            db.refresh(reservation)
            return IdempotencyGuard(db, reservation, None)
        except IntegrityError:
            db.rollback()
            row = _existing()  # yarisi kaybettik; mevcut satiri degerlendir
            if row is None:  # cok dar bir yaris penceresi — conflict say
                raise PublicAPIError(
                    "conflict",
                    "A request with this Idempotency-Key is being processed.",
                )

    if row.request_hash != request_hash:
        raise PublicAPIError(
            "conflict",
            "This Idempotency-Key was already used with a different payload.",
        )
    if row.response_status is None:
        raise PublicAPIError(
            "conflict",
            "A request with this Idempotency-Key is still being processed.",
        )
    replay = JSONResponse(
        status_code=row.response_status,
        content=row.response_body,
        headers={"Idempotency-Replayed": "true"},
    )
    return IdempotencyGuard(db, row, replay)
