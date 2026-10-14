# =============================================================================
# HERMES core — Ticket route'larinin ortak bagimliliklari
# =============================================================================
# Uc yuzey (hub, portal, admin) ayni sinirlari paylasir:
#   - modul yapilandirilmis mi? (yoksa 503 — sessiz bos liste DEGIL)
#   - istek hangi tenant'tan geliyor? (hub yalnizca support tenant'inda)
#   - support tenant oturumu ACIK olarak, DAR bir gecitten aciliyor
#   - is kurali hatalari TEK yerde HTTP'ye ceviriliyor
#
# Hata cevrimi burada toplanir ki her router kendi eslemesini uydurmasin:
# ayni ihlal her yuzeyde AYNI statuyu ve ayni makine-okur kodu uretsin.
# =============================================================================

from __future__ import annotations

import uuid
from typing import Generator, Optional, Tuple

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user

from ..services import support_tenant as support
from ..services import ticket_network as network
from ..services import ticket_visibility as visibility
from ..services.ticket_service import TicketConflict, TicketValidationError
from ..services.ticket_state import TransitionError
from ..ticket_contract import error_status

# Makine-okur sozlesme kodu, insan mesajindan AYRI bir baslikta doner.
# Frontend "409" ile "hangi 409" arasindaki farki buradan anlar.
ERROR_CODE_HEADER = "X-Error-Code"


def http_error(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=error_status(code),
        detail=message,
        headers={ERROR_CODE_HEADER: code},
    )


def translate(exc: Exception) -> HTTPException:
    """Servis istisnalarini TEK yerde HTTP'ye cevirir."""
    if isinstance(exc, TicketConflict):
        return http_error("ticket_version_conflict", str(exc))
    if isinstance(exc, TransitionError):
        return http_error(exc.code, str(exc))
    if isinstance(exc, TicketValidationError):
        return http_error(exc.code, str(exc))
    if isinstance(exc, visibility.TicketAccessDenied):
        # KAPSAM disi = YOK (404); IZIN eksigi = 403. Ayrim bilincli:
        # kapsam disi bir ticket'in VARLIGINI bile sizdirmayiz.
        if exc.as_not_found:
            return http_error(
                "not_found", "This ticket does not exist."
            )
        return http_error("forbidden", str(exc))
    if isinstance(exc, support.SupportNotConfigured):
        return http_error("support_not_configured", str(exc))
    raise exc


def correlation_id(request: Request) -> str:
    """Istemcinin verdigi izleme kimligi (yoksa uretilir).

    Sozlesme geregi `X-Correlation-Id` ucu uca tasinir: tarayici →
    Hermes → outbox → webhook → consumer.
    """
    raw = (request.headers.get("x-correlation-id") or "").strip()
    if raw:
        try:
            return str(uuid.UUID(raw))
        except ValueError:
            return raw[:64]
    return str(uuid.uuid4())


def client_ip(request: Request) -> Optional[str]:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()[:45]
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


# =============================================================================
# Oturumlar — talep agi (00-plan §4.0)
# =============================================================================
# Canonical talep SAGLAYICININ verisinde durur. Iki yuz, iki oturum:
#   hub    → cagiranin KENDI tenant'i (saglayiciysa)
#   portal → cagiranin talep agi baglantilarindan COZULEN saglayici
# Tenant kimligi hicbir zaman istek govdesinden alinmaz; portalda istemci
# yalnizca baglanti kumesinden SECER (`provider`), kume sunucudadir.

PROVIDER_PARAM = "provider"
PROVIDER_HEADER = "x-ticket-provider"


def caller_is_provider(
    current_user: CurrentUser = Depends(get_current_user),
) -> bool:
    """Cagiranin tenant'i saglayici mi (hub var mi)? Istek basina BIR kez.

    Yapilandirilmis destek tenant'i DB'ye sorulmadan saglayicidir; digerleri
    icin global indeks kisa omurlu bir oturumla okunur ve oturum HEMEN
    kapanir (istek boyunca bosta baglanti tutulmaz).
    """
    if support.is_support_tenant(current_user.tenant_id):
        return True
    with support.global_session() as gdb:
        return network.is_provider(gdb, current_user.tenant_id)


