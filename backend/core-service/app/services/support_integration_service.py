# =============================================================================
# HERMES core — Support integration credential'lari
# =============================================================================
# Kaynak uygulamalarin (LogiSlot ve gelecekteki urunler) sunucu-sunucu
# kimligi. Public API'nin `api_clients` altyapisi BILEREK yeniden
# kullanilmadi:
#
#   1) Public API'nin donmus kurali "service client'lar READ-ONLY"dir ve
#      testle kilitlidir; ticket ingress'i tam tersini gerektirir.
#      O kurali gevsetmek, tum public yuzeyde yazma yapabilen service
#      token'lari acmak demekti.
#   2) Public API tek bir hata zarfina (code/message/request_id) donmus
#      durumda; ticket sozlesmesi `correlation_id` + `retryable` ISTER.
#   3) Public API'de tenant, token BULUNMADAN bilinemez ve bu yuzden
#      ayricalikli bir SECURITY DEFINER lookup gerekiyordu. BURADA boyle
#      bir problem YOKTUR: support tenant'i sunucu konfigurasyonundan
#      bilinir, yani ayricalikli yol HIC acilmaz.
#
# Guvenlik ilkeleri AYNEN korunur: SHA-256 hash'li saklama, plaintext
# yalnizca uretim aninda, prefix, expiry, revoke, rotation izi,
# last-used metadata'si, sabit zamanli karsilastirma.
# =============================================================================

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.ticketing import (
    SupportApplication,
    SupportIntegrationClient,
    SupportIntegrationToken,
)
from ..ticket_contract import SUPPORT_SCOPES
from .api_client_service import hash_token, hashes_equal
from .ticket_service import TicketValidationError
from .ticket_text import sanitize_single_line

# Public API token'lariyla KARISMASIN diye ayri onek: bir `hms_` token'i
# support ucuna, bir `hsi_` token'i public API'ye ASLA gecemez.
TOKEN_PREFIX = "hsi"
TOKEN_PREFIX_LEN = 12
_ENV_TAG = {"dev": "dev", "live": "live"}


def _now():
    return datetime.now(timezone.utc)


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def generate_token(environment: str) -> Tuple[str, str, str]:
    tag = _ENV_TAG.get(environment)
    if tag is None:
        raise ValueError(f"unknown token environment: {environment}")
    secret = secrets.token_urlsafe(32)  # ~256 bit CSPRNG
    plaintext = f"{TOKEN_PREFIX}_{tag}_{secret}"
    return plaintext, plaintext[:TOKEN_PREFIX_LEN], hash_token(plaintext)


def valid_prefixes() -> Tuple[str, ...]:
    return tuple(f"{TOKEN_PREFIX}_{tag}_" for tag in _ENV_TAG.values())


# =============================================================================
# Client yonetimi
# =============================================================================

def validate_scopes(scopes) -> List[str]:
    unknown = [s for s in (scopes or []) if s not in SUPPORT_SCOPES]
    if unknown:
        raise TicketValidationError(
            "Unknown support scope(s): " + ", ".join(sorted(unknown))
        )
    if not scopes:
        raise TicketValidationError(
            "An integration client needs at least one scope."
        )
    return sorted(set(scopes))


def create_client(
    db: Session,
    *,
    application: SupportApplication,
    name: str,
    scopes,
    description: Optional[str] = None,
    rate_limit_per_min: Optional[int] = None,
    created_by_user_id=None,
) -> SupportIntegrationClient:
    client = SupportIntegrationClient(
        application_id=application.id,
        name=sanitize_single_line(name, max_length=120),
        description=description,
        environment=application.environment,
        scopes=validate_scopes(scopes),
        rate_limit_per_min=rate_limit_per_min,
        status="active",
        created_by_user_id=created_by_user_id,
    )
    db.add(client)
    db.flush()
    return client


def update_client(
    db: Session,
    client: SupportIntegrationClient,
    *,
    scopes=None,
    status: Optional[str] = None,
    rate_limit_per_min: Optional[int] = None,
) -> SupportIntegrationClient:
    if scopes is not None:
        client.scopes = validate_scopes(scopes)
    if status is not None:
        if status not in ("active", "disabled"):
            raise TicketValidationError("Unknown client status.")
        client.status = status
    if rate_limit_per_min is not None:
        client.rate_limit_per_min = rate_limit_per_min or None
    client.updated_at = _now()
    db.flush()
    return client


