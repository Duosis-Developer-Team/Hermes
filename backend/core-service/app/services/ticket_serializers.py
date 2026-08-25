# =============================================================================
# HERMES core — Ticket serializer'lari (ALAN ALAN, allowlist)
# =============================================================================
# 02_HERMES §5: "Tek ORM object'i `model_dump()` ile dogrudan donmek
# YASAKTIR." Sebep basit: bir gun `tickets` tablosuna internal bir kolon
# eklenirse, otomatik serialize eden bir yol onu MUSTERIYE gonderirdi.
#
# Bu yuzden her yanit burada, ELLE kurulur. Musteri serializer'i
# `internal` gorunurluklu hicbir kaydi OKUMAZ; agent serializer'i okur.
# `tests/test_ticket_internal_leakage.py` bu ayrimi hem sema hem gercek
# veri uzerinden dogrular.
# =============================================================================

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    Ticket,
    TicketAttachment,
    TicketEvent,
    TicketMessage,
    TicketResolution,
)
from ..schemas.ticketing import (
    ApplicationRef,
    AttachmentOut,
    DeliveryEventOut,
    GroupRef,
    IntegrationClientOut,
    IntegrationTokenOut,
    MessageAgentOut,
    MessagePublicOut,
    ResolutionAgentOut,
    ResolutionPublicOut,
    RouteOut,
    RoutingGroupOut,
    SourceTenantRef,
    TicketAgentListItem,
    TicketAgentOut,
    TicketCustomerListItem,
    TicketCustomerOut,
    TicketEventOut,
)
from ..ticket_contract import format_ticket_number
from . import ticket_state
from .ticket_service import customer_window_open


# =============================================================================
# Yardimci yuklemeler
# =============================================================================

def load_messages(
    db: Session, ticket_id, *, include_internal: bool
) -> List[TicketMessage]:
    query = db.query(TicketMessage).filter(
        TicketMessage.ticket_id == ticket_id
    )
    if not include_internal:
        # Musteri yuzeyinde internal kayit SORGUYA BILE girmez.
        query = query.filter(TicketMessage.visibility == "public")
    return query.order_by(TicketMessage.sequence).all()


def load_attachments(
    db: Session, ticket_id, *, include_internal: bool
) -> List[TicketAttachment]:
    query = db.query(TicketAttachment).filter(
        TicketAttachment.ticket_id == ticket_id,
        TicketAttachment.attached_at.isnot(None),
    )
    if not include_internal:
        query = query.filter(TicketAttachment.visibility == "public")
    return query.order_by(TicketAttachment.created_at).all()


def load_resolutions(db: Session, ticket_id) -> List[TicketResolution]:
    return (
        db.query(TicketResolution)
        .filter(TicketResolution.ticket_id == ticket_id)
        .order_by(TicketResolution.revision.desc())
        .all()
    )


def _group_attachments(
    attachments: Iterable[TicketAttachment],
) -> Dict[str, List[TicketAttachment]]:
    """message_id / resolution_id / '' (ticket duzeyi) ile grupla."""
    grouped: Dict[str, List[TicketAttachment]] = {}
    for row in attachments:
        if row.message_id:
            key = f"m:{row.message_id}"
        elif row.resolution_id:
            key = f"r:{row.resolution_id}"
        else:
            key = ""
        grouped.setdefault(key, []).append(row)
    return grouped


# =============================================================================
# Parca serializer'lari
# =============================================================================

def attachment_out(row: TicketAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=row.id,
        file_name=row.file_name,
        size_bytes=int(row.size_bytes or 0),
        mime_type=row.detected_mime_type or row.declared_mime_type,
        scan_status=row.scan_status,
        visibility=row.visibility,
        created_at=row.created_at,
    )


def message_public_out(
    row: TicketMessage, attachments: Sequence[TicketAttachment] = ()
) -> MessagePublicOut:
    return MessagePublicOut(
        id=row.id,
        sequence=row.sequence,
        author_type=row.author_type,
        author_display_name=row.author_display_name,
        body=row.body,
        body_format=row.body_format,
        created_at=row.created_at,
        attachments=[attachment_out(a) for a in attachments],
    )


def message_agent_out(
    row: TicketMessage, attachments: Sequence[TicketAttachment] = ()
) -> MessageAgentOut:
    return MessageAgentOut(
        id=row.id,
        sequence=row.sequence,
        author_type=row.author_type,
        author_display_name=row.author_display_name,
        body=row.body,
        body_format=row.body_format,
        created_at=row.created_at,
        visibility=row.visibility,
        attachments=[attachment_out(a) for a in attachments],
    )