def caller_links(
    current_user: CurrentUser = Depends(get_current_user),
) -> Tuple[network.ProviderLink, ...]:
    """Cagiranin talep agi baglantilari (portal). Istek basina BIR kez."""
    with support.global_session() as gdb:
        return tuple(network.requester_links(gdb, current_user.tenant_id))


def get_support_db(
    current_user: CurrentUser = Depends(get_current_user),
    is_provider: bool = Depends(caller_is_provider),
) -> Generator[Optional[Session], None, None]:
    """HUB oturumu: cagiranin kendi tenant'i — yalnizca SAGLAYICIYSA.

    Modul kapaliysa veya tenant saglayici degilse `None` doner — HATA
    FIRLATMAZ. Yuzey kapilari (`require_support_surface`, `_support_admin`)
    zaten anlamli bir 503/404 uretir; `/tickets/context` ise modul
    kapaliyken de cevap vermek zorundadir. db None iken hicbir sorgu
    calismaz (sessiz bos liste yok).
    """
    if not support.is_available() or not is_provider:
        yield None
        return
    try:
        with support.provider_session(current_user.tenant_id) as db:
            yield db
    except support.SupportNotConfigured as exc:
        raise http_error("support_not_configured", str(exc))


def require_module_enabled() -> None:
    if not support.is_available():
        state, _ = support.module_state()
        raise http_error(
            "support_not_configured",
            "The support ticket module is not configured on this "
            f"deployment ({state}).",
        )


# =============================================================================
# Hub (gelen talepler) kapisi
# =============================================================================

def require_support_surface(
    current_user: CurrentUser = Depends(get_current_user),
    is_provider: bool = Depends(caller_is_provider),
) -> CurrentUser:
    """Cagiranin tenant'i bir SAGLAYICI mi?

    Degilse 404: saglayici olmayan bir tenant'in kullanicisi icin hub ucu
    VAR DEGILDIR. 403 dondurmek, "boyle bir yuzey var ama sana kapali"
    bilgisini sizdirirdi.
    """
    require_module_enabled()
    if not is_provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )
    return current_user


def hub_scope(
    current_user: CurrentUser = Depends(require_support_surface),
    db: Session = Depends(get_support_db),
) -> visibility.HubScope:
    try:
        return visibility.resolve_hub_scope(db, current_user)
    except visibility.TicketAccessDenied as exc:
        raise translate(exc)


# =============================================================================
# Portal (actigim talepler) kapisi
# =============================================================================

def require_customer_surface(
    current_user: CurrentUser = Depends(get_current_user),
    links: Tuple[network.ProviderLink, ...] = Depends(caller_links),
) -> CurrentUser:
    """Musteri portali: talep agi baglantisi OLAN her tenant.

    Baglantisi olmayan tenant icin portal ucu yoktur (404). Bir tenant
    hem saglayici hem talep eden olabilir (iki sekme); saglayicinin
    KENDINE baglantisi ise semada yasaktir.
    """
    require_module_enabled()
    if not links:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )
    return current_user


def requested_provider(request: Request) -> Optional[str]:
    return (
        request.query_params.get(PROVIDER_PARAM)
        or request.headers.get(PROVIDER_HEADER)
        or None
    )


def network_http_error(exc: network.NetworkError) -> HTTPException:
    if exc.code == "provider_required":
        return HTTPException(
            status_code=exc.status, detail=str(exc),
            headers={ERROR_CODE_HEADER: exc.code},
        )
    return http_error(exc.code, str(exc))


def portal_provider(
    request: Request,
    current_user: CurrentUser = Depends(require_customer_surface),
    links: Tuple[network.ProviderLink, ...] = Depends(caller_links),
) -> network.ProviderLink:
    """Bu portal isteginin saglayicisi (baglanti kumesinden)."""
    try:
        return network.resolve_provider(list(links), requested_provider(request))
    except network.NetworkError as exc:
        raise network_http_error(exc)


def get_portal_db(
    link: network.ProviderLink = Depends(portal_provider),
) -> Generator[Session, None, None]:
    """PORTAL oturumu: cozulmus saglayicinin verisi (dar gecit)."""
    if not link.available:
        raise http_error(
            "support_not_configured",
            "This support provider is not available right now.",
        )
    try:
        with support.provider_session(link.provider_tenant_id) as db:
            yield db
    except support.SupportNotConfigured as exc:
        raise http_error("support_not_configured", str(exc))