def list_clients(db: Session) -> List[SupportIntegrationClient]:
    return (
        db.query(SupportIntegrationClient)
        .order_by(SupportIntegrationClient.name)
        .all()
    )


# =============================================================================
# Token yonetimi
# =============================================================================

def issue_token(
    db: Session,
    client: SupportIntegrationClient,
    *,
    expires_at: Optional[datetime] = None,
    created_by_user_id=None,
    rotated_from: Optional[SupportIntegrationToken] = None,
) -> Tuple[str, SupportIntegrationToken]:
    """Yeni credential. Plaintext YALNIZCA donus degerinde bulunur ve
    bir daha hicbir yerden okunamaz."""
    if expires_at is not None and _aware(expires_at) <= _now():
        raise TicketValidationError("Expiry must be in the future.")
    plaintext, prefix, digest = generate_token(client.environment)
    token = SupportIntegrationToken(
        client_id=client.id,
        token_prefix=prefix,
        token_hash=digest,
        status="active",
        expires_at=expires_at,
        created_by_user_id=created_by_user_id,
        rotated_from_token_id=rotated_from.id if rotated_from else None,
    )
    db.add(token)
    db.flush()
    return plaintext, token


def revoke_token(
    db: Session, token: SupportIntegrationToken
) -> SupportIntegrationToken:
    token.status = "revoked"
    token.revoked_at = _now()
    db.flush()
    return token


def list_tokens(
    db: Session, client_id
) -> List[SupportIntegrationToken]:
    return (
        db.query(SupportIntegrationToken)
        .filter(SupportIntegrationToken.client_id == client_id)
        .order_by(SupportIntegrationToken.created_at.desc())
        .all()
    )


# =============================================================================
# Kimlik dogrulama
# =============================================================================

class AuthFailure(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def authenticate(
    db: Session, raw_token: str
) -> Tuple[SupportIntegrationClient, SupportApplication,
           SupportIntegrationToken]:
    """Bearer token → (client, application, token).

    Sira guvenlik geregi sabittir: format → hash → indexed lookup →
    sabit-zamanli teyit → revoked → expired → client disabled → ortam
    eslesmesi → application aktif mi.

    Hicbir hata mesaji token/hash DEGERI icermez ve tum basarisizliklar
    ayni sozlesme koduna (`unauthorized`) duser — istemci hangi asamada
    takildigini ogrenemez.
    """
    token_value = (raw_token or "").strip()
    if not token_value.startswith(valid_prefixes()) or len(token_value) < 20:
        raise AuthFailure("unauthorized", "Invalid support API token.")

    digest = hash_token(token_value)
    token = (
        db.query(SupportIntegrationToken)
        .filter(SupportIntegrationToken.token_hash == digest)
        .first()
    )
    if token is None or not hashes_equal(token.token_hash, digest):
        raise AuthFailure("unauthorized", "Invalid support API token.")
    if token.status != "active":
        raise AuthFailure("unauthorized", "Invalid support API token.")
    expires = _aware(token.expires_at)
    if expires is not None and expires <= _now():
        raise AuthFailure("unauthorized", "Invalid support API token.")

    client = db.get(SupportIntegrationClient, token.client_id)
    if client is None or client.status != "active":
        raise AuthFailure("unauthorized", "Invalid support API token.")
    if client.environment != get_settings().PUBLIC_API_ENV:
        raise AuthFailure("unauthorized", "Invalid support API token.")

    application = db.get(SupportApplication, client.application_id)
    if application is None or application.status != "active":
        raise AuthFailure("unauthorized", "Invalid support API token.")

    return client, application, token


def touch_last_used(
    db: Session, token: SupportIntegrationToken, ip: Optional[str]
) -> None:
    """En fazla dakikada bir yazilan metadata; yazma amplifikasyonunu
    onler ve basarisizligi istegi ASLA bozmaz."""
    now = _now()
    last = _aware(token.last_used_at)
    if last is not None and (now - last).total_seconds() < 60:
        return
    token.last_used_at = now
    token.last_used_ip = (ip or None)
