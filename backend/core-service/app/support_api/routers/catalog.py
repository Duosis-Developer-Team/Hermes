# =============================================================================
# HERMES Support API — grup katalogu + route dogrulama (04 §3/§4)
# =============================================================================
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from ...models.ticketing import SupportApplication
from ...models.user_group import UserGroup as Group
from ...services import support_audit, ticket_routing
from ..deps import get_support_db, require_scopes
from ..errors import SupportAPIError
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

    IKI DAVRANIS, uygulama basina bayrakla ayrilir:

    * Bayrak KAPALI (varsayilan, 04 §4): bu uc bir seyi DOGRULAR, bir sey
      KURMAZ. Canonical route Duosis tarafinda `tickets.config.manage` ile
      atanir; boylece bir kaynak uygulama kendi kendine bir Duosis ekibini
      hedef secemez.
    * Bayrak ACIK (`capabilities_json.self_service_routing`): kaynak
      uygulama kendi tenant'i icin AKTIF gruplardan birini secebilir ve bu
      cagri route'u KURAR. Uygulama siniri yine mutlaktir (kapsam token
      kaydindan gelir), yalnizca aktif gruplar secilebilir ve her baglama
      denetime yazilir.

    Baglama YAZMA islemidir: okuma scope'u tek basina yetmez, cagiranin
    ayrica `support:tickets:write` scope'u olmalidir.
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

    application = db.get(SupportApplication, scope.application_id)
    self_service = (
        application is not None
        and ticket_routing.self_service_routing_enabled(application)
    )
    needs_binding = group_active and (
        route is None or route.group_id != payload.group_id
    )
    if self_service and needs_binding:
        if not scope.has_scope("support:tickets:write"):
            # Okuma scope'lu bir token route DEGISTIREMEZ.
            raise SupportAPIError(
                "insufficient_scope",
                "Binding a route requires the support:tickets:write scope.",
            )
        if src is None:
            src = ticket_routing.ensure_source_tenant(
                db, application=application,
                source_tenant_id=payload.source_tenant.id,
                display_name=payload.source_tenant.display_name,
                slug=payload.source_tenant.slug,
            )
            db.flush()
        route = ticket_routing.set_route(
            db, source_tenant=src, group=group,
            actor_type="integration_client", actor_id=str(scope.client_id),
        )
        db.flush()
        support_audit.record(
            db, subject_type=support_audit.SUBJECT_ROUTE,
            subject_id=str(route.id), action="route.set",
            actor_type="integration_client", actor_id=str(scope.client_id),
            actor_display_name=application.code,
            reason="self-service routing",
            metadata={"source_tenant_id": src.source_tenant_id,
                      "group": group.name,
                      "route_version": route.route_version},
        )
        # COMMIT YOK: `support_session()` istek sonunda commit eder.
        # Burada erken commit etmek transaction-local `app.tenant_id`
        # GUC'unu dusurur ve ayni istekteki sonraki okumalar RLS altinda
        # BOS doner (bu tam olarak bir kez yasandi).

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
