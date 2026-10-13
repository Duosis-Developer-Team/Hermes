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

from shared.modules import Module

from ..config import get_settings
from ..models.user_group import UserGroup
from ..services import support_tenant as support
from ..services import ticket_network as network
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
    """Talep alabilecek bir saglayici (tickets modulu acik, calisir) ve
    AKTIF ekipleri. Uye KIMLIKLERI donmez — yalnizca ad ve sayi."""

    tenant_id: UUID
    slug: Optional[str] = None
    is_support_tenant: bool = False
    groups: List[GroupOut] = Field(default_factory=list)


class ProvidersResponse(BaseModel):
    items: List[ProviderOut]
    module_state: str


class LinkOut(BaseModel):
    requester_tenant_id: str
    requester_display_name: Optional[str] = None
    provider_tenant_id: str
    provider_display_name: Optional[str] = None
    is_active: bool
    group_id: Optional[UUID] = None
    group_name: Optional[str] = None
    group_active: Optional[bool] = None
    route_version: Optional[int] = None
    version: int
    provider_available: bool = True
    requester_has_tickets: bool = True
    updated_at: Optional[str] = None


class LinkListResponse(BaseModel):
    items: List[LinkOut]
    module_state: str


class LinkUpsert(BaseModel):
    group_id: UUID
    requester_display_name: Optional[str] = Field(None, max_length=200)
    provider_display_name: Optional[str] = Field(None, max_length=200)
    expected_version: Optional[int] = None
    actor_id: Optional[str] = Field(None, max_length=64)


# =============================================================================
# Yardimcilar
# =============================================================================

def _require_module() -> str:
    try:
        return support.require_available()
    except support.SupportNotConfigured as exc:
        # 503: yapilandirma eksik, istek hatali degil.
        raise HTTPException(status_code=503, detail=str(exc))


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"code": code, "message": message}
    )


def _uuid(value) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise _error(400, "invalid_tenant", "Invalid tenant id.")


def _iso(value):
    return value.isoformat() if value is not None else None


def _hermes_application(db):
    return ticket_routing.ensure_application(
        db, code=get_settings().SUPPORT_HERMES_APPLICATION_CODE,
        display_name="Hermes",
    )


def _team(db, requester: str):
    """Saglayici oturumunda talep edenin AKTIF route'u + ekibi."""
    app = ticket_routing.get_application(
        db, get_settings().SUPPORT_HERMES_APPLICATION_CODE
    )
    if app is None:
        return None, None
    src = ticket_routing.get_source_tenant(
        db, application_id=app.id, source_tenant_id=requester
    )
    route = (
        ticket_routing.active_route(db, source_tenant_row_id=src.id)
        if src is not None else None
    )
    group = db.get(UserGroup, route.group_id) if route else None
    return route, group


def _registry(db, tenant_ids) -> dict:
    """tenant_id → (status, modules) — projeksiyondan."""
    ids = [str(t) for t in tenant_ids]
    if not ids:
        return {}
    rows = db.execute(text(
        "SELECT tenant_id, status, enabled_modules FROM tenant_registry "
        " WHERE tenant_id = ANY(CAST(:ids AS uuid[]))"
    ), {"ids": ids}).all()
    return {
        str(r[0]): (r[1], r[2] if isinstance(r[2], list) else [])
        for r in rows
    }


def _link_out(link, route, group, registry) -> LinkOut:
    req = registry.get(str(link.requester_tenant_id), (None, []))
    prov = registry.get(str(link.provider_tenant_id), (None, []))
    return LinkOut(
        requester_tenant_id=str(link.requester_tenant_id),
        requester_display_name=link.requester_display_name,
        provider_tenant_id=str(link.provider_tenant_id),
        provider_display_name=link.provider_display_name,
        is_active=bool(link.is_active),
        group_id=route.group_id if route else None,
        group_name=group.name if group else None,
        group_active=bool(group.is_active) if group else None,
        route_version=int(route.route_version) if route else None,
        version=int(link.version),
        provider_available=(
            prov[0] in support.RUNNABLE_TENANT_STATUSES
            and Module.TICKETS in prov[1]
        ),
        requester_has_tickets=Module.TICKETS in req[1],
        updated_at=_iso(link.updated_at),
    )


