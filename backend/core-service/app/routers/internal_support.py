# =============================================================================
# HERMES core — Tenant destek yonlendirmesi (S2S, Platform Admin icin)
# =============================================================================
# Platform Admin konsolu auth-service'te yasar ve `aud=hermes-platform-admin`
# token'i tasir. core-service bu audience'i YAPISAL OLARAK KABUL ETMEZ
# (shared/auth.py: "Platform oturumu buradan GECEMEZ") ve bu sinir bilincli:
# platform operatoru tenant IS VERISINE otomatik erisemez.
#
# Ama yonlendirme KONFIGURASYONU core_db'de yasiyor. Cozum, o siniri
# delmek DEGIL, mevcut `/internal/tenants` desenini tekrarlamak: auth
# S2S credential'i ile bu dar uclara gelir, core yalnizca KONFIGURASYON
# doner. Ticket ICERIGI bu router'dan ASLA cikmaz (05: "Platform
# navigasyonuna ticket icerik inbox'i eklenmez").
#
# Neden auth uzerinden: platform izinlerinin otoritesi auth-service'tir
# (`platform_admins`). Core'un o katalogu ikinci kez cozmesi, ayni
# karari iki yerde vermek olurdu.
# =============================================================================

from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..models.user_group import UserGroup
from ..services import support_tenant as support
from ..services import ticket_routing
from ..services.ticket_service import TicketValidationError
from .internal_tenants import require_s2s

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/support", tags=["Internal"])


# =============================================================================
# Semalar
# =============================================================================