def resolution_public_out(
    row: TicketResolution, ticket: Ticket,
    attachments: Sequence[TicketAttachment] = (),
) -> ResolutionPublicOut:
    return ResolutionPublicOut(
        revision=row.revision,
        resolution_code=row.resolution_code,
        summary=row.public_summary,
        workaround=row.public_workaround,
        fix_version=row.fix_version,
        resolved_at=row.resolved_at,
        resolved_by_team=ticket.assigned_group_name_snapshot,
        attachments=[attachment_out(a) for a in attachments],
    )
    # `internal_root_cause` ve `resolved_by_display_name` BILEREK YOK.


def resolution_agent_out(
    row: TicketResolution, ticket: Ticket,
    attachments: Sequence[TicketAttachment] = (),
) -> ResolutionAgentOut:
    return ResolutionAgentOut(
        revision=row.revision,
        resolution_code=row.resolution_code,
        summary=row.public_summary,
        workaround=row.public_workaround,
        fix_version=row.fix_version,
        resolved_at=row.resolved_at,
        resolved_by_team=ticket.assigned_group_name_snapshot,
        attachments=[attachment_out(a) for a in attachments],
        internal_root_cause=row.internal_root_cause,
        resolved_by_display_name=row.resolved_by_display_name,
        superseded_at=row.superseded_at,
    )


def event_out(row: TicketEvent) -> TicketEventOut:
    return TicketEventOut(
        id=row.id,
        sequence=row.sequence,
        event_type=row.event_type,
        actor_type=row.actor_type,
        actor_display_name=row.actor_display_name,
        reason=row.reason,
        metadata=row.metadata_json or {},
        occurred_at=row.occurred_at,
    )


# =============================================================================
# Musteri yuzeyi
# =============================================================================

def customer_list_item(ticket: Ticket) -> TicketCustomerListItem:
    return TicketCustomerListItem(
        id=ticket.id,
        ticket_number=format_ticket_number(ticket.number),
        title=ticket.title,
        status=ticket.status,
        category=ticket.category,
        impact=ticket.impact,
        assigned_group=GroupRef(
            id=None, name=ticket.assigned_group_name_snapshot
        ),
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        resolved_at=ticket.resolved_at,
        last_public_activity_at=ticket.last_public_activity_at,
        requester_display_name=ticket.requester_display_name,
        version=int(ticket.version or 1),
    )
    # Grup UUID'si musteriye VERILMEZ: Duosis ic kimliklerinin musteri
    # tarafinda dolasmasi icin bir neden yok (veri minimizasyonu).


def customer_detail(db: Session, ticket: Ticket) -> TicketCustomerOut:
    messages = load_messages(db, ticket.id, include_internal=False)
    attachments = load_attachments(db, ticket.id, include_internal=False)
    grouped = _group_attachments(attachments)
    resolutions = load_resolutions(db, ticket.id)

    base = customer_list_item(ticket).model_dump()
    return TicketCustomerOut(
        **base,
        reproduction_steps=ticket.reproduction_steps,
        expected_result=ticket.expected_result,
        actual_result=ticket.actual_result,
        error_code=ticket.error_code,
        correlation_id=ticket.correlation_id,
        occurred_at=ticket.occurred_at,
        closed_at=ticket.closed_at,
        reopen_window_open=(
            ticket.status == "resolved" and customer_window_open(ticket)
        ),
        messages=[
            message_public_out(m, grouped.get(f"m:{m.id}", []))
            for m in messages
        ],
        resolution=(
            resolution_public_out(
                resolutions[0], ticket,
                grouped.get(f"r:{resolutions[0].id}", []),
            )
            if resolutions else None
        ),
        resolution_history=[
            resolution_public_out(
                r, ticket, grouped.get(f"r:{r.id}", [])
            )
            for r in resolutions[1:]
        ],
        attachments=[attachment_out(a) for a in grouped.get("", [])],
    )


# =============================================================================
# Agent yuzeyi
# =============================================================================

def agent_list_item(
    ticket: Ticket,
    *,
    application: Optional[SupportApplication] = None,
    source_tenant: Optional[SupportSourceTenant] = None,
) -> TicketAgentListItem:
    return TicketAgentListItem(
        id=ticket.id,
        ticket_number=format_ticket_number(ticket.number),
        title=ticket.title,
        status=ticket.status,
        category=ticket.category,
        impact=ticket.impact,
        priority=ticket.priority,
        application=ApplicationRef(
            id=ticket.application_id,
            code=application.code if application else None,
            display_name=(
                application.display_name if application else None
            ),
        ),
        source_tenant=SourceTenantRef(
            id=ticket.source_tenant_row_id,
            source_tenant_id=(
                source_tenant.source_tenant_id if source_tenant else None
            ),
            display_name=(
                source_tenant.display_name if source_tenant else None
            ),
        ),
        assigned_group=GroupRef(
            id=ticket.assigned_group_id,
            name=ticket.assigned_group_name_snapshot,
        ),
        assigned_user_id=ticket.assigned_user_id,
        requester_display_name=ticket.requester_display_name,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        first_response_at=ticket.first_response_at,
        resolved_at=ticket.resolved_at,
        last_public_activity_at=ticket.last_public_activity_at,
        version=int(ticket.version or 1),
    )