# =============================================================================
# Uclar
# =============================================================================

@router.get(
    "/providers",
    response_model=ProvidersResponse,
    summary="Talep alabilecek saglayicilar ve ekipleri (S2S)",
    dependencies=[Depends(require_s2s)],
)
def list_providers() -> ProvidersResponse:
    """Tickets modulu ACIK ve calisir durumdaki her tenant + AKTIF ekipleri.
    Uye KIMLIKLERI donmez (04 §3 veri minimizasyonu)."""
    state, _detail = support.module_state()
    if state != "ok":
        return ProvidersResponse(items=[], module_state=state)

    with support.global_session() as gdb:
        rows = gdb.execute(text(
            "SELECT tenant_id, slug FROM tenant_registry "
            " WHERE status = ANY(:st) "
            "   AND enabled_modules ? :m ORDER BY slug"
        ), {"st": list(support.RUNNABLE_TENANT_STATUSES),
            "m": Module.TICKETS}).all()
    items: List[ProviderOut] = []
    for tenant_id, slug in rows:
        try:
            with support.provider_session(tenant_id) as db:
                catalog, _version = ticket_routing.routing_group_catalog(db)
        except support.SupportNotConfigured:
            continue
        items.append(ProviderOut(
            tenant_id=tenant_id, slug=slug,
            is_support_tenant=support.is_support_tenant(tenant_id),
            groups=[
                GroupOut(
                    id=g["id"], name=g["name"],
                    description=g.get("description"),
                    member_count=int(g.get("member_count", 0)),
                )
                for g in catalog
            ],
        ))
    # Yapilandirilmis destek tenant'i (dis entegrasyonlarin saglayicisi)
    # listenin basinda.
    items.sort(key=lambda p: (not p.is_support_tenant, p.slug or ""))
    return ProvidersResponse(items=items, module_state=state)


@router.get(
    "/network",
    response_model=LinkListResponse,
    summary="Talep agi baglantilari (S2S)",
    dependencies=[Depends(require_s2s)],
)
def list_network() -> LinkListResponse:
    """Tum baglantilar + saglayici tarafindaki varsayilan ekip.

    Yalnizca KONFIGURASYON doner; talep icerigi bu router'dan cikmaz.
    """
    state, _detail = support.module_state()
    if state != "ok":
        return LinkListResponse(items=[], module_state=state)
    with support.global_session() as gdb:
        links = network.list_links(gdb)
        for link in links:
            gdb.expunge(link)
        registry = _registry(
            gdb,
            {l.requester_tenant_id for l in links}
            | {l.provider_tenant_id for l in links},
        )
    by_provider: dict = {}
    for link in links:
        by_provider.setdefault(str(link.provider_tenant_id), []).append(link)
    out: List[LinkOut] = []
    for provider, group_links in by_provider.items():
        with support.provider_session(provider, require_runnable=False) as db:
            for link in group_links:
                route, group = _team(db, str(link.requester_tenant_id))
                out.append(_link_out(link, route, group, registry))
    out.sort(key=lambda l: (
        (l.requester_display_name or "").lower(),
        (l.provider_display_name or "").lower(),
    ))
    return LinkListResponse(items=out, module_state=state)


