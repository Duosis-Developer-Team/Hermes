# =============================================================================
# HERMES PLATFORM - User Model (SQLAlchemy)
# =============================================================================
# Bu dosya, TAD'da (readme2.md) tanımlanan 'users' tablosunun SQLAlchemy
# model tanımını içerir. Tablo yapısı birebir TAD ile uyumludur.
#
# TAD Referansı (auth_db):
# CREATE TABLE users (
#     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
#     email VARCHAR(255) UNIQUE NOT NULL,
#     full_name VARCHAR(255),
#     hashed_password VARCHAR(255) NOT NULL,
#     is_active BOOLEAN DEFAULT true,
#     is_admin BOOLEAN DEFAULT false NOT NULL,
#     created_at TIMESTAMPTZ DEFAULT now()
# );
# =============================================================================

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Enum, Integer
from sqlalchemy.dialects.postgresql import UUID
import enum

class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    USER = "USER"
    REVIEWER = "REVIEWER"

class AuthProvider(str, enum.Enum):
    LOCAL = "LOCAL"
    MICROSOFT = "MICROSOFT"

from ..database import Base


class User(Base):
    """
    Kullanıcı modeli.
    
    Bu model, Hermes platformundaki tüm kullanıcıları temsil eder.
    v1.0'da basit bir rol modeli kullanılır: is_admin flag'i ile
    Admin ve Standart Kullanıcı ayrımı yapılır.
    
    Attributes:
        id (UUID): Benzersiz kullanıcı kimliği (Primary Key)
        email (str): Kullanıcı e-posta adresi (Unique, zorunlu)
        full_name (str): Kullanıcının tam adı (opsiyonel)
        hashed_password (str): Bcrypt ile hash'lenmiş şifre (SSO için opsiyonel)
        is_active (bool): Kullanıcı aktif mi? (soft delete için)
        is_admin (bool): Kullanıcı admin mi? (v1.0 basit rol modeli)
        created_at (datetime): Hesap oluşturulma tarihi
        auth_provider (str): Kimlik sağlayıcı (local, microsoft)
    
    Tablo Adı: users
    Veritabanı: auth_db
    """
    
    __tablename__ = "users"
    
    # ==========================================================================
    # Primary Key
    # ==========================================================================
    
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="Benzersiz kullanıcı kimliği"
    )
    
    # ==========================================================================
    # User Information
    # ==========================================================================
    
    email = Column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
        comment="Kullanıcı e-posta adresi (login için kullanılır)"
    )
    
    full_name = Column(
        String(255),
        nullable=True,
        comment="Kullanıcının tam adı ve soyadı"
    )
    
    hashed_password = Column(
        String(255),
        nullable=True,
        comment="Bcrypt ile hash'lenmiş şifre (SSO kullanıcıları için null olabilir)"
    )
    
    # ==========================================================================
    # Status & Role Flags
    # ==========================================================================
    
    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Kullanıcı aktif mi? (False = soft deleted)"
    )
    
    is_admin = Column(
        Boolean,
        default=False,
        nullable=False,
        comment="Kullanıcı admin mi? (v1.0 basit rol modeli, v1.1'de role ile sync edilir)"
    )

    role = Column(
        Enum(UserRole),
        default=UserRole.USER,
        nullable=False,
        comment="Kullanıcı rolü (ADMIN, USER, REVIEWER)"
    )

    auth_provider = Column(
        Enum(AuthProvider),
        default=AuthProvider.LOCAL,
        nullable=False,
        server_default=AuthProvider.LOCAL.value,
        comment="Kimlik sağlayıcı (local, microsoft)"
    )
    
    # ==========================================================================
    # Timestamps
    # ==========================================================================
    
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="Hesap oluşturulma tarihi"
    )

    # ==========================================================================
    # Oturum iptali (WS2)
    # ==========================================================================
    # Uyelik kaldirildiginda, tenant askiya alindiginda veya sifre
    # sifirlandiginda artirilir. Token yenileme aninda karsilastirilir;
    # eskimis surum tasiyan oturum kabul edilmez. Erisim token'inin
    # kendisi kisa omurludur — belgelenmis azami iptal gecikmesi budur.
    session_version = Column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
        comment="Oturum iptal sayaci (artarsa mevcut oturumlar duser)"
    )
    
    # ==========================================================================
    # String Representation
    # ==========================================================================
    
    def __repr__(self) -> str:
        """Debug için string gösterimi."""
        return f"<User(id={self.id}, email='{self.email}', is_admin={self.is_admin})>"
    
    def __str__(self) -> str:
        """Kullanıcı dostu string gösterimi."""
        return self.full_name or self.email
