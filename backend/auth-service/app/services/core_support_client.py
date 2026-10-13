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
    """core-service destek konfigurasyon cagrisi basarisiz.

    `code` core'un makine-okur kodudur (version_conflict, group_inactive,
    provider_unavailable, self_link ...); ekran ona gore mesaj secer."""

    def __init__(self, message: str, status_code: int = 502,
                 code: Optional[str] = None):
        self.status_code = status_code
        self.code = code
        super().__init__(message)

    def as_detail(self) -> Dict[str, Any]:
        return {"code": self.code or "support_error", "message": str(self)}


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
        detail, code = None, None
        try:
            body = response.json()
            detail = body.get("detail") if isinstance(body, dict) else None
        except Exception:  # noqa: BLE001
            detail = None
        if isinstance(detail, dict):
            code = detail.get("code")
            detail = detail.get("message")
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
            code=code,
        )
    return response.json()


def list_providers() -> Dict[str, Any]:
    return _request("GET", "/providers")


def list_network() -> Dict[str, Any]:
    return _request("GET", "/network")


def set_link(
    requester_tenant_id: str, provider_tenant_id: str, *, group_id: str,
    requester_display_name: Optional[str] = None,
    provider_display_name: Optional[str] = None,
    expected_version: Optional[int] = None,
    actor_id: Optional[str] = None,
) -> Dict[str, Any]:
    return _request(
        "PUT", f"/network/{requester_tenant_id}/{provider_tenant_id}",
        json_body={
            "group_id": group_id,
            "requester_display_name": requester_display_name,
            "provider_display_name": provider_display_name,
            "expected_version": expected_version,
            "actor_id": actor_id,
        },
    )


def disable_link(
    requester_tenant_id: str, provider_tenant_id: str, *,
    expected_version: Optional[int] = None, actor_id: Optional[str] = None,
) -> Dict[str, Any]:
    query = []
    if expected_version is not None:
        query.append(f"expected_version={int(expected_version)}")
    if actor_id:
        query.append(f"actor_id={actor_id}")
    suffix = ("?" + "&".join(query)) if query else ""
    return _request(
        "DELETE",
        f"/network/{requester_tenant_id}/{provider_tenant_id}{suffix}",
    )
