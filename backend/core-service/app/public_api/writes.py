# =============================================================================
# HERMES Public API - Write yardimcilari (Stage 3C/3D ortak)
# =============================================================================
# Tum public write endpoint'lerinin paylastigi kurallar:
#   - Write islemleri YALNIZCA user-bound client'lara aciktir. Service
#     client'lar dogru scope'lara sahip olsalar BILE 403 alir (aktor
#     kimligi belirsiz olamaz; on_behalf_of v1'de yok).
#   - Bagli Hermes kullanicisi aktordur; API token'indan ASLA kullanici
#     JWT'si uretilmez/iletilmez — mevcut servis fonksiyonlarina
#     sentezlenmis CurrentUser gecilir.
#   - Tum POST'lar OPSIYONEL Idempotency-Key destekler (anahtarsiz
#     retry'lar korunmaz — dokumante).
# =============================================================================

import json
from fastapi import Header
from fastapi.responses import JSONResponse

from shared.auth import CurrentUser

from .deps import ApiContext
from .errors import PublicAPIError
from .idempotency import (
    begin_idempotency,
    canonical_hash,
    validate_idempotency_key,
)

IDEMPOTENCY_HEADER_PARAM = Header(
    None,
    alias="Idempotency-Key",
    description=(
        "Optional idempotency key (8-128 chars of [A-Za-z0-9_-.]), scoped "
        "to your API client. Replaying the same key with the same payload "
        "within 24h returns the original response with "
        "`Idempotency-Replayed: true`; the same key with a different "
        "payload returns 409 `conflict`; while the original request is "
        "still in flight the same key returns 409 "
        "`idempotency_request_in_progress` and is safe to retry after it "
        "completes. Without the header, retries are NOT protected."
    ),
)


def actor_of(ctx: ApiContext) -> CurrentUser:
    """Bagli Hermes kullanicisini aktor yapar. E-posta alani service
    fonksiyonlarinin sekil geregidir (hicbir is kuralinda kullanilmaz)."""
    if ctx.client.client_type != "user" or ctx.client.bound_user_id is None:
        raise PublicAPIError(
            "resource_access_denied",
            "Write operations require a user-bound API client. Service "
            "clients are read-only in v1.",
        )
    return CurrentUser(
        id=str(ctx.client.bound_user_id),
        email=f"api-client-{ctx.client.id}@hermes.internal",
        is_admin=False,
    )


def dump(model) -> dict:
    return json.loads(model.model_dump_json())


def run_idempotent(db, ctx, key, route, payload, run):
    """POST akisinin ortak sarmali: rezervasyon → is mantigi → anlik.
    `run()` (status_code, body_dict) dondurur."""
    key = validate_idempotency_key(key)
    req_hash = canonical_hash(ctx.client.id, "POST", route, payload)
    guard = begin_idempotency(db, ctx.client.id, key, req_hash)
    if guard.replay is not None:
        return guard.replay
    try:
        status_code, body = run()
    except Exception:
        guard.release()
        raise
    guard.commit(status_code, body)
    return JSONResponse(status_code=status_code, content=body)
