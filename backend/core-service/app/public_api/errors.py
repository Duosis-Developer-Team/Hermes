# =============================================================================
# HERMES Public API - Error envelope
# =============================================================================
# Tum public API hatalari TEK zarf formatinda doner:
#
#   { "error": { "code": "...", "message": "...", "request_id": "req_..." } }
#
# Kurallar:
#   - Stack trace, SQL detayi, internal route/sema adi, secret ASLA sizmaz.
#   - request_id her zarfta bulunur (request_context middleware uretir).
#   - Kod katalogu sabittir; her kod tek bir HTTP status'a eslenir.
# =============================================================================

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("hermes.public_api")

# Kod katalogu -> HTTP status. Spec'teki sabit liste; yeni kod eklemek
# bilincli bir API surumu karari gerektirir.
ERROR_STATUS = {
    "invalid_request": 400,
    "validation_error": 422,
    "invalid_token": 401,
    "expired_token": 401,
    "revoked_token": 401,
    "insufficient_scope": 403,
    "resource_access_denied": 403,
    "resource_not_found": 404,
    "conflict": 409,
    # Ayni Idempotency-Key ile yarisan istek HALEN islenirken doner.
    # `conflict`ten farkli: guvenle RETRY edilebilir (ilk istek bitince
    # ayni anahtar saklanan yaniti replay eder). Onayli 3C follow-up.
    "idempotency_request_in_progress": 409,
    "rate_limit_exceeded": 429,
    "internal_error": 500,
}

# Generic HTTPException status -> public kod eslemesi (dogrudan
# PublicAPIError firlatilmayan durumlar icin guvenli varsayilanlar).
_STATUS_TO_CODE = {
    400: "invalid_request",
    401: "invalid_token",
    403: "resource_access_denied",
    404: "resource_not_found",
    405: "invalid_request",
    409: "conflict",
    422: "validation_error",
    429: "rate_limit_exceeded",
}


class PublicAPIError(Exception):
    """Public yuzeyde bilerek uretilen hata. `code` katalogdan olmalidir."""

    def __init__(self, code: str, message: str, headers: dict | None = None):
        if code not in ERROR_STATUS:  # programlama hatasini erken yakala
            raise ValueError(f"unknown public error code: {code}")
        self.code = code
        self.message = message
        self.status_code = ERROR_STATUS[code]
        self.headers = headers or {}
        super().__init__(message)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "") or ""


def error_response(
    request: Request,
    code: str,
    message: str,
    headers: dict | None = None,
    status_code: int | None = None,
) -> JSONResponse:
    """`status_code` yalnizca orijinal HTTP statusu korumak icin (orn. 405)
    override edilir; verilmezse kod katalogundaki status kullanilir."""
    rid = _request_id(request)
    out_headers = {"X-Request-ID": rid}
    if headers:
        out_headers.update(headers)
    return JSONResponse(
        status_code=status_code or ERROR_STATUS.get(code, 500),
        content={
            "error": {"code": code, "message": message, "request_id": rid}
        },
        headers=out_headers,
    )


def register_error_handlers(app) -> None:
    @app.exception_handler(PublicAPIError)
    async def _public_error(request: Request, exc: PublicAPIError):
        return error_response(request, exc.code, exc.message, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        # Alan bazli ozet: kullanicinin kendi girdisine dair guvenli bilgi.
        try:
            first = exc.errors()[0]
            loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
            message = f"Validation failed: {loc}: {first.get('msg', 'invalid')}"
        except Exception:  # noqa: BLE001
            message = "Request validation failed."
        return error_response(request, "validation_error", message)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        code = _STATUS_TO_CODE.get(exc.status_code, "internal_error")
        if exc.status_code >= 500:
            # 5xx detayi asla disari sizdirilmaz.
            return error_response(
                request, "internal_error", "An internal error occurred."
            )
        message = (
            exc.detail
            if isinstance(exc.detail, str) and exc.detail
            else "Request could not be processed."
        )
        # Orijinal 4xx statusu koru (orn. 405 Method Not Allowed) — kod
        # katalogu statusu yalnizca dogrudan PublicAPIError'da belirleyici.
        return error_response(request, code, message, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception):
        # Sunucu logu: sanitize edilmis yapisal kayit (header/body yok).
        logger.exception(
            "public_api unhandled error request_id=%s method=%s path=%s",
            _request_id(request),
            request.method,
            request.url.path,
        )
        return error_response(
            request, "internal_error", "An internal error occurred."
        )
