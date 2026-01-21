# =============================================================================
# HERMES PLATFORM - JWT Authentication & Authorization
# =============================================================================
# Bu dosya, JWT token doğrulama ve kullanıcı yetkilendirme fonksiyonlarını
# içerir. Tüm mikroservisler bu modülü kullanarak gelen isteklerin kimlik
# doğrulamasını ve yetkilendirmesini yapar.
# =============================================================================

import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from .exceptions import UnauthorizedError, ForbiddenError


# =============================================================================
# Configuration
# =============================================================================

# JWT ayarları - environment variable'lardan okunur
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "hermes-dev-secret-key-change-in-production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))

# Password hashing için context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 şeması - Token URL auth-service tarafından sağlanır
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


# =============================================================================
# Token Data Model
# =============================================================================

class TokenData(BaseModel):
    """
    JWT token'dan çıkarılan kullanıcı bilgileri.
    
    Attributes:
        user_id: Kullanıcının UUID'si
        email: Kullanıcı e-postası
        is_admin: Admin yetkisi var mı
        exp: Token son kullanma tarihi
    """
    user_id: str
    email: str
    is_admin: bool = False
    exp: Optional[datetime] = None


class CurrentUser(BaseModel):
    """
    Aktif kullanıcı bilgilerini taşıyan model.
    
    Tüm authenticated endpoint'lerde dependency olarak kullanılır.
    """
    id: str
    email: str
    is_admin: bool = False


# =============================================================================
# Password Hashing
# =============================================================================

def hash_password(password: str) -> str:
    """
    Şifreyi bcrypt ile hash'ler.
    
    Args:
        password: Plain text şifre
    
    Returns:
        Hash'lenmiş şifre string'i
    
    Kullanım:
        hashed = hash_password("my_secure_password")
    """
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Plain text şifreyi hash ile karşılaştırır.
    
    Args:
        plain_password: Kullanıcının girdiği şifre
        hashed_password: Veritabanındaki hash'lenmiş şifre
    
    Returns:
        True eğer eşleşiyorsa, False değilse
    """
    return pwd_context.verify(plain_password, hashed_password)


# =============================================================================
# JWT Token Operations
# =============================================================================

def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Yeni bir JWT access token oluşturur.
    
    Args:
        data: Token payload'ına eklenecek veriler
              Zorunlu alanlar: user_id, email
              Opsiyonel: is_admin
        expires_delta: Token geçerlilik süresi (default: 60 dakika)
    
    Returns:
        Encoded JWT token string
    
    Örnek kullanım:
        token = create_access_token(
            data={"user_id": "uuid-123", "email": "user@example.com", "is_admin": False}
        )
    """
    to_encode = data.copy()
    
    # Token süresini belirle
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    
    # Token'ı encode et
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> TokenData:
    """
    JWT token'ı doğrular ve decode eder.
    
    Args:
        token: JWT token string
    
    Returns:
        TokenData nesnesi (kullanıcı bilgileri)
    
    Raises:
        UnauthorizedError: Token geçersiz veya süresi dolmuşsa
    
    Örnek kullanım:
        try:
            token_data = verify_token(token)
            print(f"User: {token_data.email}")
        except UnauthorizedError:
            print("Invalid token")
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        
        user_id: str = payload.get("user_id")
        email: str = payload.get("email")
        is_admin: bool = payload.get("is_admin", False)
        
        if user_id is None or email is None:
            raise UnauthorizedError("Token içeriği geçersiz")
        
        return TokenData(
            user_id=user_id,
            email=email,
            is_admin=is_admin
        )
    
    except JWTError as e:
        raise UnauthorizedError(f"Token doğrulanamadı: {str(e)}")


# =============================================================================
# FastAPI Dependencies
# =============================================================================

async def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    """
    Mevcut kullanıcıyı JWT token'dan çıkarır.
    
    Bu fonksiyon FastAPI dependency olarak kullanılır ve tüm authenticated
    endpoint'lerde otomatik olarak çağrılır.
    
    Args:
        token: Authorization header'dan alınan Bearer token
    
    Returns:
        CurrentUser nesnesi
    
    Raises:
        HTTPException 401: Token geçersizse
    
    Kullanım:
        @router.get("/me")
        async def get_me(current_user: CurrentUser = Depends(get_current_user)):
            return current_user
    """
    try:
        token_data = verify_token(token)
        return CurrentUser(
            id=token_data.user_id,
            email=token_data.email,
            is_admin=token_data.is_admin
        )
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e.message),
            headers={"WWW-Authenticate": "Bearer"}
        )


async def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """
    Kullanıcının admin olduğunu doğrular.
    
    Bu fonksiyon sadece admin kullanıcıların erişebileceği endpoint'lerde
    dependency olarak kullanılır.
    
    Args:
        current_user: Token'dan çıkarılan kullanıcı bilgisi
    
    Returns:
        CurrentUser nesnesi (admin doğrulandıysa)
    
    Raises:
        HTTPException 403: Kullanıcı admin değilse
    
    Kullanım:
        @router.post("/users")
        async def create_user(
            user_data: UserCreate,
            admin: CurrentUser = Depends(require_admin)
        ):
            # Sadece admin'ler bu endpoint'e erişebilir
            ...
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu işlem için admin yetkisi gereklidir"
        )
    return current_user


# =============================================================================
# Optional: Get current user without requiring authentication
# =============================================================================

async def get_current_user_optional(
    token: Optional[str] = Depends(oauth2_scheme)
) -> Optional[CurrentUser]:
    """
    Opsiyonel olarak kullanıcıyı doğrular.
    
    Token yoksa veya geçersizse None döner, hata fırlatmaz.
    Hem authenticated hem de anonim kullanıcıların erişebildiği
    endpoint'lerde kullanılır.
    
    Returns:
        CurrentUser veya None
    
    Kullanım:
        @router.get("/public-endpoint")
        async def public_endpoint(
            current_user: Optional[CurrentUser] = Depends(get_current_user_optional)
        ):
            if current_user:
                return {"message": f"Merhaba {current_user.email}"}
            else:
                return {"message": "Merhaba misafir"}
    """
    if not token:
        return None
    
    try:
        token_data = verify_token(token)
        return CurrentUser(
            id=token_data.user_id,
            email=token_data.email,
            is_admin=token_data.is_admin
        )
    except UnauthorizedError:
        return None
