# =============================================================================
# HERMES core — Ticket gorunurluk politikasi (TEK KAYNAK)
# =============================================================================
# Blueprint §9: "Visibility filter her list/detail/mutation icin ortak
# helper/policy." Bu modul o politikadir. Ticket okuyan HICBIR sorgu
# kendi WHERE'ini uydurmaz; hepsi buradaki predicate'leri kullanir.
#
# IKI YETKI KATMANI VARDIR ve ikisi de HER istekte calisir:
#
#   1) IZIN  (ne yapabilir)  → RBAC katalogundan, auth-service S2S ile.
#   2) KAPSAM (neyi gorur)   → hub'da CANLI grup uyeligi, portalda
#                              kaynak tenant + requester kimligi.
#
# Ikisi bagimsizdir: `tickets.respond` izni olan biri, uye OLMADIGI bir
# grubun ticket'ini goremez; bir gruba uye olan ama `tickets.access`
# izni olmayan biri modulu hic acamaz.
#
# ATAMA ERISIM VERMEZ (02_HERMES §2): `assigned_user_id` yalnizca bir
# KOLAYLIK filtresidir. Yanlislikla baska bir grubun uyesine atanmis bir
# ticket, o kisiye gorunmez — aksi halde hatali bir atama, private grup
# sinirini delen bir yol olurdu.
#
# KAPSAM DISI = YOK (05 §2): kapsam disindaki bir kayit icin 404 doner,
# 403 degil. UUID bilmek erisim saglamaz ve varlik bilgisi sizmaz.
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy.orm import Session

from shared.auth import CurrentUser
from shared.permissions import TICKETS_ADMIN_COVERS, Perm

from ..models.ticketing import Ticket
from ..models.user_group import UserGroup, UserGroupMember
from . import authz_client, ticket_metrics


class TicketAccessDenied(PermissionError):
    """Kapsam disi / izinsiz erisim. Yuzey katmani 404 veya 403'e cevirir
    (kural: kapsam → 404, izin → 403)."""

    def __init__(self, reason: str, *, as_not_found: bool = True):
        self.reason = reason
        self.as_not_found = as_not_found
        super().__init__(reason)


# =============================================================================
# Efektif ticket izinleri
# =============================================================================

def effective_ticket_permissions(user: CurrentUser) -> FrozenSet[str]:
    """Kullanicinin ticket izinleri + `tickets.admin` turevleri.

    `tickets.admin`, digerlerini KAPSAR (katalogda ayri bir izin degil,
    turetme kurali — shared/permissions.TICKETS_ADMIN_COVERS). Boylece
    admin rolune tek tek operasyonel izin eklemek gerekmez ve "admin ama
    yanit yazamiyor" gibi tutarsiz roller olusamaz.

    Fail-closed: cozum yapilamiyorsa BOS kume (kullanici modulu goremez).
    Sentezlenmis public-API aktorleri icin cozum HIC yapilmaz.
    """
    if not user.allow_rbac_resolution:
        return frozenset()
    try:
        perms = authz_client.effective_permissions(
            user.id, tenant_id=user.tenant_id
        )
    except authz_client.AuthzUnavailable:
        return frozenset()
    perms = set(perms)
    if Perm.TICKETS_ADMIN in perms:
        perms.update(TICKETS_ADMIN_COVERS)
    return frozenset(perms)


# =============================================================================
# Duosis hub (support agent) kapsami
# =============================================================================

