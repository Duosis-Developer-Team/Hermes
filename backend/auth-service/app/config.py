# =============================================================================
# HERMES PLATFORM - Auth Service Configuration
# =============================================================================
# Bu dosya, auth-service için gerekli tüm yapılandırma ayarlarını yönetir.
# Environment variable'lar Pydantic Settings ile okunur ve doğrulanır.
# =============================================================================

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Auth Service yapılandırma ayarları.
    
    Tüm ayarlar environment variable'lardan okunur. Geliştirme ortamı için
    varsayılan değerler tanımlanmıştır.
    
    Environment Variables:
        - AUTH_DB_HOST: PostgreSQL host adresi
        - AUTH_DB_PORT: PostgreSQL port numarası
        - AUTH_DB_USER: Veritabanı kullanıcı adı
        - AUTH_DB_PASSWORD: Veritabanı şifresi
        - AUTH_DB_NAME: Veritabanı adı
        - JWT_SECRET_KEY: JWT token imzalama anahtarı (üretimde mutlaka değiştirin!)
        - JWT_ALGORITHM: JWT algoritması (default: HS256)
        - JWT_EXPIRE_MINUTES: Token geçerlilik süresi (dakika)
    """
    
    # ==========================================================================
    # Service Configuration
    # ==========================================================================
    
    # Servis adı ve versiyonu
    SERVICE_NAME: str = "auth-service"
    SERVICE_VERSION: str = "1.0.0"
    
    # Debug modu (üretimde False olmalı)
    DEBUG: bool = False
    
    # ==========================================================================
    # Database Configuration (PostgreSQL - auth_db)
    # ==========================================================================
    
    AUTH_DB_HOST: str = "localhost"
    AUTH_DB_PORT: int = 5432
    AUTH_DB_USER: str = "hermes"
    AUTH_DB_PASSWORD: str = "hermes_dev_password"
    AUTH_DB_NAME: str = "auth_db"
    
    @property
    def database_url(self) -> str:
        """
        SQLAlchemy için PostgreSQL bağlantı URL'i oluşturur.
        
        Returns:
            PostgreSQL bağlantı string'i
        """
        return (
            f"postgresql://{self.AUTH_DB_USER}:{self.AUTH_DB_PASSWORD}"
            f"@{self.AUTH_DB_HOST}:{self.AUTH_DB_PORT}/{self.AUTH_DB_NAME}"
        )
    
    @property
    def async_database_url(self) -> str:
        """
        Async SQLAlchemy için PostgreSQL bağlantı URL'i.
        
        Returns:
            AsyncPG destekli bağlantı string'i
        """
        return (
            f"postgresql+asyncpg://{self.AUTH_DB_USER}:{self.AUTH_DB_PASSWORD}"
            f"@{self.AUTH_DB_HOST}:{self.AUTH_DB_PORT}/{self.AUTH_DB_NAME}"
        )
    
    # ==========================================================================
    # JWT Configuration — RS256 Asimetrik (KRİTİK-2)
    # ==========================================================================
    #
    # auth-service: Hem private hem public key'e sahip olmalı.
    #   JWT_PRIVATE_KEY → shared/auth.py'de SIGNING_KEY olarak yüklenir
    #   JWT_PUBLIC_KEY  → shared/auth.py'de VERIFY_KEY olarak yüklenir
    #
    # Bu değerler shared/auth.py modülü tarafından doğrudan env'den okunur;
    # burada yalnızca expire süresi ayarlanır.
    # ==========================================================================

    JWT_EXPIRE_MINUTES: int = 60  # 1 saat
    
    # ==========================================================================
    # Azure AD / SSO Configuration
    # ==========================================================================
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    AZURE_TENANT_ID: str = ""
    ALLOWED_EMAIL_DOMAIN: str = "duosis.com"
    
    # ==========================================================================
    # CORS Configuration
    # ==========================================================================
    
    # İzin verilen origin'ler (frontend URL'leri)
    CORS_ORIGINS: list = [
        "http://localhost:3000",      # React dev server
        "http://localhost:5173",      # Vite dev server
        "http://127.0.0.1:5173",
        "https://84.247.180.172:30772", # Ingress Dev Access
        "http://84.247.180.172:30772",
    ]
    
    # ==========================================================================
    # Pydantic Settings Configuration
    # ==========================================================================
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """
    Singleton Settings instance döner.
    
    lru_cache ile aynı Settings instance'ı tekrar tekrar kullanılır,
    böylece her istekte yeniden oluşturulmaz.
    
    Returns:
        Settings instance
    
    Kullanım:
        settings = get_settings()
        print(settings.database_url)
    """
    return Settings()