def agent_detail(
    db: Session,
    ticket: Ticket,
    *,
    application: Optional[SupportApplication] = None,
    source_tenant: Optional[SupportSourceTenant] = None,
    is_admin: bool = False,
) -> TicketAgentOut:
    messages = load_messages(db, ticket.id, include_internal=True)
    attachments = load_attachments(db, ticket.id, include_internal=True)
    grouped = _group_attachments(attachments)
    resolutions = load_resolutions(db, ticket.id)

    base = agent_list_item(
        ticket, application=application, source_tenant=source_tenant
    ).model_dump()
    return TicketAgentOut(
        **base,
        requester_source_user_id=ticket.requester_source_user_id,
        requester_email=ticket.requester_email,
        reproduction_steps=ticket.reproduction_steps,
        expected_result=ticket.expected_result,
        actual_result=ticket.actual_result,
        error_code=ticket.error_code,
        correlation_id=ticket.correlation_id,
        occurred_at=ticket.occurred_at,
        closed_at=ticket.closed_at,
        client_context=ticket.client_context_json or {},
        route_version=int(ticket.route_version or 1),
        duplicate_of_ticket_id=ticket.duplicate_of_ticket_id,
        messages=[
            message_agent_out(m, grouped.get(f"m:{m.id}", []))
            for m in messages
        ],
        resolution=(
            resolution_agent_out(
                resolutions[0], ticket,
                grouped.get(f"r:{resolutions[0].id}", []),
            )
            if resolutions else None
        ),
        resolution_history=[
            resolution_agent_out(r, ticket, grouped.get(f"r:{r.id}", []))
            for r in resolutions[1:]
        ],
        attachments=[attachment_out(a) for a in grouped.get("", [])],
        allowed_transitions=list(
            ticket_state.agent_targets(ticket.status, is_admin=is_admin)
        ),
    )


# =============================================================================
# Konfigurasyon / operasyon
# =============================================================================

def route_out(route, group_name: Optional[str] = None) -> RouteOut:
    return RouteOut(
        id=route.id,
        group_id=route.group_id,
        group_name=group_name,
        route_version=int(route.route_version),
        is_active=bool(route.is_active),
        verified_at=route.verified_at,
        updated_at=route.updated_at,
    )


def routing_group_out(item: dict) -> RoutingGroupOut:
    return RoutingGroupOut(
        id=item["id"],
        name=item["name"],
        description=item.get("description"),
        member_count=int(item.get("member_count", 0)),
        updated_at=item.get("updated_at"),
    )


def integration_token_out(row) -> IntegrationTokenOut:
    return IntegrationTokenOut(
        id=row.id,
        token_prefix=row.token_prefix,
        status=row.status,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
        created_at=row.created_at,
    )
    # `token_hash` BILEREK YOK — hash da bir credential materyalidir.


def integration_client_out(
    row, *, application_code: Optional[str] = None, tokens=()
) -> IntegrationClientOut:
    return IntegrationClientOut(
        id=row.id,
        application_id=row.application_id,
        application_code=application_code,
        name=row.name,
        description=row.description,
        environment=row.environment,
        scopes=list(row.scopes or []),
        status=row.status,
        rate_limit_per_min=row.rate_limit_per_min,
        created_at=row.created_at,
        tokens=[integration_token_out(t) for t in tokens],
    )


def delivery_event_out(
    row, *, ticket_number: Optional[str] = None,
    application_code: Optional[str] = None,
) -> DeliveryEventOut:
    return DeliveryEventOut(
        id=row.id,
        event_id=row.event_id,
        event_type=row.event_type,
        ticket_id=row.ticket_id,
        ticket_number=ticket_number,
        application_code=application_code,
        status=row.status,
        attempts=int(row.attempts or 0),
        sequence=int(row.sequence or 0),
        last_error_code=row.last_error_code,
        last_status_code=row.last_status_code,
        next_attempt_at=row.next_attempt_at,
        created_at=row.created_at,
        sent_at=row.sent_at,
        dead_at=row.dead_at,
    )
    # `payload_json` BILEREK YOK: teslimat ekraninda ticket ICERIGI
    # gosterilmez (06 §8).
