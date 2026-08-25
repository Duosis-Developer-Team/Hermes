# =============================================================================
# HERMES Support API — kimlik, kapsam ve ortak bagimliliklar
# =============================================================================
# Sozlesme §1: service client YALNIZCA KENDI application'i adina islem
# yapabilir. Bu kural burada, TOKEN KAYDINDAN turetilen bir kapsamla
# uygulanir; istek govdesindeki hicbir alan uygulamayi degistiremez.
#
# Boylece "LogiSlot tokeni `application_code=hermes` ile ticket acamaz"
# kabul testi (05 §9) yapisal olarak saglanir: govdede boyle bir alan
# BULUNMAZ.
# =============================================================================

from __future__ import annotations

import uuid
from typing import Generator, Optional

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import SupportSourceTenant
from ..public_api.rate_limit import get_limiter, rate_limit_headers
from ..services import support_tenant as support
from ..services import (
    support_integration_service as integration,
    ticket_routing,
    ticket_visibility as visibility,
)
from ..services.ticket_service import TicketConflict, TicketValidationError
from ..services.ticket_state import TransitionError
from ..services.ticket_idempotency import IdempotencyError
from .errors import SupportAPIError


def correlation_id(request: Request) -> str:
    return getattr(request.state, "correlation_id", "") or ""


def client_ip(request: Request) -> Optional[str]:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()[:45]
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


def translate(exc: Exception) -> SupportAPIError:
    """Servis istisnalarini SOZLESME kodlarina cevirir (tek yer)."""
    if isinstance(exc, TicketConflict):
        return SupportAPIError("ticket_version_conflict", str(exc))
    if isinstance(exc, TransitionError):
        return SupportAPIError(exc.code, str(exc))
    if isinstance(exc, TicketValidationError):
        return SupportAPIError(exc.code, str(exc))
    if isinstance(exc, IdempotencyError):
        return SupportAPIError(exc.code, str(exc))
    if isinstance(exc, visibility.TicketAccessDenied):
        # Kapsam disi kayit = VAR OLMAYAN kayit (ayni 404 zarfi).
        if exc.as_not_found:
            return SupportAPIError("not_found")
        return SupportAPIError("forbidden", str(exc))
    if isinstance(exc, support.SupportNotConfigured):
        return SupportAPIError("support_not_configured", str(exc))
    raise exc


def get_support_db() -> Generator[Session, None, None]:
    try:
        with support.support_session() as db:
            yield db
    except support.SupportNotConfigured as exc:
        raise SupportAPIError("support_not_configured", str(exc))


def get_scope(
    request: Request, db: Session = Depends(get_support_db)
) -> visibility.IntegrationScope:
    """Bearer token → uygulama kapsami.

    Sira: format → hash → durum → ortam → uygulama → rate limit.
    Hicbir hata mesaji token degeri icermez ve tum basarisizliklar ayni
    `unauthorized` koduna duser.
    """
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise SupportAPIError(
            "unauthorized",
            "Missing bearer token. Send 'Authorization: Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raw = header[len("Bearer "):].strip()
    try:
        client, application, token = integration.authenticate(db, raw)
    except integration.AuthFailure as exc:
        raise SupportAPIError(
            "unauthorized", str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        )

    settings = get_settings()
    limit = (
        client.rate_limit_per_min
        or settings.SUPPORT_INTEGRATION_DEFAULT_RATE_LIMIT
    )
    result = get_limiter().check(f"support:client:{client.id}", limit, 60)
    if not result.allowed:
        raise SupportAPIError(
            "rate_limited",
            "Rate limit exceeded for this integration client.",
            headers=rate_limit_headers(result),
        )
    request.state.rate_limit = result
    integration.touch_last_used(db, token, client_ip(request))

    request.state.support_client_id = str(client.id)
    request.state.support_application_code = application.code
    return visibility.IntegrationScope(
        application_id=application.id,
        application_code=application.code,
        scopes=frozenset(client.scopes or []),
        client_id=client.id,
    )


def require_scopes(*scopes: str):
    def checker(
        scope: visibility.IntegrationScope = Depends(get_scope),
    ) -> visibility.IntegrationScope:
        missing = [s for s in scopes if not scope.has_scope(s)]
        if missing:
            raise SupportAPIError(
                "insufficient_scope",
                "This token is missing required scope(s): "
                + ", ".join(sorted(missing)),
            )
        return scope

    return checker


def resolve_source_tenant(
    db: Session, scope: visibility.IntegrationScope, source_tenant_id: str
) -> SupportSourceTenant:
    """Kaynak tenant mapping'i — HER ZAMAN token'in uygulamasi icinde.

    Baska bir uygulamanin tenant'i, ayni `source_tenant_id` degerine
    sahip olsa bile BULUNMAZ: arama `application_id` ile sinirlidir.
    """
    try:
        return ticket_routing.require_source_tenant(
            db, application_id=scope.application_id,
            source_tenant_id=source_tenant_id,
        )
    except TicketValidationError as exc:
        raise translate(exc)


def new_correlation() -> str:
    return str(uuid.uuid4())
