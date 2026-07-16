# =============================================================================
# hermes-mcp - ASGI girisi: /health + /mcp (Streamable HTTP)
# =============================================================================
# STATELESS mod (onayli tasarim): her POST bagimsiz; oturum kalicilik
# yok — bearer header her istekte gelir, gorunurluk kisa TTL'le cozulur,
# yetki HER cagrida Public API'de dogrulanir. JSON yanit modu acik
# (json_response=True): SDK'nin sagladigi Streamable HTTP davranisi
# disinda ozel transport YOK (onayli D5-2).
#
# Calistirma: uvicorn hermes_mcp.main:app --host 0.0.0.0 --port 8010
# =============================================================================

import contextlib
import logging

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from . import config
from .auth import current_token, token_from_headers
from .discovery import www_authenticate
from .server import server
from .upstream import close_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

session_manager = StreamableHTTPSessionManager(
    app=server,
    json_response=True,
    stateless=True,
)


async def health(_request):
    return JSONResponse(
        {
            "status": "ok",
            "service": config.SERVER_NAME,
            "version": config.SERVER_VERSION,
        }
    )


# Surec-ici eszamanlilik tavani (tasarim: stampede guard'i — yetki
# mekanizmasi DEGIL).
_inflight = {"n": 0}


async def _plain_response(send, status: int, body: dict,
                          headers: dict | None = None):
    import json as _json

    raw = _json.dumps(body).encode()
    hdrs = [(b"content-type", b"application/json"),
            (b"content-length", str(len(raw)).encode())]
    for k, v in (headers or {}).items():
        hdrs.append((k.encode(), v.encode()))
    await send({"type": "http.response.start", "status": status,
                "headers": hdrs})
    await send({"type": "http.response.body", "body": raw})


def _www_authenticate() -> str:
    """MCP auth spec: 401 challenge, PRM dokumanina isaret eder (RFC 9728).
    URL turetimi discovery modulunde — urllib.parse ile (rstrip ASLA:
    karakter-kumesi kirpmasi '.com'un 'm'sini yiyordu, canli 5D bulgusu)."""
    return www_authenticate(config.RESOURCE_URL)


async def mcp_endpoint(scope, receive, send):
    """Bearer token'i istek baglamina koyup SDK'ya devreder. Token
    DEGERI hicbir yerde loglanmaz. 5D sertlestirmeleri: 401+WWW-
    Authenticate challenge (OAuth kesif temeli), govde limiti,
    eszamanlilik tavani."""
    headers = dict(scope.get("headers") or [])

    # Govde limiti (Content-Length bazli; ingress proxy-body-size ile
    # birlikte cift katman).
    try:
        length = int(headers.get(b"content-length", b"0") or 0)
    except ValueError:
        length = 0
    if length > config.MAX_BODY_BYTES:
        await _plain_response(
            send, 413, {"error": "request body too large"}
        )
        return

    token = token_from_headers(headers)
    if scope.get("method") == "POST" and token is None:
        # HTTP-katmani challenge: client PRM'i kesfedebilsin.
        await _plain_response(
            send,
            401,
            {
                "error": "authentication required",
                "detail": (
                    "Send a Hermes API token as 'Authorization: Bearer "
                    "hms_...' (internal-beta authentication)."
                ),
            },
            headers={"WWW-Authenticate": _www_authenticate()},
        )
        return

    if _inflight["n"] >= config.MAX_CONCURRENT:
        await _plain_response(
            send, 503,
            {"error": "server busy", "detail": "Retry shortly."},
        )
        return

    _inflight["n"] += 1
    reset = current_token.set(token)
    try:
        await session_manager.handle_request(scope, receive, send)
    finally:
        current_token.reset(reset)
        _inflight["n"] -= 1


async def protected_resource_metadata(_request):
    """RFC 9728 Protected Resource Metadata — OAuth kesif TEMELI.
    authorization_servers BOS: Hermes OAuth authorization server'i
    henuz yok; external MCP uyumlulugu bilinclice 'not ready'.
    Bearer hms_ modu internal-beta kimligidir (dokumante)."""
    return JSONResponse(
        {
            "resource": config.RESOURCE_URL,
            "authorization_servers": [],
            "bearer_methods_supported": ["header"],
            "resource_documentation": config.PORTAL_DOCS_URL,
            "hermes_authorization_status": (
                "internal-beta: Hermes API bearer tokens only; OAuth 2.1 "
                "authorization server not yet available — external MCP "
                "client compatibility is NOT claimed."
            ),
        }
    )


class _RawAsgiEndpoint:
    """Starlette Route'u FONKSIYON endpoint'leri request/response olarak
    sarar; ham ASGI callable'i sinif ornegi olarak vermek gerekir.
    Amac: `/mcp` (slash'siz) icin Mount'un 307 redirect'inden kacinmak —
    canli bulgu: redirect Location'i http:// uretiyordu ve cogu HTTP
    client'i sema degisiminde Authorization header'ini DUSURUYOR
    (= MCP client'lari baglanamiyor)."""

    def __init__(self, app):
        self._app = app

    async def __call__(self, scope, receive, send):
        await self._app(scope, receive, send)


_mcp_asgi = _RawAsgiEndpoint(mcp_endpoint)


@contextlib.asynccontextmanager
async def lifespan(app):
    async with session_manager.run():
        yield
    await close_client()


app = Starlette(
    routes=[
        Route("/health", health, methods=["GET"]),
        # RFC 9728: hem kok hem path-suffix'li varyant.
        Route(
            "/.well-known/oauth-protected-resource",
            protected_resource_metadata,
            methods=["GET"],
        ),
        Route(
            "/.well-known/oauth-protected-resource/mcp",
            protected_resource_metadata,
            methods=["GET"],
        ),
        # ONCE tam eslesme (/mcp) — redirect'siz; SONRA /mcp/ ve alt
        # yollar icin mount. Ikisi de ayni ASGI uygulamasina gider.
        Route(
            "/mcp",
            _mcp_asgi,
            methods=["GET", "POST", "DELETE", "OPTIONS"],
        ),
        Mount("/mcp", app=_mcp_asgi),
    ],
    lifespan=lifespan,
)
