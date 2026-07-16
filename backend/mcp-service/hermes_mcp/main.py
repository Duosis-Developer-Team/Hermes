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


async def mcp_endpoint(scope, receive, send):
    """Bearer token'i istek baglamina koyup SDK'ya devreder. Token
    DEGERI hicbir yerde loglanmaz."""
    headers = dict(scope.get("headers") or [])
    token = token_from_headers(headers)
    reset = current_token.set(token)
    try:
        await session_manager.handle_request(scope, receive, send)
    finally:
        current_token.reset(reset)


@contextlib.asynccontextmanager
async def lifespan(app):
    async with session_manager.run():
        yield
    await close_client()


app = Starlette(
    routes=[
        Route("/health", health, methods=["GET"]),
        Mount("/mcp", app=mcp_endpoint),
    ],
    lifespan=lifespan,
)
