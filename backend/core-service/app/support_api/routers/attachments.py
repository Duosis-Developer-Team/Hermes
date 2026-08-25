# =============================================================================
# HERMES Support API — attachment upload oturumu (04 §5)
# =============================================================================
# Contract "kisa omurlu presigned PUT VEYA backend streaming" der;
# burada BACKEND STREAMING secildi:
#
#   - presigned URL uretmek, imzali bir URL'in loglara/aracilara
#     dusme yuzeyini acar;
#   - streaming, icerigi ayni yetki kapisindan gecirir ve object
#     storage kimlik bilgilerini tek bir yerde tutar;
#   - saglayici degistiginde (MinIO → S3 → R2) consumer sozlesmesi
#     DEGISMEZ; yalnizca Hermes'in ic depolama katmani degisir.
#
# Yanit sekli sozlesmedekiyle AYNIDIR (`upload_id`, `upload_url`,
# `expires_at`, `required_headers`, `max_size_bytes`); `upload_url`
# yalnizca ayni API uzerindeki bir uca isaret eder.
# =============================================================================

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ...config import get_settings
from ...models.ticketing import SupportApplication, TicketAttachment
from ...services import ticket_attachment_service
from ..deps import get_support_db, require_scopes, resolve_source_tenant, translate
from ..errors import SupportAPIError
from ..schemas import (
    AttachmentSessionIn,
    AttachmentSessionOut,
    AttachmentStatusOut,
)

router = APIRouter(prefix="/v1/support", tags=["Support attachments"])


def _status_out(row: TicketAttachment) -> AttachmentStatusOut:
    # Sozlesme sozlugu: `scanning` (surmekte), `clean`, `rejected`.
    status = {
        "pending_scan": "scanning",
        "clean": "clean",
        "rejected": "rejected",
        "scan_failed": "rejected",
    }.get(row.scan_status, "scanning")
    return AttachmentStatusOut(
        upload_id=row.id, status=status, file_name=row.file_name,
        size_bytes=int(row.size_bytes or 0),
        mime_type=row.detected_mime_type or row.declared_mime_type,
        reason=row.scan_error_code,
    )


@router.post("/attachments/sessions", response_model=AttachmentSessionOut,
             status_code=201)
def open_session(
    payload: AttachmentSessionIn,
    request: Request,
    scope=Depends(require_scopes("support:attachments:write")),
    db: Session = Depends(get_support_db),
):
    settings = get_settings()
    source_tenant = resolve_source_tenant(
        db, scope, payload.source_tenant_id
    )
    application = db.get(SupportApplication, scope.application_id)
    try:
        row = ticket_attachment_service.open_upload_session(
            db, application=application, source_tenant=source_tenant,
            uploader_type="integration_client",
            uploader_id=str(scope.client_id),
            file_name=payload.file_name, size_bytes=payload.size_bytes,
            declared_mime=payload.declared_mime_type,
            sha256=payload.sha256, visibility="public",
        )
    except ticket_attachment_service.AttachmentDisabled as exc:
        raise SupportAPIError("support_not_configured", str(exc))
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)

    base = str(request.url).split("/v1/support/")[0]
    return AttachmentSessionOut(
        upload_id=row.id,
        upload_url=f"{base}/v1/support/attachments/{row.id}/content",
        expires_at=row.expires_at,
        # Ayni bearer token ile PUT edilir; ek zorunlu baslik YOK.
        required_headers={},
        max_size_bytes=int(settings.TICKET_ATTACHMENT_MAX_BYTES),
    )


@router.put("/attachments/{upload_id}/content",
            response_model=AttachmentStatusOut)
async def upload_content(
    upload_id: UUID,
    request: Request,
    scope=Depends(require_scopes("support:attachments:write")),
    db: Session = Depends(get_support_db),
):
    settings = get_settings()
    body = await request.body()
    if len(body) > int(settings.TICKET_ATTACHMENT_MAX_BYTES):
        raise SupportAPIError(
            "validation_error",
            "This file exceeds the maximum attachment size.",
        )
    row = db.get(TicketAttachment, upload_id)
    # Baska bir client'in upload oturumuna yazilamaz.
    if row is None or str(row.uploader_id) != str(scope.client_id):
        raise SupportAPIError("not_found")
    try:
        ticket_attachment_service.store_upload(db, row, body)
    except ticket_attachment_service.AttachmentDisabled as exc:
        raise SupportAPIError("support_not_configured", str(exc))
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return _status_out(row)


@router.post("/attachments/{upload_id}/complete",
             response_model=AttachmentStatusOut)
def complete(
    upload_id: UUID,
    scope=Depends(require_scopes("support:attachments:write")),
    db: Session = Depends(get_support_db),
):
    """Tarama sonucunu sorgular.

    Ayri bir "complete" adimi sozlesmede vardir cunku tarama
    ASENKRON olabilir. Bu uygulamada tarama upload sirasinda senkron
    calisir; uc yine de sozlesme geregi durur ve DURUMU doner —
    consumer'in akisi degismez.
    """
    row = db.get(TicketAttachment, upload_id)
    if row is None or str(row.uploader_id) != str(scope.client_id):
        raise SupportAPIError("not_found")
    return _status_out(row)
