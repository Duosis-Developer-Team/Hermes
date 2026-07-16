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
import uuid as _uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.api_client import (
    ApiClient,
    ApiClientAccess,
    ApiRequestLog,
    ApiToken,
)
from ..schemas.api_admin import (
    AccessBinding,
    ApiClientCreate,
    ApiClientUpdate,
    _validate_bindings,
)

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


# =============================================================================
# Client CRUD + binding yonetimi (Stage 2D — admin endpoint'lerinin servisi)
# =============================================================================

def get_client(db: Session, client_id) -> ApiClient:
    client = db.query(ApiClient).filter(ApiClient.id == client_id).first()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API client not found.",
        )
    return client


def get_token(db: Session, token_id) -> ApiToken:
    token = db.query(ApiToken).filter(ApiToken.id == token_id).first()
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found.",
        )
    return token


def list_clients(db: Session) -> List[ApiClient]:
    return db.query(ApiClient).order_by(ApiClient.created_at.desc()).all()


def list_client_bindings(db: Session, client_id) -> List[ApiClientAccess]:
    return (
        db.query(ApiClientAccess)
        .filter(ApiClientAccess.client_id == client_id)
        .order_by(ApiClientAccess.created_at.asc())
        .all()
    )


def list_client_tokens(db: Session, client_id) -> List[ApiToken]:
    return (
        db.query(ApiToken)
        .filter(ApiToken.client_id == client_id)
        .order_by(ApiToken.created_at.desc())
        .all()
    )


def create_client(
    db: Session, data: ApiClientCreate, created_by
) -> ApiClient:
    """Client + binding'leri TEK transaction'da olusturur. Isim cakismasi
    409 doner (unique constraint yarisi dahil)."""
    existing = (
        db.query(ApiClient).filter(ApiClient.name == data.name).first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An API client with this name already exists.",
        )
    client = ApiClient(
        name=data.name,
        description=data.description,
        client_type=data.client_type,
        bound_user_id=data.bound_user_id,
        environment=data.environment,
        scopes=list(data.scopes),
        rate_limit_per_min=data.rate_limit_per_min,
        status="active",
        created_by=created_by,
    )
    db.add(client)
    try:
        db.flush()  # id gerekli
        for b in data.access:
            db.add(
                ApiClientAccess(
                    client_id=client.id,
                    access_type=b.access_type,
                    target_id=b.target_id,
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An API client with this name already exists.",
        )
    db.refresh(client)
    return client


def update_client(
    db: Session, client: ApiClient, data: ApiClientUpdate
) -> ApiClient:
    if data.name is not None and data.name != client.name:
        dup = (
            db.query(ApiClient)
            .filter(ApiClient.name == data.name, ApiClient.id != client.id)
            .first()
        )
        if dup is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An API client with this name already exists.",
            )
        client.name = data.name
    if data.description is not None:
        client.description = data.description
    if data.status is not None:
        client.status = data.status
    if data.scopes is not None:
        client.scopes = list(data.scopes)
    if data.rate_limit_per_min is not None:
        client.rate_limit_per_min = data.rate_limit_per_min
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An API client with this name already exists.",
        )
    db.refresh(client)
    return client


def disable_client(db: Session, client: ApiClient) -> ApiClient:
    """SOFT disable — hicbir satir silinmez. Dogrulama zinciri client
    status'unu her istekte kontrol ettigi icin client'in TUM token'lari
    ANINDA gecersizlesir (amendment #3)."""
    client.status = "disabled"
    db.commit()
    db.refresh(client)
    return client


def replace_bindings(
    db: Session, client: ApiClient, bindings: List[AccessBinding]
) -> List[ApiClientAccess]:
    """Binding setini TRANSACTIONAL olarak degistirir (delete + insert tek
    commit). Kurallar client baglamiyla yeniden dogrulanir (amendment #5/#6
    — sema katmanindan bagimsiz, derinlemesine savunma)."""
    try:
        _validate_bindings(
            bindings,
            client_type=client.client_type,
            bound_user_id=client.bound_user_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
    try:
        db.query(ApiClientAccess).filter(
            ApiClientAccess.client_id == client.id
        ).delete(synchronize_session=False)
        for b in bindings:
            db.add(
                ApiClientAccess(
                    client_id=client.id,
                    access_type=b.access_type,
                    target_id=b.target_id,
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Duplicate access binding.",
        )
    return list_client_bindings(db, client.id)


def update_token_expiry(
    db: Session, token: ApiToken, expires_at: Optional[datetime]
) -> ApiToken:
    """Aktif token'in omrunu gunceller (None = suresiz). Gecmis tarih 400;
    revoked token 409."""
    if token.status == "revoked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked token cannot be updated.",
        )
    if expires_at is not None and expires_at <= _now():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expires_at must be in the future.",
        )
    token.expires_at = expires_at
    db.commit()
    db.refresh(token)
    return token


def list_request_logs(
    db: Session,
    *,
    limit: int = 50,
    offset: int = 0,
    client_id=None,
    status_code: Optional[int] = None,
    created_from: Optional[datetime] = None,
    created_to: Optional[datetime] = None,
    request_id: Optional[str] = None,
) -> List[ApiRequestLog]:
    """Audit kayitlari (filtreli + sayfali). Kayitlarda token/hash/govde
    zaten YOKTUR (yazim katmani garanti eder)."""
    q = db.query(ApiRequestLog)
    conds = []
    if client_id is not None:
        conds.append(ApiRequestLog.client_id == client_id)
    if status_code is not None:
        conds.append(ApiRequestLog.status_code == status_code)
    if created_from is not None:
        conds.append(ApiRequestLog.created_at >= created_from)
    if created_to is not None:
        conds.append(ApiRequestLog.created_at <= created_to)
    if request_id:
        conds.append(ApiRequestLog.request_id == request_id.strip())
    if conds:
        q = q.filter(and_(*conds))
    return (
        q.order_by(ApiRequestLog.created_at.desc())
        .offset(offset)
        .limit(min(max(limit, 1), 200))
        .all()
    )
