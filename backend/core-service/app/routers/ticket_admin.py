# =============================================================================
# HERMES core — Ticket entegrasyon yonetimi (Duosis admin)
# =============================================================================
# Iki AYRI izin uzayi bilincli olarak ayrilmistir (02_HERMES §1):
#
#   tickets.config.manage → application / source tenant / route /
#                           credential KONFIGURASYONU. Ticket ICERIGI
#                           vermez.
#   tickets.admin         → tum canonical ticket'lar + teslimat
#                           operasyonu.
#
# Konfigurasyon yetkisi olan biri ticket okuyamaz; ticket admini
# credential uretemez. Ayrim, "entegrasyonu kuran" ile "destek veren"
# rollerinin ayni kisi olmak zorunda olmadigini yansitir.
#
# NOT: bu router'in yolu `/admin` icerdigi icin `test_rbac_enforcement`
# route-walk kapisi her ucun izin BEYAN ETMESINI zorunlu kilar.
# =============================================================================

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..authz import require_permissions
from ..config import get_settings
from ..models.ticketing import (
    SupportApplication,
    SupportIntegrationClient,
    SupportIntegrationToken,
    SupportSourceTenant,
    Ticket,
    TicketOutboxEvent,
)
from ..models.user_group import UserGroup
from ..schemas.ticketing import (
    ApplicationUpdateRequest,
    ApplicationUpsertRequest,
    DeliveryEventOut,
    DeliveryStatsOut,
    IntegrationClientCreateRequest,
    IntegrationClientOut,
    IntegrationClientUpdateRequest,
    IntegrationTokenCreateRequest,
    IntegrationTokenCreatedOut,
    RouteUpsertRequest,
    SourceTenantOut,
    SourceTenantUpsertRequest,
    TicketHealthOut,
)
from ..services import support_audit
from ..services import support_tenant as support
from ..services import (
    support_integration_service as integration,
    ticket_delivery_service as delivery,
    ticket_routing,
    ticket_scanner,
    ticket_serializers as ser,
    ticket_storage,
)
from ..ticket_contract import format_ticket_number
from .ticket_deps import (
    client_ip,
    correlation_id,
    get_support_db,
    http_error,
    require_module_enabled,
    translate,
)

router = APIRouter(prefix="/tickets/admin", tags=["Ticket Admin"])


def _support_admin(perm: str):
    """`require_permissions` + Duosis tenant kapisi.

    Izin beyani ic dependency'de kalir (route-walk kapisi onu bulur);
    buradaki ek kural, konfigurasyonun YALNIZCA support tenant'i
    icinden yapilabilmesidir.
    """

    async def checker(
        current_user: CurrentUser = Depends(require_permissions(perm)),
    ) -> CurrentUser:
        require_module_enabled()
        if not support.is_support_tenant(current_user.tenant_id):
            raise http_error(
                "forbidden",
                "Support integration configuration is managed inside "
                "the Duosis support workspace.",
            )
        return current_user

    return checker


def _audit_actor(user: CurrentUser, request: Request) -> dict:
    return {
        "actor_type": "support_agent",
        "actor_id": str(user.id),
        "actor_display_name": user.email,
        "correlation_id": correlation_id(request),
        "source_ip": client_ip(request),
    }


# =============================================================================
# Applications
# =============================================================================

