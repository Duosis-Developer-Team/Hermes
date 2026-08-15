from typing import Optional, Any
from pydantic import BaseModel, EmailStr, Field


# =============================================================================
# Request Schemas
# =============================================================================

class LoginRequest(BaseModel):
    """
    Kullanıcı giriş isteği.
    
    E-posta ve şifre ile login yapmak için kullanılır.
    OAuth2 password flow için username alanı e-posta olarak kullanılır.
    
    Attributes:
        username: Kullanıcı e-posta adresi (OAuth2 standardı için "username")
        password: Kullanıcı şifresi
    """
    username: EmailStr = Field(
        ...,
        description="Kullanıcı e-posta adresi",
        examples=["kullanici@sirket.com"]
    )
    password: str = Field(
        ...,
        description="Kullanıcı şifresi",
        examples=["sifre123"]
    )


# =============================================================================
# Response Schemas
# =============================================================================

class Token(BaseModel):
    """
    JWT token yanıtı.
    
    Başarılı login sonrasında dönen token bilgisi.
    
    Attributes:
        access_token: JWT access token
        token_type: Token tipi (her zaman "bearer")
        expires_in: Token geçerlilik süresi (saniye)
        user: Giriş yapan kullanıcı bilgileri
    """
    access_token: str = Field(
        ...,
        description="JWT access token"
    )
    token_type: str = Field(
        default="bearer",
        description="Token tipi"
    )
    expires_in: int = Field(
        ...,
        description="Token geçerlilik süresi (saniye)"
    )
    user: Optional[Any] = Field(
        default=None,
        description="Giriş yapan kullanıcı bilgileri"
    )
    # WS3 — oturumun hangi organizasyonda acildigi. Frontend bunu
    # basliktaki organizasyon adinda ve query-key namespace'inde kullanir.
    # Yalnizca GUVENLI alanlar: plan, limit, uye sayisi burada DONMEZ.
    tenant: Optional[Any] = Field(
        default=None,
        description="Oturumun acildigi tenant (id, slug, display_name)"
    )
    membership: Optional[Any] = Field(
        default=None,
        description="Kullanicinin bu tenant'taki uyeligi (id, status)"
    )


# =============================================================================
# Internal Schemas
# =============================================================================

class TokenData(BaseModel):
    """
    Token payload verisi.
    
    JWT token decode edildiğinde elde edilen kullanıcı bilgileri.
    Servis içinde authentication middleware tarafından kullanılır.
    
    Attributes:
        user_id: Kullanıcı UUID'si
        email: Kullanıcı e-postası
        is_admin: Admin yetkisi var mı?
    """
    user_id: str = Field(..., description="Kullanıcı UUID")
    email: str = Field(..., description="Kullanıcı e-postası")
    is_admin: bool = Field(default=False, description="Admin mi?")
