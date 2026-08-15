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

# WS3 — cache anahtari (tenant_id, user_id). Yalnizca user_id ile
# anahtarlamak, ayni kimligin A'daki izinlerinin B'de servis edilmesi
# demekti (bir kullanici A'da admin, B'de member olabilir).
# (tenant_id, user_id) -> (expires_monotonic, frozenset(permissions))
_cache: Dict[Tuple[str, str], Tuple[float, frozenset]] = {}
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


def effective_permissions(user_id: str, *, tenant_id: str) -> frozenset:
    """Kullanicinin BIR TENANT ICINDEKI efektif RBAC izinleri.

    S2S, 60 sn cache. `tenant_id` zorunludur ve cache anahtarinin
    parcasidir.
    """
    uid = str(user_id)
    tid = str(tenant_id)
    key = (tid, uid)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    settings = get_settings()
    token = settings.HERMES_S2S_TOKEN_CURRENT
    if not token:
        raise AuthzUnavailable("S2S credential not configured")

    try:
        resp = _get_client().post(
            f"{auth_service_base_url()}/internal/authz/resolve",
            json={"tenant_id": tid, "user_ids": [uid]},
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception as exc:  # noqa: BLE001 — fail closed
        logger.warning("authz resolve transport error class=%s",
                       type(exc).__name__)
        raise AuthzUnavailable("transport") from exc
    if resp.status_code != 200:
        logger.warning("authz resolve status=%s", resp.status_code)
        raise AuthzUnavailable(f"status {resp.status_code}")

    body = resp.json()
    # Auth, cozdugu tenant'i TEKRARLAR. Uyusmazsa yanit BASKA bir
    # tenant'a aittir — cache'lemek yerine fail-closed davraniyoruz.
    echoed = str(body.get("tenant_id") or "")
    if echoed and echoed != tid:
        logger.warning("authz resolve tenant mismatch")
        raise AuthzUnavailable("tenant mismatch")

    perms: frozenset = frozenset()
    for u in body.get("users") or []:
        if str(u.get("id")) == uid:
            perms = frozenset(u.get("permissions") or [])

    if len(_cache) >= _CACHE_MAX:
        _cache.clear()  # basit sinir — dogruluk auth'ta
    _cache[key] = (now + POSITIVE_TTL_SECONDS, perms)
    return perms


def effective_permissions_many(
    user_ids, *, tenant_id: str
) -> Dict[str, frozenset]:
    """Batch cozum: tek /internal/authz/resolve cagrisiyla birden fazla
    kullanicinin izinlerini getirir ve cache'i doldurur. Fan-out gibi
    N kullaniciyi arka arkaya soracak yerler icin — N+1 S2S YOK.

    Cache'te taze olanlar istege dahil edilmez. Basarisizlik →
    AuthzUnavailable (fail-closed; cagiran karar noktasi bilir)."""
    tid = str(tenant_id)
    now = time.monotonic()
    out: Dict[str, frozenset] = {}
    missing = []
    for uid in dict.fromkeys(str(u) for u in user_ids):
        hit = _cache.get((tid, uid))
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
                json={"tenant_id": tid, "user_ids": chunk},
                headers={"Authorization": f"Bearer {token}"},
            )
        except Exception as exc:  # noqa: BLE001 — fail closed
            logger.warning("authz batch resolve transport error class=%s",
                           type(exc).__name__)
            raise AuthzUnavailable("transport") from exc
        if resp.status_code != 200:
            logger.warning("authz batch resolve status=%s", resp.status_code)
            raise AuthzUnavailable(f"status {resp.status_code}")
        body = resp.json()
        echoed = str(body.get("tenant_id") or "")
        if echoed and echoed != tid:
            logger.warning("authz batch resolve tenant mismatch")
            raise AuthzUnavailable("tenant mismatch")
        got = {
            str(u.get("id")): frozenset(u.get("permissions") or [])
            for u in body.get("users") or []
        }
        for uid in chunk:
            perms = got.get(uid, frozenset())
            if len(_cache) >= _CACHE_MAX:
                _cache.clear()
            _cache[(tid, uid)] = (now + POSITIVE_TTL_SECONDS, perms)
            out[uid] = perms
    return out
