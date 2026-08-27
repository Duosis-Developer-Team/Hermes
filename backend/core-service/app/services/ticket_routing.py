# =============================================================================
# HERMES core — Application / source tenant / route cozumu
# =============================================================================
# "Bu ticket hangi ekibe gidecek?" sorusunun TEK cevabi buradan gelir.
#
# Uc kademe:
#   application   → hangi urun (immutable `code`, ortam bazli);
#   source tenant → o urunun hangi musterisi (opaque dis kimlik);
#   route         → o musterinin AKTIF Duosis grubu (tenant basina TEK).
#
# Son kullanici grup SECMEZ (D-004). Route yoksa create KAPALIDIR; sessiz
# bir "global gruba dus" davranisi YOKTUR — cunku yanlis kuyruga dusen
# bir ticket, kaybolan bir ticket'tir.
# =============================================================================

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    SupportTicketRoute,
)
from ..models.user_group import UserGroup, UserGroupMember
from .ticket_service import TicketValidationError
from .ticket_text import sanitize_single_line


def _now():
    return datetime.now(timezone.utc)


# =============================================================================
# Application
# =============================================================================

def get_application(
    db: Session, code: str, *, environment: Optional[str] = None
) -> Optional[SupportApplication]:
    env = environment or get_settings().PUBLIC_API_ENV
    return (
        db.query(SupportApplication)
        .filter(
            SupportApplication.code == code,
            SupportApplication.environment == env,
        )
        .first()
    )


def require_application(
    db: Session, code: str, *, environment: Optional[str] = None
) -> SupportApplication:
    app = get_application(db, code, environment=environment)
    if app is None:
        raise TicketValidationError(
            "Unknown source application.", code="not_found",
        )
    if app.status != "active":
        raise TicketValidationError(
            "This source application is disabled.", code="forbidden",
        )
    return app


def ensure_application(
    db: Session,
    *,
    code: str,
    display_name: str,
    environment: Optional[str] = None,
    description: Optional[str] = None,
) -> SupportApplication:
    """IDEMPOTENT upsert — yalnizca YENI satir yazar.

    Var olan bir kaydin `display_name`/`callback_url` gibi operatorun
    ayarladigi alanlarini EZMEZ: seed, konfigurasyonun ustune yazmaz.
    """
    env = environment or get_settings().PUBLIC_API_ENV
    existing = get_application(db, code, environment=env)
    if existing is not None:
        return existing
    app = SupportApplication(
        code=code,
        display_name=sanitize_single_line(display_name, max_length=120),
        description=description,
        status="active",
        environment=env,
    )
    db.add(app)
    db.flush()
    return app


def list_applications(
    db: Session, *, include_disabled: bool = False
) -> List[SupportApplication]:
    env = get_settings().PUBLIC_API_ENV
    query = db.query(SupportApplication).filter(
        SupportApplication.environment == env
    )
    if not include_disabled:
        query = query.filter(SupportApplication.status == "active")
    return query.order_by(SupportApplication.display_name).all()


# =============================================================================
# Source tenant
# =============================================================================

#: Uygulama basina yetenek anahtari (`capabilities_json`).
SELF_SERVICE_ROUTING_CAPABILITY = "self_service_routing"


def self_service_routing_enabled(application: SupportApplication) -> bool:
    """Kaynak uygulama kendi tenant'lari icin hedef ekibi KENDI secebilir mi?

    VARSAYILAN HAYIR (04 §4). Normalde canonical route'u Duosis tarafi
    `tickets.config.manage` ile atar; boylece bir kaynak uygulama, elindeki
    service token ile keyfi bir Duosis ekibini (ornegin baska bir musteriye
    ait bir kuyrugu) hedefleyemez.

    Bayrak acildiginda o uygulama kendi kaynak tenant'lari icin AKTIF
    gruplardan birini secebilir. Sinir hala vardir: secim yalnizca aktif
    gruplar arasindan yapilir, yalnizca kendi application'inin tenant'lari
    icin gecerlidir ve her baglama denetime yazilir.
    """
    caps = application.capabilities_json or {}
    return caps.get(SELF_SERVICE_ROUTING_CAPABILITY) is True


def get_source_tenant(
    db: Session, *, application_id, source_tenant_id: str
) -> Optional[SupportSourceTenant]:
    return (
        db.query(SupportSourceTenant)
        .filter(
            SupportSourceTenant.application_id == application_id,
            SupportSourceTenant.source_tenant_id == str(source_tenant_id),
        )
        .first()
    )


def require_source_tenant(
    db: Session, *, application_id, source_tenant_id: str
) -> SupportSourceTenant:
    row = get_source_tenant(
        db, application_id=application_id, source_tenant_id=source_tenant_id
    )
    if row is None:
        raise TicketValidationError(
            "This source workspace is not mapped for the application.",
            code="source_tenant_unknown",
        )
    if row.status != "active":
        raise TicketValidationError(
            "This source workspace is not active for support.",
            code="forbidden",
        )
    return row


def ensure_source_tenant(
    db: Session,
    *,
    application: SupportApplication,
    source_tenant_id: str,
    display_name: str,
    slug: Optional[str] = None,
) -> SupportSourceTenant:
    """Mapping upsert. Gorunen ad SNAPSHOT'tur: kaynak taraf adini
    degistirirse guncellenir, ama kimlik (`source_tenant_id`) asla."""
    row = get_source_tenant(
        db, application_id=application.id, source_tenant_id=source_tenant_id
    )
    clean_name = sanitize_single_line(display_name, max_length=200) \
        or str(source_tenant_id)
    if row is not None:
        if row.display_name != clean_name and clean_name:
            row.display_name = clean_name
            row.updated_at = _now()
        if slug and row.source_tenant_slug != slug:
            row.source_tenant_slug = slug
            row.updated_at = _now()
        return row
    row = SupportSourceTenant(
        application_id=application.id,
        source_tenant_id=str(source_tenant_id),
        source_tenant_slug=slug,
        display_name=clean_name,
        status="active",
    )
    db.add(row)
    db.flush()
    return row


