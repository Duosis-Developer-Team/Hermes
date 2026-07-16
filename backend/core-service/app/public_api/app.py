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
from .errors import ERROR_DOCS, ERROR_STATUS, register_error_handlers
from .request_context import RequestIDMiddleware
from .routers import me, meta
from .routers import directory as directory_router
from .routers import meetings as meetings_router
from .routers import reference as reference_router
from .routers import tasks as tasks_router
from .routers import tasks_write as tasks_write_router
from .routers import work_logs as work_logs_router
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

## Writes

- Write endpoints require a **user-bound** API client; every write is
  performed as the bound Hermes user under that user's existing
  permissions. **Service clients are read-only** — a write scope on a
  service client is still rejected with 403. Acting on behalf of another
  user is not possible in v1.
- **No destructive operations**: the public API exposes no delete
  endpoints, and archived data cannot be modified through it.
- **Known limitation**: API-triggered task lifecycle actions currently
  preserve Hermes activity and notification records, but **email
  delivery parity with browser-triggered actions is not yet
  guaranteed**. E-mails keep flowing for actions performed in the
  Hermes web app.

## Idempotency

All POST endpoints accept an optional `Idempotency-Key` header
(8-128 chars of `[A-Za-z0-9_-.]`, scoped to your API client, retained
for **24 hours**):

- Same key + same payload → the stored response is replayed with
  `Idempotency-Replayed: true`.
- Same key + different payload → `409 conflict`.
- Same key while the original request is **still in flight** →
  `409 idempotency_request_in_progress`. This is safe to retry: once the
  original request completes, the same key replays its stored response.
- Without the header, retries are not protected against duplicates.

## Rate limiting

Requests are limited per token. Every authenticated response carries
`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`
(epoch seconds); exceeding the limit returns `429 rate_limit_exceeded`
with a `Retry-After` header. Higher limits are configured per client by
a Hermes admin.
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
    public_app.include_router(tasks_router.router)
    public_app.include_router(tasks_write_router.router)
    public_app.include_router(reference_router.router)
    public_app.include_router(work_logs_router.router)
    public_app.include_router(meetings_router.router)
    public_app.include_router(directory_router.router)

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

        # Uretim zamani (additive) — sema deploy sonrasi ILK istekte
        # uretilir ve cache'lenir; portal banner'i "Last generated"
        # alanini buradan okur.
        from datetime import datetime, timezone

        schema["info"]["x-generated-at"] = datetime.now(
            timezone.utc
        ).isoformat()

        # Hata zarfi semasi — tum hata yanitlarinin tek sekli.
        schema.setdefault("components", {}).setdefault("schemas", {})[
            "ErrorEnvelope"
        ] = {
            "type": "object",
            "required": ["error"],
            "properties": {
                "error": {
                    "type": "object",
                    "required": ["code", "message", "request_id"],
                    "properties": {
                        "code": {
                            "type": "string",
                            "enum": sorted(ERROR_STATUS.keys()),
                        },
                        "message": {"type": "string"},
                        "request_id": {"type": "string"},
                    },
                }
            },
        }

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
        # Hata kodu katalogu — tek kaynak errors.ERROR_STATUS/ERROR_DOCS.
        errors_table = "\n".join(
            f"| `{code}` | {status} | {ERROR_DOCS[code]} |"
            for code, status in ERROR_STATUS.items()
        )
        schema["info"]["description"] = (
            f"{schema['info'].get('description', '')}\n\n"
            "## Scopes\n\n| Scope | Description |\n|---|---|\n"
            f"{catalog}\n\n"
            "## Error codes\n\nEvery error response is an `ErrorEnvelope` "
            "(see schemas):\n\n"
            "| Code | HTTP | Meaning |\n|---|---|---|\n"
            f"{errors_table}"
        )

        public_app.openapi_schema = schema
        return schema

    public_app.openapi = custom_openapi

    return public_app
