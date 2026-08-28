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

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ...config import get_settings
from ...models.ticketing import SupportApplication, Ticket, TicketAttachment
from ...services import (
    ticket_attachment_service,
    ticket_download_grants,
    ticket_visibility as visibility,
)
from ..deps import get_support_db, require_scopes, resolve_source_tenant, translate
from ..errors import SupportAPIError
from ..schemas import (
    AttachmentDownloadIn,
    AttachmentDownloadOut,
    AttachmentSessionIn,
    AttachmentSessionOut,
    AttachmentStatusOut,
)

router = APIRouter(prefix="/v1/support", tags=["Support attachments"])


def _public_base(request: Request) -> str:
    """Consumer'a verilecek MUTLAK adresin taban parcasi.

    `request.url` TEK BASINA yetmez: TLS ingress'te sonlanir ve uvicorn
    forwarded basliklarina varsayilan olarak yalnizca 127.0.0.1'den
    guvenir (`--forwarded-allow-ips`), dolayisiyla uygulama sema olarak
    `http` gorur. Bu adres indirme akisinda KULLANICININ TARAYICISINA
    verildigi icin sema/host yanlis olursa baglanti kirilir.

    Basliklar burada YALNIZCA adres kurmak icin kullanilir; hicbir yetki
    karari bunlara dayanmaz.
    """
    fwd_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0]
    fwd_host = (request.headers.get("x-forwarded-host") or "").split(",")[0]
    scheme = fwd_proto.strip() or request.url.scheme
    netloc = fwd_host.strip() or request.url.netloc
    prefix = request.url.path.split("/v1/support/")[0]
    return f"{scheme}://{netloc}{prefix}"


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

    base = _public_base(request)
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


# =============================================================================
# Indirme — iki adim (POST izin, GET stream)
# =============================================================================
# NEDEN IKI ADIM: kaynak uygulama, kendi kullanicisinin TARAYICISINI
# indirme adresine 307 ile yonlendirir. Tarayicida Hermes bearer token'i
# YOKTUR, dolayisiyla ikinci adim kendini dogrulayabilmelidir.
#
# Bu, object storage'in imzali URL'i DEGILDIR: depo private kalir,
# baytlar Hermes uzerinden akar, yetki karari Hermes'te verilir. Izin tek
# kullanimlik ve kisa omurludur.

@router.post("/attachments/{attachment_id}/download",
             response_model=AttachmentDownloadOut)
def issue_download(
    attachment_id: UUID,
    payload: AttachmentDownloadIn,
    request: Request,
    scope=Depends(require_scopes("support:tickets:read")),
    db: Session = Depends(get_support_db),
):
    """Tek kullanimlik indirme adresi uretir.

    Yetki SIRASI onemli: once ticket kaynak uygulamanin KENDI kapsaminda
    mi (uygulama + kaynak tenant), sonra ek gercekten o ticket'in mi,
    sonra ek servis edilebilir durumda mi. Herhangi biri tutmazsa AYNI
    404 doner — var olmayan kayit ile erisilemeyen kayit ayirt edilemez.
    """
    source_tenant = resolve_source_tenant(
        db, scope, payload.source_tenant_id
    )
    ticket = db.get(Ticket, payload.ticket_id)
    if ticket is None:
        raise SupportAPIError("not_found")
    try:
        visibility.assert_integration_can_view(
            ticket, scope, source_tenant_row_id=source_tenant.id,
        )
    except visibility.TicketAccessDenied:
        # Kapsam disi ticket = VAR OLMAYAN ticket (ayni 404 zarfi).
        raise SupportAPIError("not_found")

    row = db.get(TicketAttachment, attachment_id)
    if row is None or row.ticket_id != ticket.id:
        raise SupportAPIError("not_found")
    # Internal gorunurluklu ek, kaynak uygulamaya ASLA acilmaz.
    if (row.visibility or "public") != "public":
        raise SupportAPIError("not_found")
    if row.scan_status != "clean" or row.attached_at is None:
        raise SupportAPIError(
            "attachment_not_ready", "This attachment is not available."
        )

    grant, token = ticket_download_grants.issue(
        db, attachment=row, ticket=ticket, client_id=str(scope.client_id),
    )
    base = _public_base(request)
    return AttachmentDownloadOut(
        download_url=(
            f"{base}/v1/support/attachments/{row.id}/content?grant={token}"
        ),
        expires_at=grant.expires_at,
        file_name=row.file_name,
    )


@router.get("/attachments/{attachment_id}/content")
def download_content(
    attachment_id: UUID,
    grant: str = Query(..., min_length=16, max_length=200),
    db: Session = Depends(get_support_db),
):
    """Izni bozdurur ve icerigi STREAM eder. Bearer token ISTEMEZ.

    Kimlik dogrulamasi izin token'inin KENDISIDIR: tek kullanimlik, kisa
    omurlu ve tek bir eke bagli. Bozdurma ile stream ayni istektedir;
    ikinci deneme 404 alir.
    """
    row_grant = ticket_download_grants.redeem(
        db, attachment_id=attachment_id, token=grant
    )
    if row_grant is None:
        raise SupportAPIError("not_found")
    row = db.get(TicketAttachment, attachment_id)
    if row is None:
        raise SupportAPIError("not_found")
    try:
        stream = ticket_attachment_service.open_download(row)
    except Exception as exc:  # noqa: BLE001
        raise translate(exc)
    return StreamingResponse(
        stream,
        # Icerik TARAYICIDA CALISTIRILMAZ: her zaman indirilir ve
        # sniffing kapatilir. Allowlist HTML/SVG'yi zaten disarida
        # birakir; bu ikinci savunma hattidir.
        media_type="application/octet-stream",
        headers={
            "Content-Disposition":
                f'attachment; filename="{_safe_name(row.file_name)}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )


def _safe_name(name: str) -> str:
    """Header enjeksiyonunu ve tirnak kacisini kapatir."""
    cleaned = "".join(
        c for c in (name or "attachment")
        if c.isprintable() and c not in '"\\\r\n'
    )
    return cleaned[:120] or "attachment"
