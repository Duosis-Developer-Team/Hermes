# =============================================================================
# hermes-mcp - kimlik: bearer token gecisi + gorunurluk cozumu
# =============================================================================
# Onayli kurallar (D5-3 amendmanli):
#   - 5A-5C internal beta credential'i: mevcut hms_... bearer header'i.
#   - Token YALNIZCA istek baglaminda (ContextVar) yasar; loglanmaz,
#     saklanmaz, tool ciktisina yansitilmaz.
#   - resolve_visibility SADECE tools/list gorunurlugu icindir; gercek
#     yetkilendirme HER cagrida Public API'de olur. Cache TTL <= 15 sn.
# =============================================================================

import hashlib
import time
from contextvars import ContextVar
from typing import Optional

from . import config, upstream

# Istek basina bearer token (ASGI middleware doldurur).
current_token: ContextVar[Optional[str]] = ContextVar(
    "hermes_mcp_token", default=None
)

# Aktif MCP request id'si (server.call_tool doldurur) — otomatik
# transport-retry Idempotency-Key turetimi icin (5C).
current_request_id: ContextVar[Optional[str]] = ContextVar(
    "hermes_mcp_request_id", default=None
)


class AuthError(Exception):
    """Handshake/gorunurluk kimlik hatasi — MCP protokol hatasina cevrilir."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def token_from_headers(headers) -> Optional[str]:
    auth = headers.get(b"authorization") or headers.get("authorization")
    if auth is None:
        return None
    if isinstance(auth, bytes):
        auth = auth.decode("latin-1")
    if not auth.lower().startswith("bearer "):
        return None
    return auth[7:].strip() or None


def require_token() -> str:
    token = current_token.get()
    if not token:
        raise AuthError(
            "Hermes token problem: missing Authorization: Bearer header. "
            "Configure your MCP client with a Hermes API token."
        )
    return token


# Gorunurluk cache'i: sha256(token) -> (expiry, scopes, client_type).
# Kucuk tutulur; TTL kisadir; ASLA yetki karari icin kullanilmaz.
_visibility_cache: dict = {}
_CACHE_MAX = 256


async def resolve_visibility(token: str) -> dict:
    """GET /v1/me ile scope + client_type cozer (tool listesi filtresi).
    Hata → AuthError (API'nin kendi mesajiyla, sanitize)."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    hit = _visibility_cache.get(key)
    if hit and hit[0] > now:
        return {"scopes": hit[1], "client_type": hit[2]}

    status, body = await upstream.api_request(
        "GET", "me", token=token, tool="__visibility__"
    )
    if status != 200 or not isinstance(body, dict):
        message = "Hermes token problem: token was rejected."
        if isinstance(body, dict) and "error" in body:
            message = (
                f"Hermes token problem: {body['error'].get('message', '')}"
            ).strip()
        raise AuthError(message)

    scopes = frozenset(body.get("scopes") or [])
    client_type = (body.get("client") or {}).get("type", "service")
    if len(_visibility_cache) >= _CACHE_MAX:
        _visibility_cache.clear()  # basit sinir — dogruluk API'de
    _visibility_cache[key] = (
        now + config.SCOPE_CACHE_TTL_SECONDS,
        scopes,
        client_type,
    )
    return {"scopes": scopes, "client_type": client_type}


def clear_visibility_cache() -> None:
    """Test yardimi + operasyonel guvenlik supabi."""
    _visibility_cache.clear()
