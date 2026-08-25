# =============================================================================
# HERMES core — Ticket listeleme, filtreler ve kuyruklar
# =============================================================================
# Kuyruklar bir GORUNUM kolayligidir, bir YETKI kolayligi DEGIL: her
# kuyruk once `ticket_visibility` predicate'inin uzerine biner. Kapsam
# disi bir ticket, hangi kuyruk secilirse secilsin gorunmez.
#
# Uygulama filtresi (Tumu / Hermes / LogiSlot / ...) da ayni sekilde
# yalnizca ZATEN erisilebilir kume uzerinde calisir (02 §8).
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    Ticket,
    TicketMessage,
)
from ..ticket_contract import OPEN_STATUSES
from . import ticket_visibility as visibility

# Kuyruk katalogu — anahtar SOZLESMEDIR (URL'de yasar, paylasilabilir).
QUEUES = (
    ("my_group_open", "My group's open tickets"),
    ("assigned_to_me", "Assigned to me"),
    ("unassigned", "Unassigned"),
    ("awaiting_first_response", "Awaiting first response"),
    ("customer_replied", "Customer replied"),
    ("waiting_customer", "Waiting on customer"),
    ("recently_resolved", "Recently resolved"),
    ("all", "All tickets"),
)
QUEUE_KEYS = tuple(k for k, _ in QUEUES)


def _now():
    return datetime.now(timezone.utc)


def _last_public_author_subquery():
    """Her ticket icin SON public mesajin yazar tipi.

    `DISTINCT ON` Postgres'e ozgudur ama bu servis zaten Postgres'e
    baglidir (RLS'in kendisi Postgres ozelligi). Alternatif pencere
    fonksiyonu ayni plani uretmiyordu.
    """
    return (
        select(
            TicketMessage.ticket_id.label("ticket_id"),
            TicketMessage.author_type.label("author_type"),
        )
        .where(TicketMessage.visibility == "public")
        .order_by(TicketMessage.ticket_id, TicketMessage.sequence.desc())
        .distinct(TicketMessage.ticket_id)
        .subquery()
    )


def queue_predicate(queue: str, scope: visibility.HubScope):
    """Kuyrugun EK kosulu (gorunurluk predicate'i AYRICA uygulanir)."""
    if queue in (None, "", "all"):
        return None
    if queue == "my_group_open":
        return Ticket.status.in_(OPEN_STATUSES)
    if queue == "assigned_to_me":
        return Ticket.assigned_user_id == scope.user_id
    if queue == "unassigned":
        return and_(
            Ticket.assigned_user_id.is_(None),
            Ticket.status.in_(OPEN_STATUSES),
        )
    if queue == "awaiting_first_response":
        return and_(
            Ticket.first_response_at.is_(None),
            Ticket.status.in_(OPEN_STATUSES),
        )
    if queue == "waiting_customer":
        return Ticket.status == "waiting_customer"
    if queue == "recently_resolved":
        return and_(
            Ticket.status.in_(("resolved", "closed")),
            Ticket.resolved_at.isnot(None),
            Ticket.resolved_at >= _now() - timedelta(days=14),
        )
    if queue == "customer_replied":
        last = _last_public_author_subquery()
        return and_(
            Ticket.status.in_(OPEN_STATUSES),
            Ticket.id.in_(
                select(last.c.ticket_id).where(
                    last.c.author_type == "requester"
                )
            ),
        )
    return None


@dataclass
class TicketFilters:
    queue: Optional[str] = None
    application_id: Optional[UUID] = None
    source_tenant_row_id: Optional[UUID] = None
    group_id: Optional[UUID] = None
    assignee_id: Optional[UUID] = None
    statuses: Tuple[str, ...] = ()
    categories: Tuple[str, ...] = ()
    priorities: Tuple[str, ...] = ()
    search: Optional[str] = None
    created_from: Optional[datetime] = None
    created_to: Optional[datetime] = None
    updated_from: Optional[datetime] = None
    updated_to: Optional[datetime] = None


def _apply_filters(query, filters: TicketFilters):
    if filters.application_id:
        query = query.filter(Ticket.application_id == filters.application_id)
    if filters.source_tenant_row_id:
        query = query.filter(
            Ticket.source_tenant_row_id == filters.source_tenant_row_id
        )
    if filters.group_id:
        query = query.filter(Ticket.assigned_group_id == filters.group_id)
    if filters.assignee_id:
        query = query.filter(Ticket.assigned_user_id == filters.assignee_id)
    if filters.statuses:
        query = query.filter(Ticket.status.in_(filters.statuses))
    if filters.categories:
        query = query.filter(Ticket.category.in_(filters.categories))
    if filters.priorities:
        query = query.filter(Ticket.priority.in_(filters.priorities))
    if filters.created_from:
        query = query.filter(Ticket.created_at >= filters.created_from)
    if filters.created_to:
        query = query.filter(Ticket.created_at <= filters.created_to)
    if filters.updated_from:
        query = query.filter(Ticket.updated_at >= filters.updated_from)
    if filters.updated_to:
        query = query.filter(Ticket.updated_at <= filters.updated_to)
    if filters.search:
        term = filters.search.strip()
        if term:
            like = f"%{term.lower()}%"
            # Arama YUZEYI bilinctir: ticket kodu, baslik, hata kodu ve
            # correlation ID. Musteri MESAJLARINDA tam metin arama v1
            # disidir (01 §6) — GIN indeksi olmadan yapilirsa yavaslar
            # ve internal mesajlari da tarama riski dogar.
            conditions = [
                func.lower(Ticket.title).like(like),
                func.lower(func.coalesce(Ticket.error_code, "")).like(like),
                func.lower(
                    func.coalesce(Ticket.correlation_id, "")
                ).like(like),
            ]
            digits = "".join(ch for ch in term if ch.isdigit())
            if digits:
                try:
                    conditions.append(Ticket.number == int(digits))
                except ValueError:  # pragma: no cover
                    pass
            query = query.filter(or_(*conditions))
    return query