class GroupOut(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    member_count: int


class ProviderOut(BaseModel):
    """Ticket'in GIDECEGI destek saglayicisi.

    Bugun TEK bir saglayici var (yapilandirilmis Duosis support
    tenant'i) ve liste bilerek TEK ELEMANLIDIR — cok saglayicili
    dunyaya gecildiginde bu ucun SEKLI degismesin diye liste olarak
    modellendi. Ekran da dropdown cizer; yarin ikinci saglayici
    eklendiginde arayuz aynen calisir.
    """

    tenant_id: UUID
    slug: Optional[str] = None
    groups: List[GroupOut] = Field(default_factory=list)


class ProvidersResponse(BaseModel):
    items: List[ProviderOut]
    module_state: str


class RoutingOut(BaseModel):
    tenant_id: str
    display_name: Optional[str] = None
    enabled: bool
    provider_tenant_id: Optional[UUID] = None
    group_id: Optional[UUID] = None
    group_name: Optional[str] = None
    group_active: Optional[bool] = None
    route_version: Optional[int] = None
    updated_at: Optional[str] = None


class RoutingListResponse(BaseModel):
    items: List[RoutingOut]


class RoutingUpsert(BaseModel):
    provider_tenant_id: UUID
    group_id: UUID
    display_name: Optional[str] = Field(None, max_length=200)


# =============================================================================
# Yardimcilar
# =============================================================================

def _require_module() -> str:
    try:
        return support.require_available()
    except support.SupportNotConfigured as exc:
        # 503: yapilandirma eksik, istek hatali degil.
        raise HTTPException(status_code=503, detail=str(exc))


def _hermes_application(db):
    settings = get_settings()
    return ticket_routing.require_application(
        db, settings.SUPPORT_HERMES_APPLICATION_CODE
    )


def _iso(value):
    return value.isoformat() if value is not None else None


# =============================================================================
# Uclar
# =============================================================================

@router.get(
    "/providers",
    response_model=ProvidersResponse,
    summary="Destek saglayicilari ve ekipleri (S2S)",
    dependencies=[Depends(require_s2s)],
)
def list_providers() -> ProvidersResponse:
    """Ticket'in gonderilebilecegi saglayicilar ve her birinin AKTIF
    ekipleri. Uye KIMLIKLERI donmez — yalnizca ad ve aktif uye sayisi
    (04 §3 veri minimizasyonu)."""
    state, _detail = support.module_state()
    if state != "ok":
        return ProvidersResponse(items=[], module_state=state)

    tenant_id = support.support_tenant_id()
    with support.support_session() as db:
        items, _version = ticket_routing.routing_group_catalog(db)
        slug = db.execute(
            text(
                "SELECT slug FROM tenant_registry "
                " WHERE tenant_id = CAST(:t AS uuid)"
            ),
            {"t": tenant_id},
        ).scalar()
        groups = [
            GroupOut(
                id=item["id"], name=item["name"],
                description=item.get("description"),
                member_count=int(item.get("member_count", 0)),
            )
            for item in items
        ]
    return ProvidersResponse(
        items=[ProviderOut(tenant_id=tenant_id, slug=slug, groups=groups)],
        module_state=state,
    )


@router.get(
    "/routing",
    response_model=RoutingListResponse,
    summary="Tenant basina destek yonlendirmesi (S2S)",
    dependencies=[Depends(require_s2s)],
)
def list_routing() -> RoutingListResponse:
    """YALNIZCA `hermes` uygulamasinin kaynak tenant'lari.

    LogiSlot gibi DIS uygulamalarin tenant'lari bu listede YOKTUR: onlar
    Duosis tarafindaki `/tickets/admin` ekranindan yonetilir. Iki yuzeyi
    ayirmak bilincli — platform operatoru Hermes tenant'larini,
    Duosis destek yoneticisi dis entegrasyonlari yonetir.
    """
    _require_module()
    out: List[RoutingOut] = []
    with support.support_session() as db:
        app = _hermes_application(db)
        for src in ticket_routing.list_source_tenants(
            db, application_id=app.id
        ):
            route = ticket_routing.active_route(
                db, source_tenant_row_id=src.id
            )
            group = db.get(UserGroup, route.group_id) if route else None
            out.append(RoutingOut(
                tenant_id=src.source_tenant_id,
                display_name=src.display_name,
                enabled=bool(route and group and group.is_active),
                provider_tenant_id=(
                    support.support_tenant_id() if route else None
                ),
                group_id=route.group_id if route else None,
                group_name=group.name if group else None,
                group_active=bool(group.is_active) if group else None,
                route_version=int(route.route_version) if route else None,
                updated_at=_iso(route.updated_at) if route else None,
            ))
    return RoutingListResponse(items=out)


@router.put(
    "/routing/{tenant_id}",
    response_model=RoutingOut,
    summary="Tenant'in destek yonlendirmesini ayarla (S2S)",
    dependencies=[Depends(require_s2s)],
)
def set_routing(tenant_id: str, payload: RoutingUpsert) -> RoutingOut:
    """Tenant'a ticket acma yetkisi verir: mapping + AKTIF route.

    Route degisikligi YALNIZCA yeni ticket'lari etkiler; mevcut
    ticket'lar topluca TASINMAZ (02 §5).
    """
    configured = _require_module()

    # Bugun tek saglayici var; istekteki deger DOGRULANIR, sessizce
    # duzeltilmez. Yanlis saglayiciya yonlendirme, ticket'in yanlis
    # sirkete gitmesi demektir.
    if str(payload.provider_tenant_id) != configured:
        raise HTTPException(
            status_code=400,
            detail="Unknown support provider for this deployment.",
        )
    # Saglayici KENDINE ticket acamaz: support tenant'inda musteri
    # portali zaten yoktur (o tenant hub yuzeyini gorur).
    if str(tenant_id) == configured:
        raise HTTPException(
            status_code=400,
            detail="The support workspace cannot route tickets to itself.",
        )

    with support.support_session() as db:
        app = _hermes_application(db)
        group = db.get(UserGroup, payload.group_id)
        if group is None or not group.is_active:
            raise HTTPException(
                status_code=409,
                detail="The selected team is not active.",
            )
        try:
            src = ticket_routing.ensure_source_tenant(
                db, application=app, source_tenant_id=str(tenant_id),
                display_name=payload.display_name or str(tenant_id),
            )
            route = ticket_routing.set_route(
                db, source_tenant=src, group=group,
                actor_type="platform_admin", actor_id=None,
            )
        except TicketValidationError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        result = RoutingOut(
            tenant_id=src.source_tenant_id,
            display_name=src.display_name,
            enabled=True,
            provider_tenant_id=configured,
            group_id=route.group_id,
            group_name=group.name,
            group_active=True,
            route_version=int(route.route_version),
            updated_at=_iso(route.updated_at),
        )
    logger.info(
        "support routing set tenant=%s route_version=%s",
        tenant_id, result.route_version,
    )
    return result


@router.delete(
    "/routing/{tenant_id}",
    response_model=RoutingOut,
    summary="Tenant'in destek yonlendirmesini kapat (S2S)",
    dependencies=[Depends(require_s2s)],
)
def disable_routing(tenant_id: str) -> RoutingOut:
    """Yonlendirmeyi PASIFE alir — kayit SILINMEZ.

    Mevcut ticket'lar yerinde kalir ve gorunmeye devam eder; yalnizca
    YENI ticket acilamaz. Silmek, gecmis yonlendirme bilgisini yok
    ederdi.
    """
    _require_module()
    with support.support_session() as db:
        app = _hermes_application(db)
        src = ticket_routing.get_source_tenant(
            db, application_id=app.id, source_tenant_id=str(tenant_id)
        )
        if src is None:
            raise HTTPException(
                status_code=404, detail="This workspace has no routing."
            )
        ticket_routing.deactivate_route(db, source_tenant=src)
        result = RoutingOut(
            tenant_id=src.source_tenant_id,
            display_name=src.display_name,
            enabled=False,
        )
    logger.info("support routing disabled tenant=%s", tenant_id)
    return result
