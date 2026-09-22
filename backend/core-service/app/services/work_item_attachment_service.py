"""
=============================================================================
HERMES - Is kalemine ek dosya (PM rework P2.3 / F1)
=============================================================================
Yeni depo YAZILMAZ: ticket ek altyapisi (oturum → karantina → sniff +
allowlist → ClamAV → temiz onek → yetkili stream) aynen kullanilir;
yalniz SAHIPLIK genellesir (`ticket_attachments.work_item_id`).

Kurallar:
  - Yukleme/baglama: isi gorup ilgili olan (reporter/owner/katilimci/
    proje lead'i/admin — `_can_link` ile ayni kume).
  - Gorme/indirme: `can_view` (proje uyesi dahil); goremeyen 404.
  - Yalniz `clean` ek baglanir (fail-closed); baglanmamis nesne asla
    servis edilmez (`open_download`).
  - Is kalemi eki `internal` OLAMAZ; hub/portal serializer'lari yalniz
    `ticket_id` ile yukler → is kalemi ekleri oraya YAPISAL olarak girmez.
  - Cikarma: sahip iliskisi kopar, nesne suresi dolunca bakim job'i siler.
=============================================================================
"""
from datetime import datetime, timedelta, timezone
from typing import Iterator, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser

from ..config import get_settings
from ..models.ticketing import TicketAttachment
from ..models.work_item import WorkItem
from . import ticket_attachment_service as attachments
from . import ticket_routing
from .ticket_service import TicketValidationError
from .work_item_service import _can_link, _load, record_event


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _http(exc: Exception) -> HTTPException:
    """Servis istisnalarini is kalemi yuzeyinin duz `detail` zarfina cevirir."""
    if isinstance(exc, attachments.AttachmentDisabled):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                             detail="Attachments are not configured in this environment.")
    if isinstance(exc, TicketValidationError):
        code = {
            "not_found": status.HTTP_404_NOT_FOUND,
            "conflict": status.HTTP_409_CONFLICT,
            "attachment_not_ready": status.HTTP_409_CONFLICT,
        }.get(exc.code, status.HTTP_400_BAD_REQUEST)
        return HTTPException(status_code=code, detail=str(exc))
    raise exc


def _require_contributor(db: Session, user: CurrentUser, item: WorkItem) -> None:
    if not _can_link(db, user, item):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You are not allowed to attach files to this work item.")


def _hermes_application(db: Session):
    settings = get_settings()
    return ticket_routing.ensure_application(
        db, code=settings.SUPPORT_HERMES_APPLICATION_CODE, display_name="Hermes",
    )


def open_session(db: Session, user: CurrentUser, ref: UUID, *, file_name: str, size_bytes: int,
                 declared_mime: Optional[str], sha256: Optional[str]) -> TicketAttachment:
    item, _ = _load(db, ref, user)
    _require_contributor(db, user, item)
    try:
        row = attachments.open_upload_session(
            db, application=_hermes_application(db), source_tenant=None,
            uploader_type="hermes_user", uploader_id=str(user.id),
            file_name=file_name, size_bytes=size_bytes, declared_mime=declared_mime,
            sha256=sha256, visibility="public",
        )
    except Exception as exc:  # noqa: BLE001
        raise _http(exc)
    # Oturum daha bastan is kalemine isaretlenir (attached_at HENUZ bos):
    # baska bir is kalemi bu oturumu devralamaz.
    row.work_item_id = item.id
    db.flush()
    return row


def _session_row(db: Session, item: WorkItem, attachment_id: UUID) -> TicketAttachment:
    row = db.get(TicketAttachment, attachment_id)
    if row is None or row.work_item_id != item.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found.")
    return row


def store_and_attach(db: Session, user: CurrentUser, ref: UUID, attachment_id: UUID,
                     data: bytes) -> TicketAttachment:
    """Icerigi tarar; TEMIZSE aninda baglar (tek adimli kullanici akisi)."""
    item, _ = _load(db, ref, user)
    _require_contributor(db, user, item)
    row = _session_row(db, item, attachment_id)
    attached = (
        db.query(TicketAttachment)
        .filter(TicketAttachment.work_item_id == item.id, TicketAttachment.attached_at.isnot(None))
        .count()
    )
    if attached >= int(get_settings().TICKET_ATTACHMENT_MAX_FILES):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Too many attachments for a single work item.")
    try:
        attachments.store_upload(db, row, data)
    except Exception as exc:  # noqa: BLE001
        raise _http(exc)
    if row.scan_status == "clean":
        row.attached_at = _now()
        row.expires_at = None
        db.flush()
        record_event(db, item, actor_user_id=UUID(user.id), event_type="attachment_added",
                     event_data={"attachment_id": str(row.id), "file_name": row.file_name})
    return row


def list_for_item(db: Session, user: CurrentUser, ref: UUID) -> List[TicketAttachment]:
    item, _ = _load(db, ref, user)
    return (
        db.query(TicketAttachment)
        .filter(TicketAttachment.work_item_id == item.id, TicketAttachment.attached_at.isnot(None))
        .order_by(TicketAttachment.created_at.asc())
        .all()
    )


def open_download(db: Session, user: CurrentUser, ref: UUID, attachment_id: UUID):
    """(satir, byte akisi) — once gorunurluk, sonra yetkili stream."""
    item, _ = _load(db, ref, user)
    row = _session_row(db, item, attachment_id)
    try:
        stream = attachments.open_download(row)
    except Exception as exc:  # noqa: BLE001
        raise _http(exc)
    return row, stream


def detach(db: Session, user: CurrentUser, ref: UUID, attachment_id: UUID) -> None:
    """Sahiplik kopar; nesne suresi dolunca bakim job'i siler (kalici
    silme burada YOK — ticket tarafiyla ayni cizgi)."""
    item, _ = _load(db, ref, user)
    _require_contributor(db, user, item)
    row = _session_row(db, item, attachment_id)
    row.attached_at = None
    row.work_item_id = None
    row.expires_at = _now() + timedelta(hours=1)
    db.flush()
    record_event(db, item, actor_user_id=UUID(user.id), event_type="attachment_removed",
                 event_data={"attachment_id": str(row.id), "file_name": row.file_name})
