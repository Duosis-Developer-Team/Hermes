# =============================================================================
# HERMES PLATFORM - User Schemas (Pydantic)
# =============================================================================
# Bu dosya, User modeli için Pydantic şemalarını tanımlar. Şemalar,
# API isteklerinin validasyonunda ve yanıtların serileştirilmesinde kullanılır.
# =============================================================================

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from enum import Enum

class UserRole(str, Enum):
    """Selectable user roles for the API surface.

    REVIEWER was previously part of the timesheet-review flow and is no
    longer offered as a selectable option in the admin UI / API. The value
    is intentionally retained on the SQLAlchemy model + Postgres ENUM type
    so any historical row stays readable without a destructive
    ALTER TYPE ... DROP VALUE on production data.
    """

    ADMIN = "ADMIN"
    USER = "USER"


# =============================================================================
# Base Schema
# =============================================================================

class UserBase(BaseModel):
    """
    User şemalarının temel sınıfı.
    
    Tüm User şemalarında ortak olan alanları içerir.
    """
    email: EmailStr = Field(
        ...,
        description="Kullanıcı e-posta adresi",
        examples=["kullanici@sirket.com"]
    )
    full_name: Optional[str] = Field(
        None,
        max_length=255,
        description="Kullanıcının tam adı ve soyadı",
        examples=["Ahmet Yılmaz"]
    )


# =============================================================================
# Request Schemas (API'ye Gelen Veriler)
# =============================================================================

class UserCreate(UserBase):
    """
    Yeni kullanıcı oluşturma isteği.
    
    Admin tarafından yeni kullanıcı eklerken kullanılır (FR 3.4).
    
    Attributes:
        email: Kullanıcı e-posta adresi (zorunlu, unique)
        full_name: Tam ad (opsiyonel)
        password: Plain text şifre (zorunlu, min 6 karakter)
        is_admin: Admin rolü atanacak mı? (default: False)
    """
    password: str = Field(
        ...,
        min_length=6,
        max_length=100,
        description="Kullanıcı şifresi (minimum 6 karakter)",
        examples=["guvenli_sifre_123"]
    )
    is_admin: bool = Field(
        default=False,
        description="Kullanıcı admin olarak mı oluşturulsun? (Deprecated: use role)"
    )
    role: UserRole = Field(
        default=UserRole.USER,
        description="Kullanıcı rolü"
    )


class UserUpdate(BaseModel):
    """
    Kullanıcı güncelleme isteği.
    
    Admin tarafından mevcut kullanıcı bilgilerini güncellerken kullanılır.
    Tüm alanlar opsiyoneldir - sadece güncellenmek istenen alanlar gönderilir.
    
    Attributes:
        email: Yeni e-posta adresi (opsiyonel)
        full_name: Yeni tam ad (opsiyonel)
        password: Yeni şifre (opsiyonel)
        is_active: Aktiflik durumu (opsiyonel, soft delete için)
        is_admin: Admin rolü (opsiyonel)
    """
    email: Optional[EmailStr] = Field(
        None,
        description="Yeni e-posta adresi"
    )
    full_name: Optional[str] = Field(
        None,
        max_length=255,
        description="Yeni tam ad"
    )
    password: Optional[str] = Field(
        None,
        min_length=6,
        max_length=100,
        description="Yeni şifre"
    )
    is_active: Optional[bool] = Field(
        None,
        description="Kullanıcı aktif mi?"
    )
    is_admin: Optional[bool] = Field(
        None,
        description="Admin rolü"
    )
    role: Optional[UserRole] = Field(
        None,
        description="Yeni kullanıcı rolü"
    )


# =============================================================================
# Response Schemas (API'dan Dönen Veriler)
# =============================================================================

class UserResponse(UserBase):
    """
    Tekil kullanıcı yanıtı.
    
    Kullanıcı bilgilerini dönerken kullanılır. Hassas bilgiler (şifre)
    bu şemada yer almaz.
    
    Attributes:
        id: Kullanıcı UUID'si
        email: E-posta adresi
        full_name: Tam ad
        is_active: Aktiflik durumu
        is_admin: Admin mi?
        created_at: Oluşturulma tarihi
    """
    id: UUID = Field(..., description="Kullanıcı benzersiz kimliği")
    is_active: bool = Field(..., description="Kullanıcı aktif mi?")
    is_admin: bool = Field(..., description="Kullanıcı admin mi?")
    is_active: bool = Field(..., description="Kullanıcı aktif mi?")
    is_admin: bool = Field(..., description="Kullanıcı admin mi?")
    role: UserRole = Field(..., description="Kullanıcı rolü")
    created_at: datetime = Field(..., description="Hesap oluşturulma tarihi")
    
    # Pydantic v2 config
    model_config = ConfigDict(from_attributes=True)


class UserListResponse(BaseModel):
    """
    Kullanıcı listesi yanıtı.
    
    Tüm kullanıcıları listelerken (GET /users) kullanılır.
    """
    success: bool = True
    data: List[UserResponse]
    total: int = Field(..., description="Toplam kullanıcı sayısı")


# =============================================================================
# Internal Schemas (Servis İçi Kullanım)
# =============================================================================

class UserInDB(UserResponse):
    """
    Veritabanından okunan kullanıcı verisi.
    
    Hash'lenmiş şifreyi içerir - sadece servis içinde kullanılır,
    asla API yanıtında dönülmez.
    """
    hashed_password: str = Field(..., description="Hash'lenmiş şifre")
