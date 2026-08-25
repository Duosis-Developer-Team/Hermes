# =============================================================================
# HERMES core — Tenant projeksiyonu (S2S)
# =============================================================================
# core_db tenant OTORITESI DEGILDIR; kayitlarin sahibi auth_db'dir. Ama
# core'un bilinmeyen/pasif bir tenant'i REDDEDEBILMESI icin yerel bir
# projeksiyona ihtiyaci var (veritabanlari arasi FK kurulamaz).
#
# Bu uc, yeni bir tenant provision edildiginde auth tarafindan cagrilir.
# Kullaniciya donuk HICBIR akis buraya yazmaz.
#
# GUVENLIK:
#   - Yalnizca S2S credential ile (kullanici JWT'si KABUL EDILMEZ).
#   - Yanitlar tekduze: eksik/gecersiz/kapali hepsi 401 (credential
#     varligi ifsa edilmez).
#   - `source_version`: auth'tan gelen SIRASIZ/eski bir mesaj daha yeni
#     durumu EZEMEZ; deterministik olarak yok sayilir.
#   - Idempotent: ayni mesaj tekrar gelirse hicbir sey degismez.
# =============================================================================

import hmac
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/tenants", tags=["Internal"])

_VALID_STATUS = {
    "provisioning", "active", "suspended", "grace",
    "deprovisioning", "archived", "failed",
}

# --- Basit brute-force freni (auth tarafiyla ayni desen) ---------------------
_FAIL_WINDOW_SECONDS = 60
_FAIL_LIMIT = 10
_fail_counts: dict[str, tuple[float, int]] = {}


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    window_start, count = _fail_counts.get(ip, (now, 0))
    if now - window_start > _FAIL_WINDOW_SECONDS:
        return False
    return count >= _FAIL_LIMIT


def _record_failure(ip: str) -> None:
    now = time.monotonic()
    window_start, count = _fail_counts.get(ip, (now, 0))
    if now - window_start > _FAIL_WINDOW_SECONDS:
        window_start, count = now, 0
    _fail_counts[ip] = (window_start, count + 1)


def require_s2s(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> None:
    """S2S kapisi. Kapali/eksik/gecersiz hepsi 401 (fail-closed)."""
    ip = request.client.host if request.client else "?"
    if _rate_limited(ip):
        logger.warning("s2s rate-limited ip=%s", ip)
        raise HTTPException(status_code=429, detail="Too many attempts.")

    settings = get_settings()
    provided = ""
    if authorization and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()

    valid = False
    for candidate in (
        getattr(settings, "HERMES_S2S_TOKEN_CURRENT", ""),
        getattr(settings, "HERMES_S2S_TOKEN_NEXT", ""),
    ):
        # Bos anahtar hicbir seyi dogrulamaz (kapali = fail-closed).
        if candidate and provided and hmac.compare_digest(provided, candidate):
            valid = True
    if not valid:
        _record_failure(ip)
        logger.warning("s2s auth failed path=%s ip=%s", request.url.path, ip)
        raise HTTPException(status_code=401, detail="Unauthorized.")
    logger.info("s2s ok path=%s ip=%s", request.url.path, ip)


class TenantProjection(BaseModel):
    tenant_id: str
    slug: str = Field(min_length=1, max_length=63)
    status: str
    placement_key: str = Field(default="shared-default", max_length=64)
    source_version: int = Field(default=1, ge=0)


@router.post(
    "/projection",
    summary="Tenant projeksiyonunu guncelle (S2S)",
    dependencies=[Depends(require_s2s)],
)
def upsert_projection(
    payload: TenantProjection,
    db: Session = Depends(get_db),
) -> dict:
    if payload.status not in _VALID_STATUS:
        raise HTTPException(status_code=422, detail="invalid status")

    # Tek ifade: ekle ya da YALNIZCA daha yeni bir surumse guncelle.
    # `source_version` karsilastirmasi, agdan sirasiz gelen eski bir
    # mesajin aktif tenant'i 'provisioning'e geri dusurmesini engeller.
    result = db.execute(text("""
        INSERT INTO tenant_registry
            (tenant_id, slug, status, placement_key, source_version,
             provisioned_at, updated_at)
        VALUES (CAST(:tenant_id AS uuid), :slug, :status, :placement_key,
                :source_version, now(), now())
        ON CONFLICT (tenant_id) DO UPDATE
           SET slug = EXCLUDED.slug,
               status = EXCLUDED.status,
               placement_key = EXCLUDED.placement_key,
               source_version = EXCLUDED.source_version,
               updated_at = now()
         WHERE tenant_registry.source_version < EXCLUDED.source_version
        RETURNING tenant_id
    """), payload.model_dump())
    applied = result.first() is not None
    db.commit()

    logger.info("tenant projeksiyonu: slug=%s status=%s uygulandi=%s",
                payload.slug, payload.status, applied)
    return {
        "tenant_id": payload.tenant_id,
        "applied": applied,      # False = daha yeni bir surum zaten var
        "source_version": payload.source_version,
    }
