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


def effective_permissions_many(user_ids) -> Dict[str, frozenset]:
    """Batch cozum: tek /internal/authz/resolve cagrisiyla birden fazla
    kullanicinin izinlerini getirir ve cache'i doldurur. Fan-out gibi
    N kullaniciyi arka arkaya soracak yerler icin — N+1 S2S YOK.

    Cache'te taze olanlar istege dahil edilmez. Basarisizlik →
    AuthzUnavailable (fail-closed; cagiran karar noktasi bilir)."""
    now = time.monotonic()
    out: Dict[str, frozenset] = {}
    missing = []
    for uid in dict.fromkeys(str(u) for u in user_ids):
        hit = _cache.get(uid)
        if hit and hit[0] > now:
            out[uid] = hit[1]
        else:
            missing.append(uid)
    if not missing:
        return out

    settings = get_settings()
    token = settings.HERMES_S2S_TOKEN_CURRENT
    if not token:
        raise AuthzUnavailable("S2S credential not configured")

    CHUNK = 500  # auth tarafindaki MAX_RESOLVE_IDS siniri
    for i in range(0, len(missing), CHUNK):
        chunk = missing[i : i + CHUNK]
        try:
            resp = _get_client().post(
                f"{auth_service_base_url()}/internal/authz/resolve",
                json={"user_ids": chunk},
                headers={"Authorization": f"Bearer {token}"},
            )
        except Exception as exc:  # noqa: BLE001 — fail closed
            logger.warning("authz batch resolve transport error class=%s",
                           type(exc).__name__)
            raise AuthzUnavailable("transport") from exc
        if resp.status_code != 200:
            logger.warning("authz batch resolve status=%s", resp.status_code)
            raise AuthzUnavailable(f"status {resp.status_code}")
        got = {
            str(u.get("id")): frozenset(u.get("permissions") or [])
            for u in resp.json().get("users") or []
        }
        for uid in chunk:
            perms = got.get(uid, frozenset())
            if len(_cache) >= _CACHE_MAX:
                _cache.clear()
            _cache[uid] = (now + POSITIVE_TTL_SECONDS, perms)
            out[uid] = perms
    return out
