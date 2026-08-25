# =============================================================================
# HERMES core — Attachment yasam dongusu
# =============================================================================
# Akis (05 §5):
#
#   session ac  → metadata satiri + KARANTINA nesne anahtari
#   icerik yukle → boyut/sha256 dogrula → magic-byte sniff + allowlist
#                  → karantinaya yaz → malware tara
#   temiz ise   → temiz onege TASI, status=clean
#   red ise     → NESNE SILINIR, metadata/audit KALIR
#   bagla       → ticket/mesaj/cozume iliskilendir (yalnizca `clean`)
#   indir       → once ticket yetkisi, sonra yetkili STREAM
#
# Ek "hazir" degilse ticket metni yine islenebilir (failure mode
# tablosu): tarama devam ederken kullaniciya "taraniyor" gosterilir.
# =============================================================================

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import (
    SupportApplication,
    SupportSourceTenant,
    Ticket,
    TicketAttachment,
)
from ..ticket_contract import (
    ATTACHMENT_ALLOWED_MIME,
    EVENT_TICKET_ATTACHMENT_DOWNLOADED,
    EVENT_TICKET_ATTACHMENT_SCANNED,
)
from . import ticket_metrics, ticket_scanner, ticket_storage
from .ticket_service import TicketValidationError
from .ticket_text import sanitize_filename

logger = logging.getLogger("hermes.ticket.attachment")


def _now():
    return datetime.now(timezone.utc)


class AttachmentDisabled(RuntimeError):
    """Attachment ozelligi bu deployment'ta kapali/yapilandirilmamis."""


def ensure_enabled() -> None:
    settings = get_settings()
    if not settings.TICKET_ATTACHMENTS_ENABLED:
        raise AttachmentDisabled(
            "Attachments are not enabled on this deployment."
        )
    problem = ticket_scanner.production_posture_error()
    if problem:
        # Yanlis yapilandirilmis bir 'acik' ozellik, kapali olmasindan
        # daha tehlikelidir: kullanici taranmis sanir.
        raise AttachmentDisabled(
            f"Attachments are misconfigured ({problem})."
        )


# =============================================================================
# Upload session
# =============================================================================

def open_upload_session(
    db: Session,
    *,
    application: SupportApplication,
    source_tenant: Optional[SupportSourceTenant],
    uploader_type: str,
    uploader_id: Optional[str],
    file_name: str,
    size_bytes: int,
    declared_mime: Optional[str],
    sha256: Optional[str] = None,
    visibility: str = "public",
) -> TicketAttachment:
    """Metadata satirini yaratir; nesne HENUZ yoktur.

    On dogrulama (boyut/MIME) burada yapilir ki kullanici 15 MB'i
    yukledikten SONRA degil, ONCE reddedilsin.
    """
    ensure_enabled()
    settings = get_settings()

    clean_name = sanitize_filename(file_name)
    if int(size_bytes or 0) <= 0:
        raise TicketValidationError("File size must be greater than zero.")
    if int(size_bytes) > int(settings.TICKET_ATTACHMENT_MAX_BYTES):
        raise TicketValidationError(
            "This file exceeds the maximum attachment size.",
        )
    if declared_mime and declared_mime not in ATTACHMENT_ALLOWED_MIME:
        # Beyan edilen tip zaten allowlist disiysa erken reddet; gercek
        # karar yine icerikten verilir.
        if not str(declared_mime).startswith("text/"):
            raise TicketValidationError(
                "This file type is not allowed."
            )

    row = TicketAttachment(
        id=uuid.uuid4(),
        application_id=application.id,
        source_tenant_row_id=source_tenant.id if source_tenant else None,
        visibility=visibility,
        uploader_type=uploader_type,
        uploader_id=str(uploader_id) if uploader_id else None,
        file_name=clean_name,
        object_key=ticket_storage.new_object_key(
            settings.TICKET_S3_QUARANTINE_PREFIX
        ),
        declared_mime_type=declared_mime,
        size_bytes=int(size_bytes),
        sha256=(sha256 or "").lower() or None,
        scan_status="pending_scan",
        expires_at=_now() + timedelta(
            minutes=int(settings.TICKET_ATTACHMENT_SESSION_TTL_MINUTES)
        ),
    )
    db.add(row)
    db.flush()
    return row


