# =============================================================================
# HERMES Support API — sozlesme hata zarfi
# =============================================================================
# 04 §12'deki zarf BIREBIR uygulanir:
#
#   {"error": {"code", "message", "correlation_id", "retryable",
#              "details"}}
#
# `retryable` alani KOZMETIK DEGILDIR: consumer'in retry siniflandirmasi
# (06 §2) buna bakar. `route_stale` gibi bir kodu retryable isaretlemek,
# consumer'i sonsuz bir donguye sokardi; `integration_unavailable`i
# retryable OLMAYAN isaretlemek ise gecici bir kesintide ticket'i
# kalicı olarak kaybettirirdi.
#
# NOT: Public API'nin (`/api/public`) zarfi FARKLIDIR ve DONMUSTUR
# (code/message/request_id). Iki yuzey ayri alt-uygulamalardir; bu
# ayrim, tek bir zarfi iki sozlesmeye birden uydurmaya calismaktan
# dogacak kirilmayi onler.
# =============================================================================

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..ticket_contract import (
    ERROR_CATALOG,
    error_message,
    error_retryable,
    error_status,
)

logger = logging.getLogger("hermes.support_api")

_STATUS_TO_CODE = {
    400: "invalid_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "invalid_request",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
}


class SupportAPIError(Exception):
    """Sozlesme katalogundan bilincli hata."""

    def __init__(
        self, code: str, message: str | None = None,
        details: dict | None = None, headers: dict | None = None,
    ):
        if code not in ERROR_CATALOG:
            raise ValueError(f"unknown support error code: {code}")
        self.code = code
        self.message = message or error_message(code)
        self.details = details or {}
        self.headers = headers or {}
        self.status_code = error_status(code)
        super().__init__(self.message)


def _correlation(request: Request) -> str:
    return getattr(request.state, "correlation_id", "") or ""


def error_response(
    request: Request, code: str, message: str,
    details: dict | None = None, headers: dict | None = None,
    status_code: int | None = None,
) -> JSONResponse:
    out_headers = {"X-Correlation-Id": _correlation(request)}
    if headers:
        out_headers.update(headers)
    return JSONResponse(
        status_code=status_code or error_status(code),
        content={
            "error": {
                "code": code,
                "message": message,
                "correlation_id": _correlation(request),
                "retryable": error_retryable(code),
                "details": details or {},
            }
        },
        headers=out_headers,
    )


def register_error_handlers(app) -> None:
    @app.exception_handler(SupportAPIError)
    async def _support_error(request: Request, exc: SupportAPIError):
        return error_response(
            request, exc.code, exc.message, exc.details, exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        try:
            first = exc.errors()[0]
            loc = ".".join(
                str(p) for p in first.get("loc", []) if p != "body"
            )
            message = f"Validation failed: {loc}: {first.get('msg')}"
        except Exception:  # noqa: BLE001
            message = "Request validation failed."
        return error_response(request, "validation_error", message)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        if exc.status_code >= 500:
            return error_response(
                request, "internal_error", error_message("internal_error")
            )
        code = _STATUS_TO_CODE.get(exc.status_code, "invalid_request")
        message = (
            exc.detail if isinstance(exc.detail, str) and exc.detail
            else error_message(code)
        )
        return error_response(
            request, code, message, status_code=exc.status_code
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # Sunucu logu sanitize: govde/baslik/token YOK.
        logger.exception(
            "support_api unhandled correlation_id=%s method=%s path=%s",
            _correlation(request), request.method, request.url.path,
        )
        return error_response(
            request, "internal_error", error_message("internal_error")
        )
