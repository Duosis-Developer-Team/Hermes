# =============================================================================
# HERMES core - S2S directory istemcisi (Stage 5B-2, onayli)
# =============================================================================
# auth-service /internal/directory/... cagrilari. Kurallar:
#   - Credential: settings.HERMES_S2S_TOKEN_CURRENT (kullanici JWT'si
#     DEGIL); yalnizca Authorization: Bearer basligiyla; ASLA loglanmaz.
#   - Batch cozum (N+1 yok); URL/query'de ID tasinmaz (POST govdesi).
#   - Cache: pozitif 60 sn / negatif 12 sn. Bayat cache'ten kimlik
#     UYDURULMAZ (yalnizca birebir cozulmus kayitlar saklanir).
#   - auth-service erisilemezse FAIL CLOSED: DirectoryUnavailable
#     yukselir; public katman bunu sanitize internal_error'a cevirir.
#   - Upstream adresi YALNIZCA settings.AUTH_SERVICE_URL — keyfi URL /
#     SSRF yetenegi yok. Test kancasi: set_client_factory.
#   - Adres turetimi auth_upstream.auth_service_base_url() ile TEK
#     yerden yapilir: /internal/... yollari /api prefix'inin DISINDA
#     oldugu icin configmap'teki /api/v1 soneki kirpilmalidir (bkz.
#     auth_upstream basligindaki canli bug kaydi).
# =============================================================================

import logging
import time
from typing import Callable, Dict, List, Optional, Tuple

import httpx

from ..config import get_settings
from .auth_upstream import auth_service_base_url

logger = logging.getLogger("hermes.directory")

POSITIVE_TTL_SECONDS = 60.0
NEGATIVE_TTL_SECONDS = 12.0
_TIMEOUT = 5.0

_client: Optional[httpx.Client] = None
_client_factory: Callable[[], httpx.Client] = lambda: httpx.Client(
    timeout=_TIMEOUT
)

# id(str) -> (expires_monotonic, profile|None)  — None = negatif kayit.
_cache: Dict[str, Tuple[float, Optional[dict]]] = {}
_CACHE_MAX = 5000


class DirectoryUnavailable(Exception):
    """auth-service dizinine ulasilamiyor / yapilandirilmamis."""


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


def _base_and_token() -> Tuple[str, str]:
    token = get_settings().HERMES_S2S_TOKEN_CURRENT
    if not token:
        raise DirectoryUnavailable("S2S credential not configured")
    return auth_service_base_url(), token


def _remember(tid: str, uid: str, profile: Optional[dict]) -> None:
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()
    ttl = POSITIVE_TTL_SECONDS if profile else NEGATIVE_TTL_SECONDS
    # WS7: anahtar (tenant_id, user_id). Yalnizca user_id ile
    # anahtarlamak, A'da cozulmus bir profilin B'de servis edilmesi
    # demekti — ve bu profil e-posta adresi tasiyor.
    _cache[(tid, uid)] = (time.monotonic() + ttl, profile)


def resolve_users(user_ids: List[str], *, tenant_id) -> Dict[str, dict]:
    """Batch ID → minimal profil ({id: profile}); bilinmeyenler yok.

    Cache'lenmemis ID'ler TEK istekle cozulur. `tenant_id` ZORUNLUDUR:
    dizin sonucu o tenant'in AKTIF UYELERI ile sinirlidir.
    """
    tid = str(tenant_id)
    now = time.monotonic()
    out: Dict[str, dict] = {}
    misses: List[str] = []
    for uid in dict.fromkeys(str(u) for u in user_ids):
        hit = _cache.get((tid, uid))
        if hit and hit[0] > now:
            if hit[1] is not None:
                out[uid] = hit[1]
            continue
        misses.append(uid)

    if not misses:
        return out

    base, token = _base_and_token()
    try:
        resp = _get_client().post(
            f"{base}/internal/directory/users/resolve",
            json={"tenant_id": str(tenant_id), "user_ids": misses},
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception as exc:  # noqa: BLE001 — fail closed
        logger.warning("directory resolve transport error class=%s",
                       type(exc).__name__)
        raise DirectoryUnavailable("transport") from exc
    if resp.status_code != 200:
        logger.warning("directory resolve status=%s", resp.status_code)
        raise DirectoryUnavailable(f"status {resp.status_code}")

    resolved = {u["id"]: u for u in resp.json().get("users") or []}
    for uid in misses:
        profile = resolved.get(uid)
        _remember(tid, uid, profile)
        if profile is not None:
            out[uid] = profile
    return out


def list_users_global(
    *, tenant_id, limit: int, offset: int, q: Optional[str] = None
) -> Tuple[List[dict], bool]:
    """Genis aktif dizin — YALNIZCA global binding cozumunde cagrilir.

    WS7: "global" O TENANT ICINDE global demektir; platform-genelinde
    bir kullanici listesi hicbir cagirana donmez.
    Sayfali; cache'siz (dizin listesi kisa omurlu olmali).
    """
    base, token = _base_and_token()
    params: dict = {"tenant_id": str(tenant_id), "limit": limit,
                    "offset": offset}
    if q:
        params["q"] = q
    try:
        resp = _get_client().get(
            f"{base}/internal/directory/users",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("directory list transport error class=%s",
                       type(exc).__name__)
        raise DirectoryUnavailable("transport") from exc
    if resp.status_code != 200:
        logger.warning("directory list status=%s", resp.status_code)
        raise DirectoryUnavailable(f"status {resp.status_code}")
    body = resp.json()
    return body.get("users") or [], bool(body.get("has_more"))