def store_upload(
    db: Session, attachment: TicketAttachment, data: bytes
) -> TicketAttachment:
    """Icerigi karantinaya yazar, dogrular ve tarar.

    Bu fonksiyon `clean` DISINDA bir sonucla donerse, ek hicbir ticket'a
    baglanamaz (`ticket_service.attach_files` fail-closed kontrol eder).
    """
    ensure_enabled()
    settings = get_settings()

    if attachment.uploaded_at is not None:
        raise TicketValidationError(
            "This upload session has already been used.",
            code="conflict",
        )
    if attachment.expires_at and _now() > attachment.expires_at.replace(
        tzinfo=attachment.expires_at.tzinfo or timezone.utc
    ):
        raise TicketValidationError(
            "This upload session has expired.", code="conflict",
        )
    if len(data) > int(settings.TICKET_ATTACHMENT_MAX_BYTES):
        raise TicketValidationError(
            "This file exceeds the maximum attachment size."
        )

    digest = hashlib.sha256(data).hexdigest()
    if attachment.sha256 and attachment.sha256 != digest:
        raise TicketValidationError(
            "The uploaded content does not match the declared checksum."
        )
    attachment.sha256 = digest
    attachment.size_bytes = len(data)
    attachment.uploaded_at = _now()

    verdict = ticket_scanner.verify_content(
        data,
        declared_mime=attachment.declared_mime_type,
        file_name=attachment.file_name,
    )
    attachment.detected_mime_type = verdict.detected_mime
    if not verdict.ok:
        attachment.scan_status = "rejected"
        attachment.scan_engine = "content_policy"
        attachment.scan_error_code = verdict.reason
        attachment.scanned_at = _now()
        ticket_metrics.attachment_scanned(
            "rejected", verdict.detected_mime or "unknown"
        )
        db.flush()
        return attachment

    storage = ticket_storage.get_storage()
    storage.put(
        attachment.object_key, data,
        content_type=verdict.detected_mime or "application/octet-stream",
    )

    scanner = ticket_scanner.get_scanner()
    result = scanner.scan(data)
    attachment.scan_engine = result.engine
    attachment.scanned_at = _now()
    ticket_metrics.observe_scan_duration(result.duration_seconds)

    if result.status == "clean":
        clean_key = attachment.object_key.replace(
            settings.TICKET_S3_QUARANTINE_PREFIX,
            settings.TICKET_S3_CLEAN_PREFIX, 1,
        )
        try:
            storage.move(attachment.object_key, clean_key)
            attachment.object_key = clean_key
        except Exception:  # noqa: BLE001
            # Tasima basarisizsa nesne karantinada KALIR ve ek
            # kullanilamaz — sessizce "temiz" saymak yanlis olurdu.
            logger.error("attachment promote failed", exc_info=True)
            attachment.scan_status = "scan_failed"
            attachment.scan_error_code = "promote_failed"
            db.flush()
            return attachment
        attachment.scan_status = "clean"
        attachment.scan_error_code = (
            result.error_code  # dev modda 'scan_skipped_dev'
        )
    else:
        attachment.scan_status = result.status
        attachment.scan_error_code = result.error_code
        if result.status == "rejected":
            # Zararli icerik SAKLANMAZ; metadata/audit kalir (05 §5).
            try:
                storage.delete(attachment.object_key)
            except Exception:  # noqa: BLE001
                logger.error("quarantine delete failed", exc_info=True)

    ticket_metrics.attachment_scanned(
        attachment.scan_status, attachment.detected_mime_type or "unknown"
    )
    db.flush()
    return attachment


# =============================================================================
# Indirme
# =============================================================================

def open_download(attachment: TicketAttachment) -> Iterator[bytes]:
    """Yetki kontrolu CAGIRANDA yapilmis olmalidir.

    Burada yalnizca "ek gercekten indirilebilir mi?" sorusu var:
    baglanmamis ya da temiz olmayan bir nesne ASLA servis edilmez.
    """
    if attachment.scan_status != "clean":
        raise TicketValidationError(
            "This attachment is not available.",
            code="attachment_not_ready",
        )
    if attachment.attached_at is None:
        raise TicketValidationError(
            "This attachment is not attached to a ticket.",
            code="attachment_not_ready",
        )
    storage = ticket_storage.get_storage()
    return storage.stream(attachment.object_key)


def record_download(
    db: Session, ticket: Ticket, attachment: TicketAttachment, *, actor
) -> None:
    from . import ticket_event_service as events

    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_ATTACHMENT_DOWNLOADED,
        actor_type=actor.type, actor_id=actor.id,
        actor_display_name=actor.display_name,
        correlation_id=actor.correlation_id,
        metadata={"attachment_id": str(attachment.id)},
    )


def record_scan_event(
    db: Session, ticket: Ticket, attachment: TicketAttachment, *, actor
) -> None:
    from . import ticket_event_service as events

    events.record_event(
        db, ticket,
        event_type=EVENT_TICKET_ATTACHMENT_SCANNED,
        actor_type=actor.type, actor_id=actor.id,
        correlation_id=actor.correlation_id,
        metadata={
            "attachment_id": str(attachment.id),
            "scan_status": attachment.scan_status,
            "scan_engine": attachment.scan_engine,
        },
    )


# =============================================================================
# Bakim: suresi dolmus, BAGLANMAMIS staging nesneleri
# =============================================================================

def expire_orphaned_uploads(db: Session, *, limit: int = 200) -> dict:
    """Suresi gecmis ve HICBIR ticket'a baglanmamis nesneleri temizler.

    Ticket EKI ASLA SILINMEZ: filtre `attached_at IS NULL` ve
    `ticket_id IS NULL` sartlarini birlikte arar. Satir da silinmez —
    nesne bosaltilir, kayit `rejected/expired_unattached` olarak durur.
    Boylece hicbir DELETE gerekmeden hem depo temizlenir hem audit
    korunur.
    """
    rows = (
        db.query(TicketAttachment)
        .filter(
            TicketAttachment.ticket_id.is_(None),
            TicketAttachment.attached_at.is_(None),
            TicketAttachment.expires_at.isnot(None),
            TicketAttachment.expires_at < _now(),
            TicketAttachment.scan_status != "rejected",
        )
        .limit(limit)
        .all()
    )
    storage = ticket_storage.get_storage()
    cleaned = 0
    for row in rows:
        try:
            storage.delete(row.object_key)
        except Exception:  # noqa: BLE001 — nesne zaten yok olabilir
            logger.debug("orphan delete skipped", exc_info=True)
        row.scan_status = "rejected"
        row.scan_error_code = "expired_unattached"
        row.scanned_at = _now()
        cleaned += 1
    db.flush()
    return {"ok": True, "expired": cleaned}
