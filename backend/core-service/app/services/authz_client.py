# =============================================================================
# HERMES core - S2S RBAC izin istemcisi (R2)
# =============================================================================
# auth-service /internal/authz/resolve cagrilari. directory_client ile
# ayni kurallar:
#   - Credential: settings.HERMES_S2S_TOKEN_CURRENT; yalnizca bearer;
#     ASLA loglanmaz.
#   - Adres turetimi auth_upstream.auth_service_base_url() — TEK kaynak
#     (2026-07-17 canli URL bug'inin dersi; kopya normalizasyon YASAK).
#   - Cache: pozitif 60 sn. Bayat izin UYDURULMAZ; TTL dolunca yeniden
#     sorulur. Basarisizlik → AuthzUnavailable (fail-closed; cagiran
#     karar noktasi guard ise 503, gorunurluk filtresi ise izinsiz-gibi
#     davranir — asla fail-open).
#   - JWT claim'i (is_admin) fallback DEGILDIR: cozum yoksa yetki yok.
# =============================================================================

import logging
import time
from typing import Callable, Dict, Optional, Tuple

import httpx

from ..config import get_settings
from .auth_upstream import auth_service_base_url

logger = logging.getLogger("hermes.authz")

POSITIVE_TTL_SECONDS = 60.0
_TIMEOUT = 5.0

_client: Optional[httpx.Client] = None
_client_factory: Callable[[], httpx.Client] = lambda: httpx.Client(
    timeout=_TIMEOUT
)

# user_id(str) -> (expires_monotonic, frozenset(permissions))
_cache: Dict[str, Tuple[float, frozenset]] = {}
_CACHE_MAX = 5000


class AuthzUnavailable(Exception):
    """auth-service izin cozumune ulasilamiyor / yapilandirilmamis."""


def set_client_factory(factory: Callable[[], httpx.Client]) -> None:
    """YALNIZCA testler icin."""
    global _client, _client_factory
    _client_factory = factory
    _client = None


def clear_cache() -> None:
    _cache.clear()


def _get_client() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = _client_factory()
    return _client


def effective_permissions(user_id: str) -> frozenset:
    """Kullanicinin efektif RBAC izinleri (S2S, 60 sn cache)."""
    uid = str(user_id)
    now = time.monotonic()
    hit = _cache.get(uid)
    if hit and hit[0] > now:
        return hit[1]

    settings = get_settings()
    token = settings.HERMES_S2S_TOKEN_CURRENT
    if not token:
        raise AuthzUnavailable("S2S credential not configured")

    try:
        resp = _get_client().post(
            f"{auth_service_base_url()}/internal/authz/resolve",
            json={"user_ids": [uid]},
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception as exc:  # noqa: BLE001 — fail closed
        logger.warning("authz resolve transport error class=%s",
                       type(exc).__name__)
        raise AuthzUnavailable("transport") from exc
    if resp.status_code != 200:
        logger.warning("authz resolve status=%s", resp.status_code)
        raise AuthzUnavailable(f"status {resp.status_code}")

    perms: frozenset = frozenset()
    for u in resp.json().get("users") or []:
        if str(u.get("id")) == uid:
            perms = frozenset(u.get("permissions") or [])

    if len(_cache) >= _CACHE_MAX:
        _cache.clear()  # basit sinir — dogruluk auth'ta
    _cache[uid] = (now + POSITIVE_TTL_SECONDS, perms)
    return perms
