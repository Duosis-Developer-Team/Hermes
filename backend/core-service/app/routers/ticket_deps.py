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
from typing import Generator, Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user

from ..services import support_tenant as support
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
# Support tenant oturumu
# =============================================================================

def get_support_db() -> Generator[Optional[Session], None, None]:
    """Canonical ticket verisine erisen TEK oturum.

    `support_session()` tenant'i SUNUCU KONFIGURASYONUNDAN alir; istek
    govdesindeki hicbir deger bu baglami degistiremez.

    Modul yapilandirilmamissa `None` doner — HATA FIRLATMAZ. Nedeni:
    yuzey kapilari (`require_support_surface` / `require_customer_surface`
    / `_support_admin`) zaten `require_module_enabled()` cagirir ve
    daha anlamli bir 503 uretir; ayrica `/tickets/context` ucu, modul
    kapaliyken de CEVAP VEREBILMEK zorundadir (frontend "yuzey yok"
    durumunu bu yanittan ogrenir). Bos liste donmek gibi sessiz bir
    ariza YOKTUR: db None iken hicbir sorgu calismaz.
    """
    if not support.is_available():
        yield None
        return
    try:
        with support.support_session() as db:
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
# Hub (Duosis agent) kapisi
# =============================================================================

def require_support_surface(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Cagiran Duosis support tenant'inda mi?

    Degilse 404: baska bir tenant'in kullanicisi icin hub ucu VAR
    DEGILDIR. 403 dondurmek, "boyle bir yuzey var ama sana kapali"
    bilgisini sizdirirdi.
    """
    require_module_enabled()
    if not support.is_support_tenant(current_user.tenant_id):
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


def require_customer_surface(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Musteri portali: support tenant'i DISINDAKI her tenant.

    Support tenant'inin kendi kullanicilari portali kullanmaz — onlarin
    yuzeyi hub'dir. Iki yuzeyin ayni tenant'ta ust uste binmesi,
    "kendi kendine ticket acan destek ekibi" gibi kafa karistirici bir
    duruma yol acardi.
    """
    require_module_enabled()
    if support.is_support_tenant(current_user.tenant_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )
    return current_user