@dataclass(frozen=True)
class HubScope:
    user_id: str
    permissions: FrozenSet[str]
    group_ids: Tuple[UUID, ...]

    @property
    def is_admin(self) -> bool:
        return Perm.TICKETS_ADMIN in self.permissions

    @property
    def can_respond(self) -> bool:
        return Perm.TICKETS_RESPOND in self.permissions

    @property
    def can_resolve(self) -> bool:
        return Perm.TICKETS_RESOLVE in self.permissions

    @property
    def can_assign(self) -> bool:
        return Perm.TICKETS_ASSIGN in self.permissions

    @property
    def can_manage_config(self) -> bool:
        return Perm.TICKETS_CONFIG_MANAGE in self.permissions

    @property
    def has_any_scope(self) -> bool:
        """Admin degilse ve hicbir aktif gruba uye degilse: gorunur
        ticket YOKTUR. Bu, "erisiminiz yok" ile "ticket yok" ayrimini
        UI'da dogru yapabilmek icin onemlidir."""
        return self.is_admin or bool(self.group_ids)


def active_group_ids(db: Session, user_id: str) -> Tuple[UUID, ...]:
    """Kullanicinin AKTIF uyesi oldugu AKTIF gruplar (support tenant'ta).

    Hem uyeligin hem grubun aktif olmasi sarttir: pasife alinmis bir
    grup, uyeleri icin erisim uretmeye devam ETMEMELIDIR.

    `db` support tenant baglaminda acilmis olmalidir — RLS zaten baska
    bir tenant'in gruplarini gostermez.
    """
    rows = (
        db.query(UserGroupMember.group_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.user_id == user_id,
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    return tuple(r[0] for r in rows)


def resolve_hub_scope(db: Session, user: CurrentUser) -> HubScope:
    """Agent'in kapsamini cozer. `db` SUPPORT tenant oturumudur."""
    permissions = effective_ticket_permissions(user)
    if Perm.TICKETS_ACCESS not in permissions:
        ticket_metrics.authz_denied("hub", "missing_access_permission")
        raise TicketAccessDenied(
            "tickets.access permission is required.", as_not_found=False
        )
    groups = active_group_ids(db, user.id)
    return HubScope(
        user_id=str(user.id), permissions=permissions, group_ids=groups,
    )


def hub_predicate(scope: HubScope):
    """Hub list/detail sorgularinin ZORUNLU WHERE parcasi.

    admin  → kisit YOK (support tenant'in tamami; RLS zaten disari
             cikmayi engeller).
    diger  → `assigned_group_id` kullanicinin AKTIF gruplarindan biri.
             Grup yoksa `false` predicate'i uretilir: sifir satir.
    """
    if scope.is_admin:
        return None
    if not scope.group_ids:
        # Bilincli olarak "hicbir satir": tenant genelinde acik kalan
        # bir sorgu yerine kapali bir kosul.
        return Ticket.id.is_(None)
    return Ticket.assigned_group_id.in_(scope.group_ids)


def apply_hub_filter(query, scope: HubScope):
    predicate = hub_predicate(scope)
    return query if predicate is None else query.filter(predicate)


def assert_hub_can_view(ticket: Ticket, scope: HubScope) -> None:
    """Detay/mutasyon oncesi tek satirlik kapi."""
    if scope.is_admin:
        return
    if ticket.assigned_group_id in scope.group_ids:
        return
    ticket_metrics.authz_denied("hub", "group_scope")
    raise TicketAccessDenied("ticket outside group scope")


def require_hub_permission(scope: HubScope, code: str) -> None:
    if code not in scope.permissions:
        ticket_metrics.authz_denied("hub", "missing_permission")
        raise TicketAccessDenied(
            f"Missing permission: {code}", as_not_found=False
        )


# =============================================================================
# Musteri portali kapsami
# =============================================================================

@dataclass(frozen=True)
class PortalScope:
    application_id: UUID
    source_tenant_row_id: Optional[UUID]
    requester_source_user_id: str
    permissions: FrozenSet[str]

    @property
    def view_all(self) -> bool:
        return Perm.TICKETS_VIEW_ALL in self.permissions

    @property
    def can_create(self) -> bool:
        return Perm.TICKETS_CREATE in self.permissions


def portal_predicate(scope: PortalScope):
    """Portal sorgularinin ZORUNLU WHERE parcasi.

    Her zaman uygulama + kaynak tenant'a kilitlidir; `view_all` yalnizca
    KENDI kaynak tenant'i icinde genisletir. Baska bir tenant'in ticket'i
    hicbir kombinasyonda gorunmez.
    """
    if scope.source_tenant_row_id is None:
        # Henuz mapping yok → gorulecek ticket da yok.
        return Ticket.id.is_(None)
    conditions = [
        Ticket.application_id == scope.application_id,
        Ticket.source_tenant_row_id == scope.source_tenant_row_id,
    ]
    if not scope.view_all:
        conditions.append(
            Ticket.requester_source_user_id
            == scope.requester_source_user_id
        )
    return and_(*conditions)


def apply_portal_filter(query, scope: PortalScope):
    return query.filter(portal_predicate(scope))


def assert_portal_can_view(ticket: Ticket, scope: PortalScope) -> None:
    if (
        scope.source_tenant_row_id is None
        or ticket.application_id != scope.application_id
        or ticket.source_tenant_row_id != scope.source_tenant_row_id
    ):
        ticket_metrics.authz_denied("portal", "tenant_scope")
        raise TicketAccessDenied("ticket outside source tenant scope")
    if (
        not scope.view_all
        and ticket.requester_source_user_id
        != scope.requester_source_user_id
    ):
        ticket_metrics.authz_denied("portal", "requester_scope")
        raise TicketAccessDenied("ticket belongs to another requester")


# =============================================================================
# Integration (service client) kapsami
# =============================================================================

@dataclass(frozen=True)
class IntegrationScope:
    """Bir source uygulamanin service credential'inin kapsami.

    Uygulama SINIRI mutlaktir: LogiSlot token'i `application_code=hermes`
    ile ticket ACAMAZ; kapsam token KAYDINDAN gelir, istek govdesinden
    DEGIL (05 §9 kabul testi).
    """

    application_id: UUID
    application_code: str
    scopes: FrozenSet[str]
    client_id: UUID

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


def integration_predicate(
    scope: IntegrationScope,
    *,
    source_tenant_row_id: Optional[UUID],
    requester_source_user_id: Optional[str] = None,
):
    conditions = [Ticket.application_id == scope.application_id]
    if source_tenant_row_id is None:
        return Ticket.id.is_(None)
    conditions.append(Ticket.source_tenant_row_id == source_tenant_row_id)
    if requester_source_user_id is not None:
        conditions.append(
            Ticket.requester_source_user_id == requester_source_user_id
        )
    return and_(*conditions)


def assert_integration_can_view(
    ticket: Ticket,
    scope: IntegrationScope,
    *,
    source_tenant_row_id: Optional[UUID] = None,
    requester_source_user_id: Optional[str] = None,
) -> None:
    if ticket.application_id != scope.application_id:
        ticket_metrics.authz_denied("integration", "application_scope")
        raise TicketAccessDenied("ticket belongs to another application")
    if (
        source_tenant_row_id is not None
        and ticket.source_tenant_row_id != source_tenant_row_id
    ):
        ticket_metrics.authz_denied("integration", "tenant_scope")
        raise TicketAccessDenied("ticket belongs to another source tenant")
    if (
        requester_source_user_id is not None
        and ticket.requester_source_user_id != requester_source_user_id
    ):
        ticket_metrics.authz_denied("integration", "requester_scope")
        raise TicketAccessDenied("ticket belongs to another requester")


__all__ = [
    "HubScope",
    "IntegrationScope",
    "PortalScope",
    "TicketAccessDenied",
    "active_group_ids",
    "apply_hub_filter",
    "apply_portal_filter",
    "assert_hub_can_view",
    "assert_integration_can_view",
    "assert_portal_can_view",
    "effective_ticket_permissions",
    "hub_predicate",
    "integration_predicate",
    "portal_predicate",
    "require_hub_permission",
    "resolve_hub_scope",
]