@router.put(
    "/network/{requester_tenant_id}/{provider_tenant_id}",
    response_model=LinkOut,
    summary="Baglanti kur / ekibi degistir / yeniden ac (S2S)",
    dependencies=[Depends(require_s2s)],
)
def upsert_network_link(
    requester_tenant_id: str, provider_tenant_id: str, payload: LinkUpsert,
) -> LinkOut:
    """Talep edeni saglayiciya baglar: global indeks + saglayici verisinde
    kaynak tenant eslemesi + AKTIF route — TEK transaction.

    Ekip degisikligi YALNIZCA yeni talepleri etkiler (02 §5).
    """
    _require_module()
    requester = _uuid(requester_tenant_id)
    provider = _uuid(provider_tenant_id)
    if requester == provider:
        raise _error(400, "self_link",
                     "A workspace cannot open tickets to itself.")
    with support.global_session() as gdb:
        registry = _registry(gdb, [requester, provider])
    if requester not in registry or provider not in registry:
        raise _error(404, "unknown_tenant", "Unknown workspace.")
    try:
        with support.provider_session(provider) as db:
            link = network.get_link(db, requester, provider)
            if link is not None:
                try:
                    network.check_link_version(link, payload.expected_version)
                except network.NetworkError as exc:
                    raise _error(exc.status, exc.code, str(exc))
            group = db.get(UserGroup, payload.group_id)
            if group is None or not group.is_active:
                raise _error(409, "group_inactive",
                             "The selected team is not active.")
            app = _hermes_application(db)
            try:
                src = ticket_routing.ensure_source_tenant(
                    db, application=app, source_tenant_id=requester,
                    display_name=payload.requester_display_name or requester,
                )
                route = ticket_routing.set_route(
                    db, source_tenant=src, group=group,
                    actor_type="platform_admin", actor_id=payload.actor_id,
                )
            except TicketValidationError as exc:
                raise _error(409, exc.code, str(exc))
            link = network.upsert_link(
                db, requester=requester, provider=provider, active=True,
                actor=payload.actor_id,
                requester_name=payload.requester_display_name,
                provider_name=payload.provider_display_name,
            )
            result = _link_out(link, route, group, registry)
    except support.SupportNotConfigured:
        raise _error(
            409, "provider_unavailable",
            "The provider workspace must be active with the Tickets module "
            "enabled.",
        )
    logger.info(
        "ticket network link set requester=%s provider=%s route_version=%s",
        requester, provider, result.route_version,
    )
    return result


@router.delete(
    "/network/{requester_tenant_id}/{provider_tenant_id}",
    response_model=LinkOut,
    summary="Baglantiyi kapat (S2S)",
    dependencies=[Depends(require_s2s)],
)
def deactivate_network_link(
    requester_tenant_id: str, provider_tenant_id: str,
    expected_version: Optional[int] = None,
    actor_id: Optional[str] = None,
) -> LinkOut:
    """Baglantiyi PASIFE alir — kayit SILINMEZ.

    Mevcut talepler iki tarafta da gorunmeye devam eder; yalnizca YENI
    talep acilamaz. Saglayicinin modulu kapali olsa da calisir.
    """
    _require_module()
    requester = _uuid(requester_tenant_id)
    provider = _uuid(provider_tenant_id)
    with support.global_session() as gdb:
        registry = _registry(gdb, [requester, provider])
    with support.provider_session(provider, require_runnable=False) as db:
        link = network.get_link(db, requester, provider)
        if link is None:
            raise _error(404, "not_found", "This connection does not exist.")
        try:
            network.check_link_version(link, expected_version)
        except network.NetworkError as exc:
            raise _error(exc.status, exc.code, str(exc))
        app = ticket_routing.get_application(
            db, get_settings().SUPPORT_HERMES_APPLICATION_CODE
        )
        src = (
            ticket_routing.get_source_tenant(
                db, application_id=app.id, source_tenant_id=requester
            ) if app is not None else None
        )
        if src is not None:
            ticket_routing.deactivate_route(db, source_tenant=src)
        link = network.upsert_link(
            db, requester=requester, provider=provider, active=False,
            actor=actor_id,
        )
        result = _link_out(link, None, None, registry)
    logger.info(
        "ticket network link disabled requester=%s provider=%s",
        requester, provider,
    )
    return result
