# =============================================================================
# HERMES core — Ticket DISI yonetim audit'i
# =============================================================================
# Ticket'a baglanabilen her sey `ticket_events`te yasar. Ama route
# degistirmek, application eklemek, integration credential uretmek ya da
# olu bir olayi elle yeniden gondermek bir ticket'a ait DEGILDIR ve yine
# de denetlenebilir olmalidir (05 §8).
#
# Append-only: guncelleme/silme yolu YOKTUR.
# =============================================================================

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models.ticketing import SupportAuditEvent

# Denetlenen ozne tipleri (kapali kume — yazim hatasi arama yuzeyini
# sessizce bolerdi).
SUBJECT_APPLICATION = "support_application"
SUBJECT_SOURCE_TENANT = "support_source_tenant"
SUBJECT_ROUTE = "support_ticket_route"
SUBJECT_CREDENTIAL = "support_integration_client"
SUBJECT_DELIVERY = "ticket_outbox_event"
SUBJECT_ATTACHMENT = "ticket_attachment"


def record(
    db: Session,
    *,
    subject_type: str,
    action: str,
    actor_type: str,
    subject_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    actor_display_name: Optional[str] = None,
    reason: Optional[str] = None,
    metadata: Optional[dict] = None,
    correlation_id: Optional[str] = None,
    source_ip: Optional[str] = None,
) -> SupportAuditEvent:
    """Denetim kaydi. `metadata` SANITIZE veri tasimalidir: secret,
    token, imza ve mesaj govdesi ASLA girmez (05 §3/§7)."""
    row = SupportAuditEvent(
        subject_type=subject_type,
        subject_id=str(subject_id) if subject_id else None,
        action=action,
        actor_type=actor_type,
        actor_id=str(actor_id) if actor_id else None,
        actor_display_name=actor_display_name,
        reason=reason,
        metadata_json=metadata or {},
        correlation_id=correlation_id,
        source_ip=source_ip,
    )
    db.add(row)
    db.flush()
    return row
