# =============================================================================
# HERMES reporting - RBAC guard (R3)
# =============================================================================
# reporting-service'te S2S credential'i POLITIKA GEREGI yoktur (hermes-s2s
# yalnizca auth+core'da). Izin cozumu bu yuzden CAGIRANIN KENDI JWT'siyle
# auth-service /api/v1/auth/rbac/me ucundan yapilir — mevcut JWT-forward
# deseninin devami; token uydurma/turetme yok.
#
# Ayrica eski G10 curugunu kapatir: onceki kod yalnizca Authorization
# header'ina bakiyordu; cookie-auth'lu istekte require_admin gecilmis
# olmasina ragmen downstream'e BOS token gidiyordu. Token cikarimi artik
# header → cookie sirasiyla tek yerde yapilir ve guard'in dondurdugu
# deger downstream proxy'de AYNEN kullanilir.
# =============================================================================

import logging
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, Request, status

from shared.auth import CurrentUser, get_current_user
from shared.auth_upstream import normalize_auth_base_url
from shared.permissions import Perm

from .config import get_settings

logger = logging.getLogger("hermes.reporting.rbac")

_TIMEOUT = 5.0


def _extract_token(request: Request) -> str:
    """Header → cookie sirasiyla cagiranin JWT'si (core reports.py ile
    ayni davranis — G10 duzeltmesi)."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return request.cookies.get("access_token", "") or ""


class ReportsAccess:
    """Guard sonucu: dogrulanmis kullanici + downstream proxy tokeni."""

    def __init__(self, user: CurrentUser, token: str):
        self.user = user
        self.token = token


def require_reports_view():
    """reports.view iznini cagiranin JWT'siyle auth-service'ten dogrular.
    Cozum yapilamazsa 503 (fail-closed; sessiz 403 yaniltici olurdu)."""

    async def checker(
        request: Request,
        current_user: CurrentUser = Depends(get_current_user),
    ) -> ReportsAccess:
        token = _extract_token(request)
        if not token:
            # get_current_user gectiyse token bir yerden gelmistir; bu
            # dal derinlemesine savunmadir.
            raise HTTPException(status_code=401, detail="Unauthorized.")

        base = normalize_auth_base_url(get_settings().AUTH_SERVICE_URL)
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(
                    f"{base}/api/v1/auth/rbac/me",
                    headers={"Authorization": f"Bearer {token}"},
                )
        except Exception as exc:  # noqa: BLE001 — fail closed
            logger.warning("rbac me transport error class=%s",
                           type(exc).__name__)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authorization service unavailable; retry shortly.",
            )
        if resp.status_code != 200:
            logger.warning("rbac me status=%s", resp.status_code)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu işlem için yetkiniz yok.",
            )
        perms = set(resp.json().get("permissions") or [])
        if Perm.REPORTS_VIEW not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {Perm.REPORTS_VIEW}",
            )
        return ReportsAccess(current_user, token)

    checker._rbac_permissions = (Perm.REPORTS_VIEW,)  # envanter kilidi
    return checker
