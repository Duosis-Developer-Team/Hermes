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
    # Public API operational cleanup (Stage 3F)
    # ==========================================================================
    # Yalnizca api_request_logs + api_idempotency_keys yasam dongusu.
    # Idempotency retention 25 saat = 24 saatlik TTL + 1 saat guvenlik
    # payi (TTL'i okuma aninda dolmus ama henuz silinmemis anahtar,
    # temizlikten ASLA once otoriter olamaz).
    API_CLEANUP_ENABLED: bool = True

    # ==========================================================================
    # S2S directory credential (Stage 5B-2, onayli)
    # ==========================================================================
    # auth-service /internal/directory/... cagrilari icin makine
    # credential'i. Kullanici JWT'si DEGIL. Bos ise dizin ozellikleri
    # KAPALIDIR (fail closed) ve e-posta lookup'i eski (JWT) yola duser.
    HERMES_S2S_TOKEN_CURRENT: str = ""
    # Rotasyon slotu: auth tarafiyla PARITE. Eski token hala
    # gecerliyken yenisi dagitilabilsin diye iki slot dogrulanir.
    HERMES_S2S_TOKEN_NEXT: str = ""

    API_REQUEST_LOG_RETENTION_DAYS: int = 90
    API_IDEMPOTENCY_RETENTION_HOURS: int = 25
    API_CLEANUP_BATCH_SIZE: int = 5000
    
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
    # Ortak urun ticket platformu (Ticket Hub)
    # ==========================================================================
    # Modulun tamami KAPALI baslar degil, ama support tenant'i
    # YAPILANDIRILMADAN hicbir canonical yazma yapilamaz: tenant kimligi
    # koda GOMULMEZ, ortamdan gelir ve startup'ta dogrulanir. Yanlis bir
    # UUID ile baska bir tenant'ta ticket acilmasi kabul edilemez, bu
    # yuzden dogrulama fail-closed'dir (modul kapanir, servis ayakta
    # kalir — diger moduller etkilenmez).
    SUPPORT_TICKETS_ENABLED: bool = True
    HERMES_SUPPORT_TENANT_ID: str = ""
    # Hermes'in KENDI urun kodu (source application). Kod, application
    # kaydinin `code` alaniyla eslesir; immutable'dir.
    SUPPORT_HERMES_APPLICATION_CODE: str = "hermes"

    # Musteri dogrulama penceresi: resolved ticket kac gun sonra
    # otomatik kapanir ve kac gun icinde reopen edilebilir (D-007).
    SUPPORT_AUTO_CLOSE_DAYS: int = 7

    # Musteri tarafi flood korumasi (02_HERMES §7).
    SUPPORT_CREATE_LIMIT_PER_10MIN: int = 10
    SUPPORT_CREATE_LIMIT_PER_DAY: int = 100
    SUPPORT_REPLY_LIMIT_PER_MIN: int = 20
    # Integration client icin varsayilan dakikalik limit (client'ta
    # tanimliysa o kazanir).
    SUPPORT_INTEGRATION_DEFAULT_RATE_LIMIT: int = 120

    # --- Attachment / object storage -----------------------------------
    # KAPALI baslar: object storage ve malware tarayici HAZIR OLMADAN
    # attachment ozelligi production-ready SAYILMAZ (pack teslim kurali).
    # Bayrak acikken /ready, storage+scanner konfigurasyonunu dogrular.
    TICKET_ATTACHMENTS_ENABLED: bool = False
    # local | s3
    TICKET_STORAGE_BACKEND: str = "local"
    TICKET_STORAGE_LOCAL_ROOT: str = "/var/lib/hermes/ticket-attachments"
    TICKET_S3_ENDPOINT_URL: str = ""
    TICKET_S3_REGION: str = "us-east-1"
    TICKET_S3_BUCKET: str = ""
    TICKET_S3_ACCESS_KEY_ID: str = ""
    TICKET_S3_SECRET_ACCESS_KEY: str = ""
    TICKET_S3_FORCE_PATH_STYLE: bool = True
    # Nesne anahtari onekleri. Karantina, temiz alandan AYRI onektedir:
    # temizlenmemis bir nesne yanlislikla servis edilemesin.
    TICKET_S3_QUARANTINE_PREFIX: str = "quarantine/"
    TICKET_S3_CLEAN_PREFIX: str = "attachments/"

    TICKET_ATTACHMENT_MAX_FILES: int = 5
    TICKET_ATTACHMENT_MAX_BYTES: int = 15 * 1024 * 1024
    TICKET_ATTACHMENT_TOTAL_MAX_BYTES: int = 50 * 1024 * 1024
    # Upload oturumunun omru; baglanmamis nesneler bu sureden sonra
    # temizlik isine dusler (ticket eki ASLA silinmez).
    TICKET_ATTACHMENT_SESSION_TTL_MINUTES: int = 60

    # --- Malware tarayici ----------------------------------------------
    # clamav          → gercek tarama (uretim gereksinimi)
    # disabled_dev_only → tarama YOK; yalnizca PUBLIC_API_ENV='dev'te
    #                   kabul edilir. 'live' ortamda bu deger attachment
    #                   ozelligini ACMAZ (fail-closed, startup kontrolu).
    # Integration yuzeyinde uretilen tek kullanimlik indirme izninin
    # omru. Kisa tutulur: adres kaynak uygulamanin kullanicisinin
    # TARAYICISINA 307 ile verilir ve aninda kullanilir.
    TICKET_DOWNLOAD_GRANT_TTL_SECONDS: int = 60

    TICKET_SCANNER_MODE: str = "clamav"
    TICKET_SCANNER_HOST: str = ""
    TICKET_SCANNER_PORT: int = 3310
    TICKET_SCANNER_TIMEOUT_SECONDS: float = 30.0

    # --- Giden event teslimati -----------------------------------------
    TICKET_WEBHOOK_TIMEOUT_SECONDS: float = 10.0
    # HTTPS zorunlu; yalnizca yerel gelistirme icin acilir.
    TICKET_WEBHOOK_ALLOW_INSECURE_HTTP: bool = False
    TICKET_DISPATCH_BATCH_SIZE: int = 50
    # Imza sirlari ortam degiskeninden gelir; DB'de ve repo'da DEGIL.
    # Ad kalibi: HERMES_TICKET_WEBHOOK_SECRET__<APPCODE_UPPER>
    # (rotasyon slotu: ..._NEXT). Bkz. services/ticket_delivery_service.
    TICKET_WEBHOOK_SECRET_ENV_PREFIX: str = "HERMES_TICKET_WEBHOOK_SECRET__"

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
