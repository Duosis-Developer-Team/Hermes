# =============================================================================
# HERMES PLATFORM - Core Service Configuration
# =============================================================================
# Bu dosya, core-service için gerekli tüm yapılandırma ayarlarını yönetir.
# Environment variable'lar Pydantic Settings ile okunur ve doğrulanır.
# =============================================================================

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Core Service yapılandırma ayarları.
    
    Tüm ayarlar environment variable'lardan okunur. Geliştirme ortamı için
    varsayılan değerler tanımlanmıştır.
    
    Environment Variables:
        - CORE_DB_HOST: PostgreSQL host adresi
        - CORE_DB_PORT: PostgreSQL port numarası
        - CORE_DB_USER: Veritabanı kullanıcı adı
        - CORE_DB_PASSWORD: Veritabanı şifresi
        - CORE_DB_NAME: Veritabanı adı
        - JWT_SECRET_KEY: JWT token doğrulama anahtarı
        - AUTH_SERVICE_URL: auth-service'in iç URL'i
    """
    
    # ==========================================================================
    # Service Configuration
    # ==========================================================================
    
    SERVICE_NAME: str = "core-service"
    SERVICE_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # ==========================================================================
    # Database Configuration (PostgreSQL - core_db)
    # ==========================================================================
    
    CORE_DB_HOST: str = "localhost"
    CORE_DB_PORT: int = 5433  # auth_db'den farklı port
    CORE_DB_USER: str = "hermes"
    CORE_DB_PASSWORD: str = "hermes_dev_password"
    CORE_DB_NAME: str = "core_db"
    
    @property
    def database_url(self) -> str:
        """SQLAlchemy için PostgreSQL bağlantı URL'i."""
        return (
            f"postgresql://{self.CORE_DB_USER}:{self.CORE_DB_PASSWORD}"
            f"@{self.CORE_DB_HOST}:{self.CORE_DB_PORT}/{self.CORE_DB_NAME}"
        )
    
    # ==========================================================================
    # JWT Configuration — RS256 Asimetrik (KRİTİK-2)
    # ==========================================================================
    #
    # core-service: YALNIZCA JWT_PUBLIC_KEY kullanır (doğrulama).
    # Private key bu serviste TANIMLI DEĞİL — kasıtlı izolasyon.
    #
    # JWT_PUBLIC_KEY → shared/auth.py'de VERIFY_KEY olarak yüklenir.
    # K8s'te hermes-jwt-public secret'ına bağlıdır.
    # ==========================================================================
    
    # ==========================================================================
    # Service URLs (Mikroservisler arası iletişim)
    # ==========================================================================
    
    # Kubernetes içinde: http://auth-service
    AUTH_SERVICE_URL: str = "http://localhost:8000"

    # ==========================================================================
    # Microsoft Graph (Meetings module — Stage 2)
    # ==========================================================================
    # App-only client credentials flow against Azure AD. All three values
    # must be set together for sync to work. When any one is missing the
    # graph client refuses to initialise and the Meetings sync endpoint
    # returns a structured "not configured" error — the app itself
    # never crashes on startup just because Graph is unconfigured.
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    GRAPH_AUTHORITY: str = "https://login.microsoftonline.com"
    GRAPH_BASE_URL: str = "https://graph.microsoft.com/v1.0"
    GRAPH_SCOPE: str = "https://graph.microsoft.com/.default"

    # ==========================================================================
    # Task assignment e-mail notifications
    # ==========================================================================
    # Sent via Microsoft Graph (reuses the AZURE_*/GRAPH_* app credentials
    # above — no separate mailbox password). When NOTIFICATIONS_ENABLED is
    # false, or Graph isn't configured, notifications are skipped silently;
    # task creation never fails because of e-mail.
    NOTIFICATIONS_ENABLED: bool = False
    # Mailbox the notification is sent *as* (must be a real mailbox the
    # Azure app is allowed to send from — Mail.Send application permission).
    NOTIF_MAIL_SENDER: str = "hermes@duosis.com"
    # Also e-mail the assigner ("you assigned a task to X"). The assignee
    # is always notified when notifications are enabled.
    NOTIF_NOTIFY_ASSIGNER: bool = True
    # Public app URL used to build a "View task" link in the e-mail. When
    # empty the e-mail simply omits the button.
    APP_BASE_URL: str = ""

    # ==========================================================================
    # Public API (dis entegrasyonlar)
    # ==========================================================================

    # Bu deployment'in token ortami: 'dev' cluster'inda "dev",
    # test/prod'da "live" (promote sirasinda kubectl set env ile — additive).
    # Token'in environment'i bununla eslesmezse kimlik dogrulama reddedilir.
    PUBLIC_API_ENV: str = "dev"
    # Client'ta rate_limit_per_min tanimli degilse kullanilacak varsayilan.
    PUBLIC_API_DEFAULT_RATE_LIMIT: int = 60
    # Basarisiz kimlik dogrulama denemeleri icin IP basina dakikalik limit
    # (amendment #7 — invalid-token brute force korumasi).
    PUBLIC_API_AUTH_FAIL_LIMIT_PER_MIN: int = 30

    # ==========================================================================
    # CORS Configuration
    # ==========================================================================
    
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://84.247.180.172:30772",
        "http://84.247.180.172:30772",
    ]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Singleton Settings instance döner."""
    return Settings()
