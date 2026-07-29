# =============================================================================
# HERMES core - RBAC guard katmani (R2)
# =============================================================================
# require_admin'in yerini alan izin-tabanli guard'lar + servis ici
# kontrol yardimcilari. Cozum authz_client (S2S + 60 sn cache) ile
# auth-service'ten yapilir; JWT claim'i karar mercii DEGILDIR.
#
# Fail-closed semantigi IKI SEVIYELI (bilincli karar, R2):
#   - require_permissions (route guard): authz cozulemiyorsa 503 —
#     yonetim islemi belirsiz yetkiyle CALISTIRILMAZ, ama neden acikca
#     soylenir (sessiz 403 yaniltici olurdu).
#   - user_has (gorunurluk/dallanma): cozulemiyorsa False — liste ucu
#     gibi yerlerde kullanici admin-genisletmesi olmadan, kendi normal
#     kapsamiyla calismaya devam eder (hizmet kesilmez, yetki acilmaz).
#
# Route-walk kilidi icin: require_permissions'in urettigi checker'lar
# `_rbac_permissions` niteligi tasir — test, admin yuzeyindeki her
# route'un izin beyanini bu nitelik uzerinden envanterler (LogiSlot'un
# "guard'siz endpoint sessizce acik" zaafinin yapisal onlemi).
# =============================================================================

import logging

from fastapi import Depends, HTTPException, status

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm  # noqa: F401 — cagiranlar icin re-export

from .services import authz_client

logger = logging.getLogger("hermes.authz")


def user_permissions(user: CurrentUser) -> frozenset:
    """Kullanicinin efektif izinleri. Sentezlenmis public-API aktoru
    icin HIC cozum yapilmaz (bos kume). Cozum hatasi → bos kume
    (fail-closed; guard'lar 503 icin dogrudan authz_client kullanir)."""
    if not user.allow_rbac_resolution:
        return frozenset()
    try:
        return authz_client.effective_permissions(user.id)
    except authz_client.AuthzUnavailable:
        return frozenset()


def user_has(user: CurrentUser, *codes: str) -> bool:
    """Servis ici izin kontrolu (AND). Fail-closed: cozum yoksa False."""
    return set(codes) <= user_permissions(user)


def require_permissions(*codes: str):
    """Route guard factory — verilen TUM izinler gerekli. Cozum hatasi
    503 (belirsiz yetkiyle yonetim islemi calismaz)."""

    async def checker(
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if not current_user.allow_rbac_resolution:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu işlem için yetkiniz yok.",
            )
        try:
            perms = authz_client.effective_permissions(current_user.id)
        except authz_client.AuthzUnavailable:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Authorization service unavailable; retry shortly."
                ),
            )
        missing = set(codes) - perms
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Missing permissions: " + ", ".join(sorted(missing))
                ),
            )
        return current_user

    checker._rbac_permissions = tuple(sorted(codes))  # route-walk kilidi
    return checker
