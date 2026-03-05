# =============================================================================
# HERMES PLATFORM - JWT Authentication & Authorization
# =============================================================================
# [KRİTİK-2] RS256 asimetrik JWT mimarisi:
#   - auth-service: JWT_PRIVATE_KEY ile TOKEN ÜRETIR (imzalar)
#   - core-service / reporting-service: JWT_PUBLIC_KEY ile DOĞRULAR ONLY
#
# [KRİTİK-6] Token taşıma: HttpOnly + Secure + SameSite=strict cookie
#   Öncelik: 1) HttpOnly cookie  2) Bearer header (Swagger UI / servisler arası)
# =============================================================================

import os
import sys
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

import jwt
from jwt.exceptions import PyJWTError as JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from .exceptions import UnauthorizedError, ForbiddenError

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration — RS256 Asimetrik Anahtar Yükleme
# =============================================================================
#
# K8s secret'lar dosya olarak mount edilir; içerik env variable olarak okunur.
# Dosya yolu veya doğrudan PEM string her ikisi de desteklenir.
#
# auth-service Deployment'ında:
#   JWT_PRIVATE_KEY → hermes-jwt-auth secret'ından (private + public)
#   JWT_PUBLIC_KEY  → hermes-jwt-auth secret'ından
#
# core/reporting Deployment'larında:
#   JWT_PUBLIC_KEY  → hermes-jwt-public secret'ından (yalnızca public)
#   JWT_PRIVATE_KEY → TANIMLI DEĞİL (kasıtlı)
# =============================================================================

ALGORITHM = "RS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))

# Cookie adı — tüm servisler ve frontend'de tutarlı
ACCESS_TOKEN_COOKIE_NAME = "access_token"


def _load_pem_key(env_var: str) -> Optional[str]:
    """
    Ortam değişkeninden PEM anahtar içeriğini yükler.

    K8s'te secret'lar dosya olarak mount edilebilir. Bu durumda env variable
    dosya yolunu içerir. Alternatif olarak doğrudan PEM string'i olabilir
    (literal '\\n' karakterleri normalize edilir).
    """
    raw = os.getenv(env_var)
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("/") or raw.startswith("./"):
        try:
            with open(raw, "r") as f:
                return f.read().strip()
        except OSError as exc:
            print(
                f"FATAL: {env_var} dosyası okunamadı: {exc}",
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)
    # Düz PEM string — literal \n → gerçek newline
    return raw.replace("\\n", "\n")


# Token imzalama anahtarı — YALNIZCA auth-service'te tanımlı
SIGNING_KEY: Optional[str] = _load_pem_key("JWT_PRIVATE_KEY")

# Token doğrulama anahtarı — TÜM servislerde zorunlu
VERIFY_KEY: Optional[str] = _load_pem_key("JWT_PUBLIC_KEY")

