# =============================================================================
# HERMES Support API — grup katalogu + route dogrulama (04 §3/§4)
# =============================================================================
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from ...models.user_group import UserGroup as Group
from ...services import ticket_routing
from ..deps import get_support_db, require_scopes
from ..schemas import (
    RouteValidateIn,
    RouteValidateOut,
    RoutingGroupItem,
    RoutingGroupsOut,
)

router = APIRouter(prefix="/v1/support", tags=["Support catalog"])


@router.get("/routing-groups", response_model=RoutingGroupsOut)
def routing_groups(
    request: Request,
    response: Response,
    scope=Depends(require_scopes("support:groups:read")),
    db: Session = Depends(get_support_db),
):
    """Duosis'in AKTIF support gruplari — yalnizca ad + aktif uye SAYISI.

    Uye kimlikleri/e-postalari DONMEZ (04 §3): platform yoneticisinin
    dogru ekibi secmesi icin isim yeterlidir; Duosis'in kim oldugunu
    bilmesine gerek yoktur.

    Tenant parametresi KABUL EDILMEZ: katalog her zaman ve yalnizca
    support tenant'inindir.
    """
    items, version = ticket_routing.routing_group_catalog(db)
    etag = f'W/"{version}"'
    if request.headers.get("if-none-match") == etag:
        # Agresif polling ucuzlar: degismediyse govde gonderilmez.
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, max-age=60"
    return RoutingGroupsOut(
        items=[RoutingGroupItem(**item) for item in items],
        catalog_version=version,
    )


@router.post("/routes/validate", response_model=RouteValidateOut)
def validate_route(
    payload: RouteValidateIn,
    scope=Depends(require_scopes("support:groups:read")),
    db: Session = Depends(get_support_db),
):
    """Platform admin'in "kaydet/test et" cagrisi.

    Bu uc TEK BASINA Hermes'te route OTORITESI OLUSTURMAZ (04 §4): bir
    seyi dogrular, bir sey KURMAZ. Canonical route, Duosis tarafinda
    `tickets.config.manage` ile atanir. Boylece bir kaynak uygulama,
    kendi kendine bir Duosis ekibini hedef secemez.
    """
    group = db.get(Group, payload.group_id)
    group_active = bool(group and group.is_active)

    src = ticket_routing.get_source_tenant(
        db, application_id=scope.application_id,
        source_tenant_id=payload.source_tenant.id,
    )
    route = (
        ticket_routing.active_route(db, source_tenant_row_id=src.id)
        if src else None
    )
    configured = bool(route and route.group_id == payload.group_id)

    reason = None
    if not group_active:
        reason = "group_inactive"
    elif src is None:
        reason = "source_tenant_unknown"
    elif route is None:
        reason = "route_missing"
    elif not configured:
        reason = "route_group_mismatch"

    return RouteValidateOut(
        valid=bool(group_active and configured),
        group_active=group_active,
        group_name=group.name if group else None,
        source_tenant_known=src is not None,
        route_configured=route is not None,
        route_version=int(route.route_version) if route else None,
        reason=reason,
    )
