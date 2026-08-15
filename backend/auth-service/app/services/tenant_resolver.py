# =============================================================================
# HERMES Auth Service — Host → tenant cozumu (WS3)
# =============================================================================
# Tenant, kimlik dogrulamasindan ONCE ve YALNIZCA sunucu tarafinda
# cozulur. Istemcinin gonderdigi hicbir deger (X-Tenant-ID, body alani,
# e-posta alan adi) otorite DEGILDIR.
#
# Cozum sirasi (03_TARGET_ARCHITECTURE §3.4):
#   1. dogrulanmis custom domain
#   2. dogrulanmis Hermes subdomain
#   3. legacy `hermes.duosis.com` → ilk Duosis tenant'i
#
# Dev/test'te ek olarak `/w/{slug}` yolu desteklenir; bu YALNIZCA
# HERMES_ALLOW_WORKSPACE_PATH=true iken acilir ve production'da kapalidir.
#
# Bilinmeyen host, kullanici/tenant varligini SIZDIRMAYAN tek bir
# `workspace_not_found` yaniti uretir.
# =============================================================================

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from ..models.tenancy import Tenant, TenantDomain

logger = logging.getLogger("hermes.tenant")

# Tenant'in kullanilabilir sayildigi durumlar. `grace` bilerek DAHILDIR:
# odeme/limit uyarisi verilen ama hala calisan bir organizasyondur.
USABLE_STATUSES = ("active", "grace")


@dataclass(frozen=True)
class ResolvedTenant:
    """Cozulmus tenant baglami — dogrulanmis, guvenli alanlar."""

    id: str
    slug: str
    display_name: str
    status: str

    @property
    def is_usable(self) -> bool:
        return self.status in USABLE_STATUSES


class WorkspaceNotFound(Exception):
    """Host hicbir tenant'a cozulmedi.

    Yanit, tenant'in var olup olmadigini SIZDIRMAZ: bilinmeyen host ile
    askiya alinmis tenant ayni sinifta degildir (askiya alinmis tenant
    icin ayri `WorkspaceUnavailable` vardir), ama bilinmeyen host ile
    "hic yaratilmamis" host ayni yaniti alir.
    """


class WorkspaceUnavailable(Exception):
    """Tenant var ama kullanilabilir durumda degil (suspended/archived)."""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def _normalize_hostname(raw: Optional[str]) -> Optional[str]:
    """Host basligini karsilastirilabilir hale getirir.

    Port atilir, kucuk harfe cevrilir, sondaki nokta kirpilir.
    IDN normalizasyonu (punycode) `idna` ile yapilir; cozulemezse host
    reddedilir — belirsiz bir hostname'i tahmin etmeyiz.
    """
    if not raw:
        return None
    host = raw.strip().lower()
    # IPv6 literal: [::1]:8000
    if host.startswith("["):
        closing = host.find("]")
        if closing == -1:
            return None
        host = host[: closing + 1]
    elif ":" in host:
        host = host.split(":", 1)[0]
    host = host.rstrip(".")
    if not host:
        return None
    try:
        # Zaten ASCII ise encode/decode kimlik islevi gorur.
        host = host.encode("idna").decode("ascii")
    except (UnicodeError, UnicodeDecodeError):
        return None
    return host


def allow_workspace_path() -> bool:
    """`/w/{slug}` dev kolayligi acik mi? Varsayilan KAPALI."""
    return os.getenv("HERMES_ALLOW_WORKSPACE_PATH", "").lower() == "true"


def resolve_by_hostname(db: Session, hostname: Optional[str]) -> ResolvedTenant:
    """Dogrulanmis bir domain kaydi uzerinden tenant cozer.

    Raises:
        WorkspaceNotFound: host bilinmiyor veya domain dogrulanmamis.
        WorkspaceUnavailable: tenant askiya alinmis/arsivlenmis.
    """
    normalized = _normalize_hostname(hostname)
    if not normalized:
        raise WorkspaceNotFound()

    row = (
        db.query(Tenant, TenantDomain)
        .join(TenantDomain, TenantDomain.tenant_id == Tenant.id)
        .filter(
            TenantDomain.hostname == normalized,
            # DOGRULANMAMIS domain tenant cozmez: aksi halde birisi
            # kendi tenant'ina baskasinin hostname'ini ekleyip o host'a
            # gelen istekleri kendi tenant'ina yonlendirebilirdi.
            TenantDomain.verification_status == "verified",
        )
        .first()
    )
    if row is None:
        raise WorkspaceNotFound()

    tenant = row[0]
    resolved = ResolvedTenant(
        id=str(tenant.id),
        slug=tenant.slug,
        display_name=tenant.display_name,
        status=tenant.status,
    )
    if not resolved.is_usable:
        raise WorkspaceUnavailable(tenant.status)
    return resolved


def resolve_by_slug(db: Session, slug: Optional[str]) -> ResolvedTenant:
    """Dev/test `/w/{slug}` yolu icin cozum.

    `HERMES_ALLOW_WORKSPACE_PATH` acik degilse, slug BILINSE BILE
    cozmez — production'da host disinda bir tenant secme yolu olmamali.
    """
    if not allow_workspace_path():
        raise WorkspaceNotFound()
    if not slug:
        raise WorkspaceNotFound()

    tenant = (
        db.query(Tenant).filter(Tenant.slug == slug.strip().lower()).first()
    )
    if tenant is None:
        raise WorkspaceNotFound()

    resolved = ResolvedTenant(
        id=str(tenant.id),
        slug=tenant.slug,
        display_name=tenant.display_name,
        status=tenant.status,
    )
    if not resolved.is_usable:
        raise WorkspaceUnavailable(tenant.status)
    return resolved


def resolve_request_tenant(
    db: Session,
    *,
    hostname: Optional[str],
    workspace_slug: Optional[str] = None,
) -> ResolvedTenant:
    """Bir istek icin tenant baglamini cozer.

    Once host denenir (production yolu). Yalnizca host cozulemediginde ve
    dev workspace yolu acikken slug'a bakilir.
    """
    try:
        return resolve_by_hostname(db, hostname)
    except WorkspaceNotFound:
        if workspace_slug and allow_workspace_path():
            return resolve_by_slug(db, workspace_slug)
        raise