@router.get("/applications")
def list_applications(
    include_disabled: bool = Query(True),
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    rows = ticket_routing.list_applications(
        db, include_disabled=include_disabled
    )
    return [
        {
            "id": str(row.id),
            "code": row.code,
            "display_name": row.display_name,
            "description": row.description,
            "status": row.status,
            "environment": row.environment,
            "callback_url": row.callback_url,
            "webhook_key_id": row.webhook_key_id,
            # Sirrin KENDISI donmez; yalnizca "tanimli mi?" bilgisi.
            "signing_secret_configured": bool(
                delivery.webhook_secret(row.code)
            ),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


@router.post("/applications", status_code=201)
def create_application(
    payload: ApplicationUpsertRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    existing = ticket_routing.get_application(db, payload.code)
    if existing is not None:
        raise http_error(
            "conflict",
            "An application with this code already exists in this "
            "environment.",
        )
    app = ticket_routing.ensure_application(
        db, code=payload.code, display_name=payload.display_name,
        description=payload.description,
    )
    if payload.callback_url:
        _set_callback(app, payload.callback_url)
    app.webhook_key_id = payload.webhook_key_id or "v1"
    app.created_by_user_id = UUID(str(admin.id))
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_APPLICATION,
        subject_id=str(app.id), action="application.created",
        metadata={"code": app.code}, **_audit_actor(admin, request),
    )
    return {"id": str(app.id), "code": app.code}


def _set_callback(app: SupportApplication, url: Optional[str]) -> None:
    if not url:
        app.callback_url = None
        return
    try:
        delivery.validate_callback_url(url)
    except delivery.DeliveryConfigError as exc:
        # SSRF kapisi KAYIT anindadir: private/loopback/metadata hedefi
        # olan bir callback hic yazilamaz.
        raise http_error(
            "validation_error",
            f"This callback URL is not accepted ({exc}).",
        )
    app.callback_url = url


@router.patch("/applications/{application_id}")
def update_application(
    application_id: UUID,
    payload: ApplicationUpdateRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    app = db.get(SupportApplication, application_id)
    if app is None:
        raise http_error("not_found", "Application not found.")
    changed = {}
    if payload.display_name is not None:
        app.display_name = payload.display_name
        changed["display_name"] = True
    if payload.description is not None:
        app.description = payload.description
    if payload.callback_url is not None:
        _set_callback(app, payload.callback_url or None)
        changed["callback_url"] = True
    if payload.webhook_key_id is not None:
        app.webhook_key_id = payload.webhook_key_id
        changed["webhook_key_id"] = True
    if payload.status is not None:
        app.status = payload.status
        changed["status"] = payload.status
    app.updated_by_user_id = UUID(str(admin.id))
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_APPLICATION,
        subject_id=str(app.id), action="application.updated",
        metadata={"code": app.code, "changed": sorted(changed)},
        **_audit_actor(admin, request),
    )
    return {"id": str(app.id), "status": app.status}


# =============================================================================
# Source tenants + routes
# =============================================================================

@router.get("/source-tenants", response_model=List[SourceTenantOut])
def list_source_tenants(
    application_id: Optional[UUID] = Query(None),
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    rows = ticket_routing.list_source_tenants(
        db, application_id=application_id
    )
    out = []
    for row in rows:
        route = ticket_routing.active_route(db, source_tenant_row_id=row.id)
        group = db.get(UserGroup, route.group_id) if route else None
        out.append(SourceTenantOut(
            id=row.id, application_id=row.application_id,
            source_tenant_id=row.source_tenant_id,
            source_tenant_slug=row.source_tenant_slug,
            display_name=row.display_name, status=row.status,
            route=ser.route_out(route, group.name if group else None)
            if route else None,
        ))
    return out


@router.post("/source-tenants", status_code=201)
def upsert_source_tenant(
    payload: SourceTenantUpsertRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    app = db.get(SupportApplication, payload.application_id)
    if app is None:
        raise http_error("not_found", "Application not found.")
    row = ticket_routing.ensure_source_tenant(
        db, application=app, source_tenant_id=payload.source_tenant_id,
        display_name=payload.display_name,
        slug=payload.source_tenant_slug,
    )
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_SOURCE_TENANT,
        subject_id=str(row.id), action="source_tenant.upserted",
        metadata={"application_code": app.code,
                  "source_tenant_id": row.source_tenant_id},
        **_audit_actor(admin, request),
    )
    return {"id": str(row.id)}


@router.put("/source-tenants/{source_tenant_row_id}/route")
def set_route(
    source_tenant_row_id: UUID,
    payload: RouteUpsertRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    """Kaynak tenant icin AKTIF hedef grubu belirler.

    Route degisikligi YALNIZCA yeni ticket'lari etkiler; mevcut
    ticket'lar topluca tasinmaz (02 §5).
    """
    src = db.get(SupportSourceTenant, source_tenant_row_id)
    if src is None:
        raise http_error("not_found", "Source workspace not found.")
    group = db.get(UserGroup, payload.group_id)
    if group is None or not group.is_active:
        raise http_error(
            "group_inactive", "The selected group is not active."
        )
    route = ticket_routing.set_route(
        db, source_tenant=src, group=group,
        actor_type="support_agent", actor_id=str(admin.id),
    )
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_ROUTE,
        subject_id=str(route.id), action="route.set",
        metadata={"source_tenant_id": src.source_tenant_id,
                  "group": group.name,
                  "route_version": route.route_version},
        **_audit_actor(admin, request),
    )
    return ser.route_out(route, group.name)


@router.delete("/source-tenants/{source_tenant_row_id}/route")
def disable_route(
    source_tenant_row_id: UUID,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    src = db.get(SupportSourceTenant, source_tenant_row_id)
    if src is None:
        raise http_error("not_found", "Source workspace not found.")
    route = ticket_routing.deactivate_route(db, source_tenant=src)
    if route is None:
        raise http_error("not_found", "No active route to disable.")
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_ROUTE,
        subject_id=str(route.id), action="route.disabled",
        metadata={"source_tenant_id": src.source_tenant_id},
        **_audit_actor(admin, request),
    )
    return {"id": str(route.id), "is_active": False}


# =============================================================================
# Integration credential'lari
# =============================================================================

@router.get("/integration-clients",
            response_model=List[IntegrationClientOut])
def list_integration_clients(
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    clients = integration.list_clients(db)
    apps = {
        row.id: row.code
        for row in db.query(SupportApplication).all()
    }
    return [
        ser.integration_client_out(
            client, application_code=apps.get(client.application_id),
            tokens=integration.list_tokens(db, client.id),
        )
        for client in clients
    ]


@router.post("/integration-clients", status_code=201,
             response_model=IntegrationClientOut)
def create_integration_client(
    payload: IntegrationClientCreateRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    app = db.get(SupportApplication, payload.application_id)
    if app is None:
        raise http_error("not_found", "Application not found.")
    try:
        client = integration.create_client(
            db, application=app, name=payload.name,
            scopes=payload.scopes, description=payload.description,
            rate_limit_per_min=payload.rate_limit_per_min,
            created_by_user_id=UUID(str(admin.id)),
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_CREDENTIAL,
        subject_id=str(client.id), action="integration_client.created",
        metadata={"application_code": app.code,
                  "scopes": list(client.scopes or [])},
        **_audit_actor(admin, request),
    )
    return ser.integration_client_out(
        client, application_code=app.code, tokens=[]
    )


@router.patch("/integration-clients/{client_id}",
              response_model=IntegrationClientOut)
def update_integration_client(
    client_id: UUID,
    payload: IntegrationClientUpdateRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    client = db.get(SupportIntegrationClient, client_id)
    if client is None:
        raise http_error("not_found", "Integration client not found.")
    try:
        integration.update_client(
            db, client, scopes=payload.scopes, status=payload.status,
            rate_limit_per_min=payload.rate_limit_per_min,
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_CREDENTIAL,
        subject_id=str(client.id), action="integration_client.updated",
        metadata={"status": client.status,
                  "scopes": list(client.scopes or [])},
        **_audit_actor(admin, request),
    )
    app = db.get(SupportApplication, client.application_id)
    return ser.integration_client_out(
        client, application_code=app.code if app else None,
        tokens=integration.list_tokens(db, client.id),
    )


@router.post("/integration-clients/{client_id}/tokens", status_code=201,
             response_model=IntegrationTokenCreatedOut)
def issue_integration_token(
    client_id: UUID,
    payload: IntegrationTokenCreateRequest,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    """Plaintext token YALNIZCA BU YANITTA gorunur.

    Bir daha hicbir uctan okunamaz; kaybedilirse rotate edilir. DB'de
    yalnizca SHA-256 hash'i ve gosterim prefix'i durur.
    """
    client = db.get(SupportIntegrationClient, client_id)
    if client is None:
        raise http_error("not_found", "Integration client not found.")
    try:
        plaintext, token = integration.issue_token(
            db, client, expires_at=payload.expires_at,
            created_by_user_id=UUID(str(admin.id)),
        )
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_CREDENTIAL,
        subject_id=str(client.id), action="integration_token.created",
        metadata={"token_id": str(token.id),
                  "token_prefix": token.token_prefix},
        **_audit_actor(admin, request),
    )
    return IntegrationTokenCreatedOut(
        token=plaintext, token_id=token.id,
        token_prefix=token.token_prefix, expires_at=token.expires_at,
    )


@router.post("/integration-clients/{client_id}/tokens/{token_id}/revoke")
def revoke_integration_token(
    client_id: UUID,
    token_id: UUID,
    request: Request,
    admin: CurrentUser = Depends(
        _support_admin(Perm.TICKETS_CONFIG_MANAGE)
    ),
    db: Session = Depends(get_support_db),
):
    token = db.get(SupportIntegrationToken, token_id)
    if token is None or token.client_id != client_id:
        raise http_error("not_found", "Token not found.")
    integration.revoke_token(db, token)
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_CREDENTIAL,
        subject_id=str(client_id), action="integration_token.revoked",
        metadata={"token_id": str(token.id)},
        **_audit_actor(admin, request),
    )
    return {"id": str(token.id), "status": token.status}


# =============================================================================
# Teslimat operasyonu
# =============================================================================

@router.get("/delivery", response_model=List[DeliveryEventOut])
def list_delivery_events(
    status: Optional[str] = Query(None),
    application_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    admin: CurrentUser = Depends(_support_admin(Perm.TICKETS_ADMIN)),
    db: Session = Depends(get_support_db),
):
    query = db.query(TicketOutboxEvent)
    if status:
        query = query.filter(TicketOutboxEvent.status == status)
    if application_id:
        query = query.filter(
            TicketOutboxEvent.application_id == application_id
        )
    rows = (
        query.order_by(TicketOutboxEvent.created_at.desc())
        .limit(limit).all()
    )
    tickets = {
        t.id: t
        for t in db.query(Ticket).filter(
            Ticket.id.in_({r.ticket_id for r in rows})
        ).all()
    } if rows else {}
    apps = {
        a.id: a.code for a in db.query(SupportApplication).all()
    }
    return [
        ser.delivery_event_out(
            row,
            ticket_number=(
                format_ticket_number(tickets[row.ticket_id].number)
                if row.ticket_id in tickets else None
            ),
            application_code=apps.get(row.application_id),
        )
        for row in rows
    ]


@router.get("/delivery/stats", response_model=DeliveryStatsOut)
def delivery_statistics(
    admin: CurrentUser = Depends(_support_admin(Perm.TICKETS_ADMIN)),
    db: Session = Depends(get_support_db),
):
    return DeliveryStatsOut(**delivery.delivery_stats(db))


@router.post("/delivery/{outbox_event_id}/retry")
def retry_delivery(
    outbox_event_id: UUID,
    request: Request,
    admin: CurrentUser = Depends(_support_admin(Perm.TICKETS_ADMIN)),
    db: Session = Depends(get_support_db),
):
    """Elle yeniden kuyruklama — AYNI `event_id` ile ve AUDITLI.

    Yeni bir kimlik uretmek, consumer'in inbox'ini atlatip musteriye
    IKINCI bir bildirim gondermek demekti (06 §2).
    """
    row = db.get(TicketOutboxEvent, outbox_event_id)
    if row is None:
        raise http_error("not_found", "Delivery event not found.")
    delivery.replay(db, row, actor=admin)
    support_audit.record(
        db, subject_type=support_audit.SUBJECT_DELIVERY,
        subject_id=str(row.id), action="delivery.replayed",
        metadata={"event_id": str(row.event_id),
                  "event_type": row.event_type},
        **_audit_actor(admin, request),
    )
    return {"id": str(row.id), "status": row.status}


# =============================================================================
# Saglik
# =============================================================================

@router.get("/health", response_model=TicketHealthOut)
def ticket_health(
    admin: CurrentUser = Depends(_support_admin(Perm.TICKETS_ADMIN)),
    db: Session = Depends(get_support_db),
):
    """Modulun GERCEK durumu — iddia degil, olcum.

    Object storage ve tarayici ERISILEBILIRLIGI canli kontrol edilir;
    `attachments_production_ready` bunlarin ikisi de uygun degilse
    `false` doner (dev'de yerel depo + tarayicisiz mod calisir ama
    production-ready SAYILMAZ).
    """
    settings = get_settings()
    state, detail = support.module_state()
    ready, reason = ticket_scanner.attachments_production_ready()

    storage_ok = None
    scanner_ok = None
    if settings.TICKET_ATTACHMENTS_ENABLED:
        try:
            storage_ok = ticket_storage.get_storage().healthy()
        except Exception:  # noqa: BLE001
            storage_ok = False
        try:
            scanner_ok = ticket_scanner.get_scanner().healthy()
        except Exception:  # noqa: BLE001
            scanner_ok = False

    unrouted = 0
    for src in ticket_routing.list_source_tenants(db):
        if ticket_routing.active_route(db, source_tenant_row_id=src.id) \
                is None:
            unrouted += 1

    return TicketHealthOut(
        module_state=state,
        module_detail=detail,
        support_tenant_configured=bool(support.support_tenant_id()),
        attachments_enabled=bool(settings.TICKET_ATTACHMENTS_ENABLED),
        attachments_production_ready=ready,
        attachments_reason=reason,
        object_storage_reachable=storage_ok,
        malware_scanner_reachable=scanner_ok,
        delivery=DeliveryStatsOut(**delivery.delivery_stats(db)),
        applications=len(ticket_routing.list_applications(
            db, include_disabled=True
        )),
        unrouted_source_tenants=unrouted,
    )
