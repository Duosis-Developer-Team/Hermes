# =============================================================================
# HERMES — tek kullanimlik indirme izni (integration yuzeyi)
# =============================================================================
# Kaynak uygulama, kendi kullanicisinin TARAYICISINI Hermes'e yonlendirir.
# Tarayicida bearer token YOKTUR; dolayisiyla o istegin kendini
# dogrulayabilmesi gerekir. Bu modul o izni uretir ve TEK KEZ bozdurur.
#
# Tasarim sinirlari (hepsi bilincli):
#   * Token DB'de DEGIL, yalnizca SHA-256 ozeti tutulur.
#   * Tek kullanim: bozdurulan izin isaretlenir, ikinci istek REDDEDILIR.
#   * Kisa TTL (varsayilan 60 sn) — ayarlanabilir.
#   * Izin TEK bir eke ve onu isteyen client'a baglidir.
#   * Karsilastirma sabit zamanlidir.
#
# Bu, object storage'in imzali URL'i DEGILDIR: depo private kalir,
# baytlar yine Hermes uzerinden akar ve yetki kararlari Hermes'te kalir.
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import TicketDownloadGrant

#: URL'de tasinabilecek kadar guvenli bir uzunluk.
_TOKEN_BYTES = 32


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue(
    db: Session, *, attachment, ticket, client_id: str,
) -> tuple[TicketDownloadGrant, str]:
    """Yeni bir izin uretir ve (satir, DUZ token) doner.

    Duz token cagirana YALNIZCA BURADA verilir; bir daha uretilemez.
    """
    settings = get_settings()
    ttl = int(getattr(settings, "TICKET_DOWNLOAD_GRANT_TTL_SECONDS", 60))
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    row = TicketDownloadGrant(
        attachment_id=attachment.id,
        ticket_id=ticket.id,
        application_id=attachment.application_id,
        source_tenant_row_id=attachment.source_tenant_row_id,
        token_hash=hash_token(token),
        issued_to_client_id=str(client_id)[:64],
        expires_at=_now() + timedelta(seconds=max(5, ttl)),
    )
    db.add(row)
    db.flush()
    return row, token


def redeem(
    db: Session, *, attachment_id, token: str,
) -> Optional[TicketDownloadGrant]:
    """Izni TEK KEZ bozdurur.

    `None` = gecersiz/suresi gecmis/kullanilmis/baska eke ait. Cagiran
    bu ayrimi DISARIYA sizdirmaz: hepsi ayni 404'tur (var olmayan kayit
    ile erisilemeyen kayit ayirt EDILEMEZ).
    """
    if not token:
        return None
    candidate = (
        db.query(TicketDownloadGrant)
        .filter(
            TicketDownloadGrant.token_hash == hash_token(token),
            TicketDownloadGrant.attachment_id == attachment_id,
        )
        .first()
    )
    if candidate is None:
        return None
    # Ozet esitligi zaten indekslenmis bir esitlik; yine de token'in
    # kendisini sabit zamanda dogrula (zamanlama yan kanalini kapat).
    if not hmac.compare_digest(candidate.token_hash, hash_token(token)):
        return None
    if candidate.used_at is not None:
        return None
    expires = candidate.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= _now():
        return None
    candidate.used_at = _now()
    db.flush()
    return candidate


def purge_expired(db: Session, *, older_than_hours: int = 24) -> int:
    """Suresi gecmis izinleri siler (bakim isi).

    Yalnizca BU tabloya dokunur — donmus temizlik katalogu disinda bir
    tabloya asla uzanmaz.
    """
    cutoff = _now() - timedelta(hours=max(1, older_than_hours))
    deleted = (
        db.query(TicketDownloadGrant)
        .filter(TicketDownloadGrant.expires_at < cutoff)
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)
