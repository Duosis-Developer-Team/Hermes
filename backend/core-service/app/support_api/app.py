# =============================================================================
# HERMES Support API — izole alt-uygulama fabrikasi
# =============================================================================
# `/api/integrations` altina mount edilir; sozlesme yollari
# `/v1/support/...` olarak AYNEN korunur. Yani tam adres:
#
#     https://<host>/api/integrations/v1/support/tickets
#
# Sozlesme (04) taban ornegi `/api/public/v1/support` verir ve "gercek
# repo routing convention'ina uyarlanabilir; version ve semantik
# korunmalidir" der. Burada `/api/public` KULLANILAMAZDI: o mount,
# Public API'nin DONMUS hata zarfina ve "service client'lar read-only"
# kuralina sahip AYRI bir alt-uygulamadir.
#
# Izolasyon garantileri (public_api ile ayni desen):
#   - kendi OpenAPI semasi; internal route/semalar buraya giremez;
#   - kendi middleware zinciri (correlation ID);
#   - kendi hata zarfi (sozlesme sekli);
#   - cookie OKUMAZ — kimlik YALNIZCA `Authorization: Bearer`.
# =============================================================================

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from ..ticket_contract import CONTRACT_VERSION, SUPPORT_SCOPES
from .errors import register_error_handlers
from .routers import attachments, catalog, tickets

DESCRIPTION = """
Hermes Support integration API — the provider side of the shared
product ticketing contract (v1).

- **Authentication**: `Authorization: Bearer hsi_..._...` service
  tokens, issued by a Duosis support administrator. Tokens are never
  accepted via cookies or query parameters and always act on behalf of
  exactly one source application.
- **Idempotency**: create and customer command endpoints accept
  `Idempotency-Key`; replaying the same key with the same payload
  returns the stored response with `Idempotency-Replayed: true`.
- **Errors**: one envelope — `{"error": {"code", "message",
  "correlation_id", "retryable", "details"}}`. The `retryable` flag is
  part of the contract: honour it in your retry classification.
- **Events**: Hermes delivers signed webhooks to the callback URL
  registered for your application. Signatures are HMAC-SHA256 over
  `<timestamp>.<raw_body>`, lowercase hex, in `X-Hermes-Signature`.
""".strip()


class CorrelationMiddleware(BaseHTTPMiddleware):
    """`X-Correlation-Id` ucu uca tasinir (06 §7).

    Istemci verdiyse KORUNUR; vermediyse uretilir. Ayni deger hata
    zarfina, audit kaydina ve giden webhook basligina gider — bir
    sikayet tek bir kimlikle uctan uca izlenebilir.
    """

    async def dispatch(self, request: Request, call_next):
        incoming = (request.headers.get("x-correlation-id") or "").strip()
        request.state.correlation_id = incoming[:64] or str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = request.state.correlation_id
        return response


def create_support_app() -> FastAPI:
    app = FastAPI(
        title="Hermes Support Integration API",
        version=CONTRACT_VERSION,
        description=DESCRIPTION,
        docs_url="/v1/docs",
        redoc_url=None,
        openapi_url="/v1/openapi.json",
    )
    app.add_middleware(CorrelationMiddleware)
    register_error_handlers(app)
    app.include_router(catalog.router)
    app.include_router(tickets.router)
    app.include_router(attachments.router)

    @app.get("/v1/support/capabilities", tags=["Support catalog"])
    def capabilities():
        """Kesif ucu — kimlik GEREKTIRMEZ.

        Yalnizca sozlesme surumu ve scope katalogu gibi PUBLIC bilgiler
        doner; hicbir tenant/grup/ticket verisi icermez.
        """
        return {
            "contract_version": CONTRACT_VERSION,
            "scopes": SUPPORT_SCOPES,
            "idempotency": {"header": "Idempotency-Key",
                            "retention_hours": 24},
            "signature": {"algorithm": "HMAC-SHA256",
                          "header": "X-Hermes-Signature",
                          "encoding": "lowercase-hex",
                          "signed_bytes": "<timestamp>.<raw_body>"},
        }

    return app