if not VERIFY_KEY:
    print(
        "FATAL: JWT_PUBLIC_KEY ortam değişkeni tanımlı değil. "
        "Uygulama güvenli biçimde başlatılamıyor.",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 Bearer şeması — Swagger UI ve servisler arası çağrılar için
# auto_error=False: token bulunamazsa exception değil None döner (cookie'ye düşer)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


# =============================================================================
# Token Data Models
# =============================================================================

class TokenData(BaseModel):
    """JWT token'dan çıkarılan kullanıcı bilgileri."""
    user_id: str
    email: str
    is_admin: bool = False
    exp: Optional[datetime] = None


class CurrentUser(BaseModel):
    """Aktif kullanıcı bilgilerini taşıyan model."""
    id: str
    email: str
    is_admin: bool = False


# =============================================================================
# Password Hashing
# =============================================================================

def hash_password(password: str) -> str:
    """Şifreyi bcrypt ile hash'ler."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Plain text şifreyi hash ile karşılaştırır."""
    return pwd_context.verify(plain_password, hashed_password)


# =============================================================================
# JWT Token Operations
# =============================================================================

def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    RS256 private key ile imzalanmış JWT access token oluşturur.

    YALNIZCA auth-service bu fonksiyonu çağırabilir.
    Diğer servisler JWT_PRIVATE_KEY'e sahip olmadığından RuntimeError alır.

    Args:
        data: Zorunlu: user_id, email. Opsiyonel: is_admin.
        expires_delta: Token geçerlilik süresi.

    Returns:
        RS256 imzalı JWT string.

    Raises:
        RuntimeError: JWT_PRIVATE_KEY bu serviste tanımlı değilse.
    """
    if not SIGNING_KEY:
        raise RuntimeError(
            "create_access_token yalnızca auth-service içinde çağrılabilir. "
            "JWT_PRIVATE_KEY bu serviste tanımlı değil."
        )

    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})

    return jwt.encode(to_encode, SIGNING_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> TokenData:
    """
    JWT token'ı RS256 public key ile doğrular ve decode eder.

    Args:
        token: JWT token string.

    Returns:
        TokenData nesnesi.

    Raises:
        UnauthorizedError: Token geçersiz veya süresi dolmuşsa.
    """
    try:
        # VERIFY_KEY None olamaz — modül yüklenirken kontrol edildi (sys.exit)
        payload = jwt.decode(token, VERIFY_KEY, algorithms=[ALGORITHM])  # type: ignore[arg-type]

        user_id: Optional[str] = payload.get("user_id")
        email: Optional[str] = payload.get("email")
        is_admin: bool = payload.get("is_admin", False)

        if user_id is None or email is None:
            raise UnauthorizedError("Token içeriği geçersiz")

        return TokenData(user_id=user_id, email=email, is_admin=is_admin)

    except JWTError as e:
        # [KRİTİK-4] Anahtar veya hata detayı asla loglanmaz / istemciye dönmez.
        logger.warning(
            "JWT doğrulama başarısız",
            extra={"error_type": type(e).__name__},
        )
        raise UnauthorizedError("Kimlik doğrulama başarısız")


# =============================================================================
# Token Extraction — Cookie öncelikli, Bearer header fallback
# =============================================================================

def _extract_token(request: Request, bearer_token: Optional[str]) -> Optional[str]:
    """
    İstekten JWT token'ı çıkarır.

    Öncelik:
      1. HttpOnly cookie ("access_token") — tarayıcı istekleri
      2. Authorization: Bearer <token> — Swagger UI / servisler arası
    """
    cookie_token = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    return bearer_token or None


# =============================================================================
# FastAPI Dependencies
# =============================================================================

async def get_current_user(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> CurrentUser:
    """
    HttpOnly cookie veya Bearer header'dan kullanıcıyı doğrular.

    Cookie varsa önceliklidir (tarayıcı akışı).
    Cookie yoksa Bearer header'a düşer (Swagger UI / M2M).

    Raises:
        HTTPException 401: Token bulunamazsa veya geçersizse.
    """
    token = _extract_token(request, bearer_token)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kimlik doğrulama gerekli",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        token_data = verify_token(token)
        return CurrentUser(
            id=token_data.user_id,
            email=token_data.email,
            is_admin=token_data.is_admin,
        )
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e.message),
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """
    Kullanıcının admin olduğunu doğrular.

    Raises:
        HTTPException 403: Admin yetkisi yoksa.
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu işlem için admin yetkisi gereklidir",
        )
    return current_user


async def get_current_user_optional(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> Optional[CurrentUser]:
    """
    Opsiyonel kimlik doğrulama. Token yoksa veya geçersizse None döner.
    """
    token = _extract_token(request, bearer_token)
    if not token:
        return None

    try:
        token_data = verify_token(token)
        return CurrentUser(
            id=token_data.user_id,
            email=token_data.email,
            is_admin=token_data.is_admin,
        )
    except UnauthorizedError:
        return None
