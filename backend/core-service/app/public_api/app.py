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
from fastapi.openapi.utils import get_openapi

from .audit import AuditMiddleware
from .errors import register_error_handlers
from .request_context import RequestIDMiddleware
from .routers import me, meta
from .scopes import SCOPES

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

    # Middleware sirasi (son eklenen EN DISTA calisir):
    #   RequestID (dis) → Audit (ic) — audit, request_id'yi gorur ve
    #   rate-limit basliklarini yanita isler.
    public_app.add_middleware(AuditMiddleware)
    public_app.add_middleware(RequestIDMiddleware)
    register_error_handlers(public_app)
    public_app.include_router(meta.router)
    public_app.include_router(me.router)

    def custom_openapi():
        """Public semayi zenginlestirir:
        - HTTPBearer guvenlik semasi (ApiToken)
        - `openapi_extra=scope_docs(...)` ile isaretlenen endpoint'lere
          security gereksinimi + "Required scopes" aciklamasi
        - Scope katalogu dokumantasyon aciklamasina eklenir
        Internal uygulamadan hicbir sey iceremez (ayri app)."""
        if public_app.openapi_schema:
            return public_app.openapi_schema

        schema = get_openapi(
            title=public_app.title,
            version=public_app.version,
            description=public_app.description,
            routes=public_app.routes,
        )

        schema.setdefault("components", {})["securitySchemes"] = {
            "ApiToken": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "hms_dev_... / hms_live_...",
                "description": (
                    "Hermes API token created in Admin → API Management. "
                    "Sent as `Authorization: Bearer <token>`. Tokens are "
                    "never accepted via query parameters or cookies."
                ),
            }
        }

        # scope_docs() ile isaretlenen operasyonlara security + aciklama.
        for path_item in schema.get("paths", {}).values():
            for operation in path_item.values():
                if not isinstance(operation, dict):
                    continue
                required = operation.get("x-required-scopes")
                if not required:
                    continue
                operation["security"] = [{"ApiToken": []}]
                scope_lines = "\n".join(f"- `{s}`" for s in required)
                desc = operation.get("description") or ""
                operation["description"] = (
                    f"{desc}\n\n**Required scopes:**\n{scope_lines}"
                ).strip()

        # Scope katalogu — dokumantasyonun tek kaynagi scopes.SCOPES.
        catalog = "\n".join(f"| `{s}` | {d} |" for s, d in SCOPES.items())
        schema["info"]["description"] = (
            f"{schema['info'].get('description', '')}\n\n"
            "## Scopes\n\n| Scope | Description |\n|---|---|\n"
            f"{catalog}"
        )

        public_app.openapi_schema = schema
        return schema

    public_app.openapi = custom_openapi

    return public_app
