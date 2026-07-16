# =============================================================================
# HERMES Public API - sub-app factory
# =============================================================================
# /api/public altina mount edilen bagimsiz FastAPI uygulamasi.
#
# Izolasyon garantileri:
#   - Kendi OpenAPI semasi (/api/public/v1/openapi.json) — internal route
#     ve semalar yapisal olarak buraya giremez.
#   - Kendi middleware zinciri (request-ID; Stage 2'de rate-limit + audit)
#     — internal/frontend trafigi bu katmandan gecmez.
#   - Kendi hata zarfi (errors.register_error_handlers).
#   - Cookie okumaz: kimlik dogrulama YALNIZCA Authorization: Bearer ile
#     yapilir (Stage 2'de get_api_context dependency'si).
#
# Not: mount edilen alt-uygulama, ana uygulamanin middleware'lerini
# (CORS dahil) devralmaz. Public API server-to-server kullanim icindir;
# Swagger UI ayni origin'den calistigi icin CORS gerekmez.
# =============================================================================

from fastapi import FastAPI

from .errors import register_error_handlers
from .request_context import RequestIDMiddleware
from .routers import meta

PUBLIC_API_DESCRIPTION = """
The Hermes Public API lets external systems and AI agents work with Hermes
tasks, projects, customers, work logs and meetings in a secure, versioned way.

- **Authentication**: `Authorization: Bearer hms_..._...` API tokens, created
  from *Admin → API Management*. Tokens are never accepted via query
  parameters or cookies.
- **Versioning**: all endpoints live under `/api/public/v1`. Breaking changes
  only ship in a new version prefix.
- **Errors**: every error uses one envelope —
  `{"error": {"code", "message", "request_id"}}`.
- **Request IDs**: each response carries `X-Request-ID`; include it when
  reporting problems.
""".strip()


def create_public_app() -> FastAPI:
    public_app = FastAPI(
        title="Hermes Public API",
        version="1.0.0",
        description=PUBLIC_API_DESCRIPTION,
        # Mount /api/public altinda oldugu icin tam yollar:
        #   /api/public/v1/docs  ·  /api/public/v1/openapi.json
        docs_url="/v1/docs",
        redoc_url=None,
        openapi_url="/v1/openapi.json",
    )

    public_app.add_middleware(RequestIDMiddleware)
    register_error_handlers(public_app)
    public_app.include_router(meta.router)

    return public_app
