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


# Gorunurluk cache'i:
#   sha256(token) -> (expiry, scopes, client_type, workspace_id)
#
# Anahtar token hash'idir; token TEK bir tenant'a bagli oldugu icin bu
# yeterlidir. Yine de cache'lenen deger tenant'i DA saklar ve her
# kullanimda API'nin bildirdigiyle karsilastirilir (WS6 / pack 09 §2):
# boylece bir gun anahtar uzayi degisir veya bir hash cakisir olsa bile,
# yanlis tenant'a gorunurluk servis etmek YAPISAL olarak yakalanir.
#
# Kucuk tutulur; TTL kisadir; ASLA yetki karari icin kullanilmaz —
# yetkinin tek merci Public API'dir.
_visibility_cache: dict = {}
_CACHE_MAX = 256


class TenantMismatchError(AuthError):
    """Cache'lenen tenant ile API'nin bildirdigi tenant uyusmuyor."""


async def resolve_visibility(token: str) -> dict:
    """GET /v1/me ile scope + client_type + workspace cozer.

    Hata → AuthError (API'nin kendi mesajiyla, sanitize).
    """
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    hit = _visibility_cache.get(key)
    if hit and hit[0] > now:
        return {
            "scopes": hit[1],
            "client_type": hit[2],
            "workspace_id": hit[3],
        }

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
    workspace_id = (body.get("workspace") or {}).get("id")

    # Ayni token icin BASKA bir tenant bildirildiyse cache'i temizle ve
    # istegi reddet. Bu olmamasi gereken bir durumdur; sessizce devam
    # etmek, gorunurlugun yanlis organizasyona servis edilmesi demekti.
    previous = _visibility_cache.get(key)
    if previous and previous[3] and workspace_id and previous[3] != workspace_id:
        _visibility_cache.pop(key, None)
        raise TenantMismatchError(
            "Hermes token problem: workspace mismatch for this token."
        )

    if len(_visibility_cache) >= _CACHE_MAX:
        _visibility_cache.clear()  # basit sinir — dogruluk API'de
    _visibility_cache[key] = (
        now + config.SCOPE_CACHE_TTL_SECONDS,
        scopes,
        client_type,
        workspace_id,
    )
    return {
        "scopes": scopes,
        "client_type": client_type,
        "workspace_id": workspace_id,
    }


def clear_visibility_cache() -> None:
    """Test yardimi + operasyonel guvenlik supabi."""
    _visibility_cache.clear()
