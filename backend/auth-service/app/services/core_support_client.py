# =============================================================================
# HERMES auth — core-service destek yonlendirme istemcisi (S2S)
# =============================================================================
# Platform Admin konsolu tenant'lara "ticket acabilme" yetkisi verir, ama
# yonlendirme KONFIGURASYONU core_db'de yasar. Platform token'i core'a
# GIREMEZ (bilincli izolasyon), bu yuzden ayni desen kullanilir:
# `tenant_provisioning._project_to_core` gibi S2S credential ile dar bir
# uca gidilir.
#
# Kurallar:
#   - Credential yalnizca `HERMES_S2S_TOKEN_CURRENT`; ASLA loglanmaz.
#   - Hata GOVDESI kullaniciya aynen verilmez; core'un sozlesme mesaji
#     varsa o gosterilir, yoksa durum koduna gore genel mesaj.
#   - Ticket ICERIGI bu istemciden gecmez — yalnizca konfigurasyon.
# =============================================================================

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

_TIMEOUT = 10.0


class CoreSupportError(RuntimeError):
    """core-service destek konfigurasyon cagrisi basarisiz."""

    def __init__(self, message: str, status_code: int = 502):
        self.status_code = status_code
        super().__init__(message)


def _base() -> str:
    return str(get_settings().HERMES_CORE_INTERNAL_BASE).rstrip("/")


def _token() -> str:
    token = getattr(get_settings(), "HERMES_S2S_TOKEN_CURRENT", "") or ""
    if not token:
        # Fail-closed: credential yoksa ekran "yapilandirilmamis" der,
        # sessizce bos liste DONMEZ.
        raise CoreSupportError(
            "Service credential is not configured; support routing is "
            "unavailable.",
            status_code=503,
        )
    return token


def _request(
    method: str, path: str, *, json_body: Optional[dict] = None
) -> Dict[str, Any]:
    url = f"{_base()}/internal/support{path}"
    try:
        response = httpx.request(
            method, url, json=json_body,
            headers={"Authorization": f"Bearer {_token()}"},
            timeout=_TIMEOUT,
        )
    except CoreSupportError:
        raise
    except Exception as exc:  # noqa: BLE001 — ag hatasi
        logger.error(
            "core support call failed class=%s path=%s",
            type(exc).__name__, path,
        )
        raise CoreSupportError(
            "The support service is unreachable.", status_code=503
        ) from exc

    if response.status_code >= 400:
        detail = None
        try:
            body = response.json()
            detail = body.get("detail") if isinstance(body, dict) else None
        except Exception:  # noqa: BLE001
            detail = None
        logger.warning(
            "core support call rejected status=%s path=%s",
            response.status_code, path,
        )
        raise CoreSupportError(
            detail or "The support service rejected the request.",
            status_code=(
                response.status_code
                if response.status_code in (400, 404, 409, 503)
                else 502
            ),
        )
    return response.json()


def list_providers() -> Dict[str, Any]:
    return _request("GET", "/providers")


def list_routing() -> Dict[str, Any]:
    return _request("GET", "/routing")


def set_routing(
    tenant_id: str, *, provider_tenant_id: str, group_id: str,
    display_name: Optional[str] = None,
) -> Dict[str, Any]:
    return _request(
        "PUT", f"/routing/{tenant_id}",
        json_body={
            "provider_tenant_id": provider_tenant_id,
            "group_id": group_id,
            "display_name": display_name,
        },
    )


def disable_routing(tenant_id: str) -> Dict[str, Any]:
    return _request("DELETE", f"/routing/{tenant_id}")