def hub_query(db: Session, scope: visibility.HubScope,
              filters: TicketFilters):
    query = db.query(Ticket)
    query = visibility.apply_hub_filter(query, scope)
    predicate = queue_predicate(filters.queue, scope)
    if predicate is not None:
        query = query.filter(predicate)
    return _apply_filters(query, filters)


def list_hub_tickets(
    db: Session, scope: visibility.HubScope, filters: TicketFilters,
    *, limit: int = 50, offset: int = 0,
) -> Tuple[List[Ticket], int]:
    query = hub_query(db, scope, filters)
    total = query.with_entities(func.count(Ticket.id)).scalar() or 0
    rows = (
        query.order_by(Ticket.updated_at.desc())
        .limit(limit).offset(offset).all()
    )
    return rows, int(total)


def queue_counts(
    db: Session, scope: visibility.HubScope,
    *, application_id: Optional[UUID] = None,
) -> List[dict]:
    """Her kuyruk icin erisilebilir ticket sayisi.

    Sayaclar da gorunurluk predicate'inden GECER — yani rozetteki sayi,
    kullanicinin gercekten acabilecegi ticket sayisidir. Aksi halde
    "3 ticket var" deyip bos liste gostermek gibi bir celiski olusurdu.
    """
    results = []
    for key, label in QUEUES:
        if key == "all" and not scope.is_admin:
            continue
        filters = TicketFilters(queue=key, application_id=application_id)
        count = (
            hub_query(db, scope, filters)
            .with_entities(func.count(Ticket.id))
            .scalar()
            or 0
        )
        results.append({"key": key, "label": label, "count": int(count)})
    return results


def application_counts(
    db: Session, scope: visibility.HubScope
) -> List[dict]:
    """Uygulama secici: her uygulamanin ACIK ticket sayisi (kapsam ici).

    Uygulama listesi katalogdan gelir — `hermes`/`logislot` kodlari
    frontend'de HARDCODE EDILMEZ (01_HERMES §7).
    """
    counts = dict(
        visibility.apply_hub_filter(
            db.query(Ticket.application_id, func.count(Ticket.id)), scope
        )
        .filter(Ticket.status.in_(OPEN_STATUSES))
        .group_by(Ticket.application_id)
        .all()
    )
    apps = (
        db.query(SupportApplication)
        .filter(SupportApplication.status == "active")
        .order_by(SupportApplication.display_name)
        .all()
    )
    return [
        {
            "id": app.id,
            "code": app.code,
            "display_name": app.display_name,
            "status": app.status,
            "open_ticket_count": int(counts.get(app.id, 0)),
        }
        for app in apps
    ]


def load_refs(
    db: Session, tickets: List[Ticket]
) -> Tuple[dict, dict]:
    """Liste serilestirmesi icin uygulama/kaynak-tenant haritalari.

    Ticket basina ayri sorgu (N+1) yerine tek seferde cekilir; 50
    satirlik bir sayfada bu 100 sorgu ile 2 sorgu arasindaki farktir.
    """
    if not tickets:
        return {}, {}
    app_ids = {t.application_id for t in tickets}
    src_ids = {t.source_tenant_row_id for t in tickets}
    apps = {
        row.id: row
        for row in db.query(SupportApplication)
        .filter(SupportApplication.id.in_(app_ids)).all()
    }
    sources = {
        row.id: row
        for row in db.query(SupportSourceTenant)
        .filter(SupportSourceTenant.id.in_(src_ids)).all()
    }
    return apps, sources


def portal_query(db: Session, scope: visibility.PortalScope,
                 filters: TicketFilters):
    query = db.query(Ticket)
    query = visibility.apply_portal_filter(query, scope)
    return _apply_filters(query, filters)


def list_portal_tickets(
    db: Session, scope: visibility.PortalScope, filters: TicketFilters,
    *, limit: int = 50, offset: int = 0,
) -> Tuple[List[Ticket], int]:
    query = portal_query(db, scope, filters)
    total = query.with_entities(func.count(Ticket.id)).scalar() or 0
    rows = (
        query.order_by(Ticket.updated_at.desc())
        .limit(limit).offset(offset).all()
    )
    return rows, int(total)


__all__ = [
    "QUEUES",
    "QUEUE_KEYS",
    "TicketFilters",
    "application_counts",
    "hub_query",
    "list_hub_tickets",
    "list_portal_tickets",
    "load_refs",
    "portal_query",
    "queue_counts",
    "queue_predicate",
]
