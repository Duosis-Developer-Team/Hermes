# =============================================================================
# hermes-mcp - tek upstream HTTP istemcisi
# =============================================================================
# SSRF onlemi YAPISALDIR: URL her zaman config.PUBLIC_API_BASE + burada
# quote edilmis GORELI path'ten kurulur. Tool argumanlari path'e yalnizca
# `seg()` ile (tam quote) girer; mutlak URL / host secimi imkansizdir.
# Test kancasi: set_client_factory — testler ASGITransport enjekte eder,
# uretimde dokunulmaz.
# =============================================================================

import logging
from typing import Callable, Optional
from urllib.parse import quote

import httpx

from . import config

logger = logging.getLogger("hermes_mcp.upstream")

_client: Optional[httpx.AsyncClient] = None
_client_factory: Callable[[], httpx.AsyncClient] = lambda: httpx.AsyncClient(
    timeout=config.UPSTREAM_TIMEOUT_SECONDS
)


def set_client_factory(factory: Callable[[], httpx.AsyncClient]) -> None:
    """YALNIZCA testler icin: ASGITransport'lu istemci enjeksiyonu."""
    global _client, _client_factory
    _client_factory = factory
    _client = None


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = _client_factory()
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def seg(value: str) -> str:
    """Path segmenti: TAM quote (safe='') — '/', '..', '?' etkisiz."""
    return quote(str(value), safe="")


async def api_request(
    method: str,
    path: str,
    *,
    token: str,
    tool: str,
    params: Optional[dict] = None,
):
    """Public API'ye tek istek. `path` GORELI olmali (or. 'tasks' veya
    f\"tasks/{seg(code)}\"). Yanit: (status_code, parsed_json_or_None).

    Loglama sanitize: token, arguman ve govde ASLA loglanmaz — yalnizca
    tool adi, path sablonu disi olmayan path, status ve sure.
    """
    if "://" in path or path.startswith("/"):
        # Programlama hatasini erken yakala — upstream secimi imkansiz.
        raise ValueError("upstream path must be relative")
    url = f"{config.PUBLIC_API_BASE}/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        # Onayli v1 audit zenginlestirmesi: user_agent'ta tool adi.
        "User-Agent": f"{config.SERVER_NAME}/{config.SERVER_VERSION} "
        f"tool={tool}",
    }
    client = await _get_client()
    resp = await client.request(method, url, headers=headers, params=params)
    try:
        body = resp.json() if resp.content else None
    except ValueError:
        body = None
    logger.info(
        "upstream tool=%s method=%s path=%s status=%s ms=%s",
        tool,
        method,
        path.split("?")[0],
        resp.status_code,
        int(resp.elapsed.total_seconds() * 1000)
        if resp.elapsed is not None
        else -1,
    )
    return resp.status_code, body
