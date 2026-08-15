# =============================================================================
# HERMES PLATFORM - Auth Service Main Application
# =============================================================================
# Bu dosya, auth-service FastAPI uygulamasının giriş noktasıdır.
# Tüm middleware'ler, router'lar ve uygulama yapılandırması burada tanımlanır.
#
# Servis Sorumluluğu:
# - Kullanıcı kimlik doğrulaması (Authentication)
# - JWT token yönetimi
# - Kullanıcı CRUD işlemleri (Admin)
#
# TAD Referansı: 3.1 auth-service
# =============================================================================

import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Shared modülü import edebilmek için path'e ekle
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from app.config import get_settings
from app.routers import auth_router, users_router
from shared.exceptions import HermesException
from shared.metrics import setup_metrics, start_metrics_server


# =============================================================================
# Application Lifespan (Startup/Shutdown)
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Uygulama yaşam döngüsü yönetimi.
    
    Startup:
        - Veritabanı tablolarını oluştur
        - Bağlantıları başlat
    
    Shutdown:
        - Bağlantıları kapat
        - Kaynakları temizle
    """
    # Startup
    settings = get_settings()
    print(f"🚀 {settings.SERVICE_NAME} v{settings.SERVICE_VERSION} başlatılıyor...")

    # Prometheus /metrics ayri portta (bkz. shared/metrics.py). Middleware
    # import aninda takilir; soket YALNIZCA burada acilir.
    start_metrics_server()

    # ------------------------------------------------------------------
    # WS1: sema DEGISIKLIGI ARTIK BURADA YAPILMAZ.
    # ------------------------------------------------------------------
    # create_all() yerine versiyonlu Alembic revizyonlari
    # (app/migrations/versions/) otoriterdir; CD'de rollout ONCESI
    # bloklayan bir Job ile uygulanir. Pod yalnizca bekledigi sema
    # versiyonunun var oldugunu DOGRULAR; yoksa acilmaz (fail-closed).
    from app.database import engine
    from shared.schema_guard import verify_schema_compatibility

    revision = verify_schema_compatibility("auth", engine)
    print(f"✅ Sema uyumlu (revision={revision})")

    # RBAC bootstrap (R1, idempotent): system-admin rolu katalogla
    # senkronlanir, legacy is_admin=True kullanicilara rol atanir.
    # Basarisizlik startup'i DURDURUR (fail-fast): RBAC'siz calisan bir
    # auth-service, izin-korumali uclari herkese kapatir (fail-closed)
    # ve bu sessiz kalmamali.
    from .database import SessionLocal
    from .services.rbac_service import bootstrap as rbac_bootstrap

    _db = SessionLocal()
    try:
        rbac_bootstrap(_db)
        print("✅ RBAC bootstrap tamam")
    finally:
        _db.close()

    yield
    
    # Shutdown
    print(f"👋 {settings.SERVICE_NAME} kapatılıyor...")


# =============================================================================
# FastAPI Application Instance
# =============================================================================

settings = get_settings()

app = FastAPI(
    title="Hermes Auth Service",
    description="""
    **Hermes Platform - Kimlik Doğrulama Servisi**
    
    Bu servis, Hermes platformunun kimlik doğrulama ve kullanıcı yönetimi
    işlemlerinden sorumludur.
    
    ## Özellikler
    
    * **Kimlik Doğrulama**: E-posta/şifre ile JWT token alma
    * **Kullanıcı Yönetimi**: Admin'ler için kullanıcı CRUD işlemleri
    * **Profil**: Giriş yapmış kullanıcının bilgilerini görüntüleme
    """,
    version=settings.SERVICE_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None
)


# =============================================================================
# Middleware Configuration
# =============================================================================

# CORS Middleware - Frontend'den gelen isteklere izin ver
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus (Drake sozlesmesi): service etiketi SABIT — dashboard'lar
# bu degere bagli. CORS'tan SONRA eklenir ki olcum tum zinciri kapsasin.
setup_metrics(app, service="auth-service")


# =============================================================================
# Exception Handlers
# =============================================================================

@app.exception_handler(HermesException)
async def hermes_exception_handler(request: Request, exc: HermesException):
    """
    Hermes özel exception'larını yakalar ve standart formatta döner.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict()
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Beklenmeyen hataları yakalar.
    
    Production'da detaylı hata mesajı gösterilmez.
    """
    settings = get_settings()
    
    error_detail = str(exc) if settings.DEBUG else "An unexpected error occurred"
    
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": error_detail,
                "details": {}
            }
        }
    )


# =============================================================================
# Router Registration
# =============================================================================

# API prefix - TAD'da tanımlanan /api/v1/auth
API_PREFIX = "/api/v1"

# Authentication endpoints
app.include_router(auth_router, prefix=API_PREFIX)

# User management endpoints
app.include_router(users_router, prefix=f"{API_PREFIX}/auth")

# Internal S2S directory (Stage 5B-2) — BILEREK API_PREFIX disinda:
# ingress yalnizca /api/* yonlendirir, /internal/* cluster-ici kalir.
# Kimlik: HERMES_S2S_TOKEN (dual-key) — kullanici JWT'si degildir ve
# normal endpoint'lerde gecmez.
from .routers.internal_directory import router as internal_directory_router  # noqa: E402

app.include_router(internal_directory_router)

# RBAC (R1): rol yonetimi + kendi izinlerim → /api/v1/auth/rbac/*
from .routers.rbac_admin import router as rbac_admin_router  # noqa: E402

app.include_router(rbac_admin_router, prefix=f"{API_PREFIX}/auth")

# Internal S2S authz resolve (RBAC R1) — directory ile ayni guard ve
# ayni "/api disinda" kurali.
from .routers.internal_authz import router as internal_authz_router  # noqa: E402

app.include_router(internal_authz_router)


# =============================================================================
# Health Check Endpoint
# =============================================================================

@app.get(
    "/health",
    tags=["Health"],
    summary="Servis Sağlık Kontrolü"
)
async def health_check():
    """
    Servisin çalışır durumda olup olmadığını kontrol eder.
    
    Kubernetes liveness/readiness probe'ları için kullanılır.
    """
    return {
        "status": "healthy",
        "service": settings.SERVICE_NAME,
        "version": settings.SERVICE_VERSION
    }


# =============================================================================
# Root Endpoint
# =============================================================================

@app.get("/", tags=["Root"])
async def root():
    """
    Servis bilgilerini döner.
    """
    return {
        "service": settings.SERVICE_NAME,
        "version": settings.SERVICE_VERSION,
        "docs": "/docs" if settings.DEBUG else None
    }