def list_source_tenants(
    db: Session, *, application_id=None
) -> List[SupportSourceTenant]:
    query = db.query(SupportSourceTenant)
    if application_id is not None:
        query = query.filter(
            SupportSourceTenant.application_id == application_id
        )
    return query.order_by(SupportSourceTenant.display_name).all()


# =============================================================================
# Route
# =============================================================================

def active_route(
    db: Session, *, source_tenant_row_id
) -> Optional[SupportTicketRoute]:
    return (
        db.query(SupportTicketRoute)
        .filter(
            SupportTicketRoute.source_tenant_row_id == source_tenant_row_id,
            SupportTicketRoute.is_active.is_(True),
        )
        .first()
    )


def resolve_route(
    db: Session,
    *,
    source_tenant: SupportSourceTenant,
    expected_route_version: Optional[int] = None,
) -> Tuple[SupportTicketRoute, UserGroup]:
    """Create icin route + grup cozumu; her basarisizlik AYRI koda esler.

    Ayri kodlar onemlidir: kaynak uygulama `route_missing` gorunce
    platform yoneticisine yonlendirir, `route_stale` gorunce config'i
    yeniler, `group_inactive` gorunce destek ekibine haber verir.
    Tek bir "400 bad request" bu ayrimi yok ederdi.
    """
    route = active_route(db, source_tenant_row_id=source_tenant.id)
    if route is None:
        raise TicketValidationError(
            "Ticket routing has not been configured for this workspace.",
            code="route_missing",
        )
    if (
        expected_route_version is not None
        and int(expected_route_version) != int(route.route_version)
    ):
        raise TicketValidationError(
            "Ticket routing configuration must be refreshed.",
            code="route_stale",
        )
    group = db.get(UserGroup, route.group_id)
    if group is None or not group.is_active:
        raise TicketValidationError(
            "The target support group is no longer active.",
            code="group_inactive",
        )
    return route, group


def set_route(
    db: Session,
    *,
    source_tenant: SupportSourceTenant,
    group: UserGroup,
    actor_type: str,
    actor_id: Optional[str],
) -> SupportTicketRoute:
    """Kaynak tenant icin AKTIF route'u degistirir.

    Onceki route SILINMEZ, pasife alinir ve versiyon artar — boylece
    "hangi route ile acilmisti?" sorusu ticket uzerindeki
    `route_version` ile cevaplanabilir kalir.

    Route degisikligi YALNIZCA YENI ticket'lari etkiler (02 §5): mevcut
    ticket'lar topluca tasinmaz.
    """
    current = active_route(db, source_tenant_row_id=source_tenant.id)
    if current is not None:
        if current.group_id == group.id:
            current.verified_at = _now()
            current.updated_at = _now()
            return current
        current.is_active = False
        current.updated_at = _now()
        db.flush()

    highest = (
        db.query(func.max(SupportTicketRoute.route_version))
        .filter(
            SupportTicketRoute.source_tenant_row_id == source_tenant.id
        )
        .scalar()
    )
    route = SupportTicketRoute(
        application_id=source_tenant.application_id,
        source_tenant_row_id=source_tenant.id,
        group_id=group.id,
        route_version=int(highest or 0) + 1,
        is_active=True,
        configured_by_actor_type=actor_type,
        configured_by_actor_id=str(actor_id) if actor_id else None,
        verified_at=_now(),
    )
    db.add(route)
    db.flush()
    return route


def deactivate_route(
    db: Session, *, source_tenant: SupportSourceTenant
) -> Optional[SupportTicketRoute]:
    route = active_route(db, source_tenant_row_id=source_tenant.id)
    if route is None:
        return None
    route.is_active = False
    route.updated_at = _now()
    db.flush()
    return route


# =============================================================================
# Grup katalogu (integration'a acilan MINIMAL gorunum)
# =============================================================================

def routing_group_catalog(db: Session) -> Tuple[List[dict], str]:
    """Aktif Duosis gruplari + AKTIF uye SAYISI.

    Uye KIMLIKLERI/e-postalari DONMEZ (04 §3, 05 §4): kaynak uygulamanin
    Duosis'in kim oldugunu bilmeye ihtiyaci yok, yalnizca hangi ekibe
    yonlendirdigini gostermeye ihtiyaci var.

    `catalog_version`, icerikten turetilen deterministik bir ozettir —
    ETag/If-None-Match icin kullanilir ve agresif polling'i ucuzlatir.
    """
    counts = dict(
        db.query(UserGroupMember.group_id, func.count(UserGroupMember.id))
        .filter(UserGroupMember.is_active.is_(True))
        .group_by(UserGroupMember.group_id)
        .all()
    )
    groups = (
        db.query(UserGroup)
        .filter(UserGroup.is_active.is_(True))
        .order_by(UserGroup.name)
        .all()
    )
    items = [
        {
            "id": str(g.id),
            "name": g.name,
            "description": g.description,
            "member_count": int(counts.get(g.id, 0)),
            "updated_at": g.updated_at,
        }
        for g in groups
    ]
    digest = hashlib.sha256()
    for item in items:
        digest.update(
            f"{item['id']}:{item['name']}:{item['member_count']}:"
            f"{item['updated_at']}".encode("utf-8")
        )
    return items, digest.hexdigest()[:32]
