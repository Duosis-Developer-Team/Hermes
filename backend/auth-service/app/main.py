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
from app.database import init_db
from app.routers import auth_router, users_router
from shared.exceptions import HermesException


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
    
    # Veritabanı tablolarını oluştur
    init_db()
    print("✅ Veritabanı tabloları hazır")
    
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
    
    error_detail = str(exc) if settings.DEBUG else "Beklenmeyen bir hata oluştu"
    
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
