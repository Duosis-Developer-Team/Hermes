# =============================================================================
# HERMES - API client / token servisi (Stage 2B)
# =============================================================================
# Token yasam dongusu: uretim → dogrulama → revoke → rotate.
#
# Guvenlik kararlari (onayli plan + amendment'lar):
#   - Plaintext token YALNIZCA uretim/rotate aninda return edilir; DB'de,
#     logda, hata mesajinda ASLA yer almaz.
#   - Saklanan: SHA-256 hex digest (UNIQUE index → O(1) lookup) + gosterim
#     icin ilk 12 karakterlik prefix.
#   - Karsilastirma: index lookup + hmac.compare_digest (amendment #2).
#   - Rotation TRANSACTIONAL'dir: yeni token + eskinin revoke'u tek
#     commit'te — yarim kalan rotation erisim kaybina yol acamaz
#     (amendment #4).
# =============================================================================

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models.api_client import ApiClient, ApiToken

TOKEN_PREFIX_LEN = 12
_ENV_TAG = {"dev": "dev", "live": "live"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(plaintext: str) -> str:
    """SHA-256 hex digest. API token'lari >=256-bit rastgele oldugu icin
    hizli hash guvenlidir (bcrypt parola-sinifi dusuk-entropi girdiler
    icindir; her istekte ~100ms maliyet + DoS yuzeyi olusturur)."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def hashes_equal(a: str, b: str) -> bool:
    """Sabit zamanli karsilastirma (amendment #2)."""
    return hmac.compare_digest(a, b)


def generate_token(environment: str) -> Tuple[str, str, str]:
    """(plaintext, prefix, hash) uclusu uretir. Cagiran plaintext'i BIR KEZ
    gosterir ve bir daha erisemez."""
    tag = _ENV_TAG.get(environment)
    if tag is None:
        raise ValueError(f"unknown token environment: {environment}")
    secret = secrets.token_urlsafe(32)  # ~256 bit CSPRNG
    plaintext = f"hms_{tag}_{secret}"
    return plaintext, plaintext[:TOKEN_PREFIX_LEN], hash_token(plaintext)


def create_token(
    db: Session,
    client: ApiClient,
    *,
    expires_at: Optional[datetime],
    created_by,
    rotated_from: Optional[ApiToken] = None,
    commit: bool = True,
) -> Tuple[str, ApiToken]:
    """Yeni credential uretir. `commit=False` rotate'in tek-transaction
    garantisi icindir. Plaintext yalnizca donus degerindedir."""
    if expires_at is not None and expires_at <= _now():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expires_at must be in the future.",
        )
    plaintext, prefix, digest = generate_token(client.environment)
    row = ApiToken(
        client_id=client.id,
        token_prefix=prefix,
        token_hash=digest,
        status="active",
        expires_at=expires_at,
        rotated_from_token_id=rotated_from.id if rotated_from else None,
        created_by=created_by,
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    else:
        db.flush()
    return plaintext, row


def revoke_token(db: Session, token: ApiToken, *, commit: bool = True) -> ApiToken:
    """Idempotent revoke: zaten revoke edilmisse dokunmaz."""
    if token.status != "revoked":
        token.status = "revoked"
        token.revoked_at = _now()
    if commit:
        db.commit()
        db.refresh(token)
    return token


def rotate_token(
    db: Session,
    token: ApiToken,
    client: ApiClient,
    *,
    created_by,
) -> Tuple[str, ApiToken]:
    """TRANSACTIONAL rotate (amendment #4): yeni credential olusturulur ve
    eski revoke edilir — TEK commit. Commit basarisiz olursa iki islem de
    geri alinir; 'eski gitti, yenisi yok' durumu olusamaz."""
    if token.status == "revoked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked token cannot be rotated.",
        )
    try:
        plaintext, new_row = create_token(
            db,
            client,
            expires_at=token.expires_at,
            created_by=created_by,
            rotated_from=token,
            commit=False,
        )
        revoke_token(db, token, commit=False)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    db.refresh(new_row)
    return plaintext, new_row
