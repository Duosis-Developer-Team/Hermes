# =============================================================================
# HERMES PLATFORM - Reporting Service Main Application
# =============================================================================

import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from app.config import get_settings
from app.routers import dashboard_router, export_router
from shared.exceptions import HermesException


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    print(f"🚀 {settings.SERVICE_NAME} v{settings.SERVICE_VERSION} başlatılıyor...")
    print("📊 Raporlama servisi hazır (stateless - veritabanı yok)")
    yield
    print(f"👋 {settings.SERVICE_NAME} kapatılıyor...")


settings = get_settings()

app = FastAPI(
    title="Hermes Reporting Service",
    description="""
    **Hermes Platform - Raporlama Servisi**
    
    * **Dashboard**: Zaman verilerinin görsel özeti (FR 5.x)
    * **Excel Export**: Zaman girişlerinin Excel dökümü (FR 4.x)
    
    Bu servis stateless çalışır. Verileri core-service ve auth-service'den API ile çeker.
    """,
    version=settings.SERVICE_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HermesException)
async def hermes_exception_handler(request: Request, exc: HermesException):
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    settings = get_settings()
    error_detail = str(exc) if settings.DEBUG else "Beklenmeyen bir hata oluştu"
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": error_detail}}
    )


# Router Registration
API_PREFIX = "/api/v1/reports"

app.include_router(dashboard_router, prefix=API_PREFIX)
app.include_router(export_router, prefix=API_PREFIX)


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}


@app.get("/", tags=["Root"])
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
