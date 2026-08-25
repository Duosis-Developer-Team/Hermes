# =============================================================================
# HERMES PLATFORM - Core Service Main Application
# =============================================================================
# Bu dosya, core-service FastAPI uygulamasının giriş noktasıdır.
#
# Servis Sorumluluğu:
# - Müşteri, Proje, İş Tipi CRUD (FR 3.x)
# - Zaman Girişi CRUD (FR 2.x)
#
# TAD Referansı: 3.2 core-service
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
from app.database import SessionLocal
from app.routers import (
    customers_router,
    work_types_router,
    projects_router,
    work_logs_router,
    activity_types_router,
    platforms_router,
    work_lines_router,
    issues_router,
    project_memberships_router,
    timesheets_router,
    dashboard_router,
    reports_router,
    plan_times_router,
    tasks_router,
    task_admin_router,
    user_group_admin_router,
    api_admin_router,
    meetings_router,
)
from shared.exceptions import HermesException
from shared.metrics import setup_metrics, start_metrics_server


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Uygulama yaşam döngüsü yönetimi."""
    settings = get_settings()
    print(f"🚀 {settings.SERVICE_NAME} v{settings.SERVICE_VERSION} başlatılıyor...")
    # Prometheus /metrics ayri portta (bkz. shared/metrics.py). Middleware
    # import aninda takilir; soket YALNIZCA burada acilir.
    start_metrics_server()
    # ------------------------------------------------------------------
    # WS1: sema DEGISIKLIGI ARTIK BURADA YAPILMAZ.
    # ------------------------------------------------------------------
    # Onceden burada create_all() + 13 ad-hoc `_migrate_*` fonksiyonu
    # kosuyordu; cok podlu bir rollout'ta bu, ayni DDL'i yarisan podlar
    # demekti. Tum sema artik versiyonlu Alembic revizyonlarinda
    # (app/migrations/versions/) yasar ve CD'de rollout'tan ONCE kosan
    # bloklayan bir Job ile uygulanir.
    #
    # Pod'un tek gorevi: bekledigi sema versiyonu gercekten var mi?
    # Yoksa ACILMAZ (fail-closed) — yanlis sema uzerinde yazmaktansa
    # hizmet vermemek dogrudur.
    from app.database import engine
    from shared.schema_guard import verify_schema_compatibility

    revision = verify_schema_compatibility("core", engine)
    print(f"✅ Sema uyumlu (revision={revision})")
    # RBAC cutover (2026-08-04): legacy task izinlerini komponent rollere
    # tasiyan idempotent backfill. Auth erisilemezse loglar ve GECER —
    # deployment asla yarim kalmaz; admin ucundan yeniden kosulabilir.
    from app.services.rbac_backfill import run_startup_backfill

    _bf_db = SessionLocal()
    try:
        run_startup_backfill(_bf_db)
    finally:
        _bf_db.close()
    yield
    print(f"👋 {settings.SERVICE_NAME} kapatılıyor...")


settings = get_settings()

app = FastAPI(
    title="Hermes Core Service",
    description="""
    **Hermes Platform - Çekirdek Servis**
    
    Bu servis, Hermes platformunun temel iş mantığını yönetir:
    
    * **Müşteri Yönetimi**: Müşteri CRUD işlemleri (Admin)
    * **İş Tipi Yönetimi**: İş kategorileri CRUD işlemleri (Admin)
    * **Proje Yönetimi**: Proje CRUD işlemleri (Admin)
    * **Zaman Girişi**: Yapılan işlerin kaydı (Tüm Kullanıcılar)
    """,
    version=settings.SERVICE_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    # Hardening: internal OpenAPI semasi yalnizca DEBUG'da erisilir.
    # (Public API'nin kendi semasi /api/public/v1/openapi.json'da AYRI
    # uygulamada yasar ve bundan etkilenmez.)
    openapi_url="/openapi.json" if settings.DEBUG else None,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Prometheus (Drake sozlesmesi): service etiketi burada SABIT verilir —
# ayarlardan turetilmez, cunku dashboard'lar bu degere bagli. Middleware
# CORS'tan SONRA eklenir: add_middleware son ekleneni disa alir, boylece
# olcum tum zinciri (CORS dahil) kapsar. Mount edilmis /api/public
# alt-uygulamasi da ayni ASGI agacindan gectigi icin sayilir.
setup_metrics(app, service="core-service")


@app.exception_handler(HermesException)
async def hermes_exception_handler(request: Request, exc: HermesException):
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    settings = get_settings()
    error_detail = str(exc) if settings.DEBUG else "An unexpected error occurred"
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": error_detail}}
    )


# Router Registration
API_PREFIX = "/api/v1/core"

# S2S tenant projeksiyonu (WS12): yeni tenant provision edilince auth
# burayi cagirir. Kullaniciya donuk akislar bu ucu KULLANMAZ.
from .routers.internal_tenants import router as internal_tenants_router  # noqa: E402

app.include_router(internal_tenants_router)

app.include_router(customers_router, prefix=API_PREFIX)
app.include_router(work_types_router, prefix=API_PREFIX)
app.include_router(projects_router, prefix=API_PREFIX)
app.include_router(work_logs_router, prefix=API_PREFIX)
app.include_router(activity_types_router, prefix=API_PREFIX)
app.include_router(platforms_router, prefix=API_PREFIX)
app.include_router(work_lines_router, prefix=API_PREFIX)
app.include_router(issues_router, prefix=API_PREFIX)

app.include_router(project_memberships_router, prefix=API_PREFIX)
app.include_router(timesheets_router, prefix=API_PREFIX)
app.include_router(dashboard_router, prefix=API_PREFIX)
app.include_router(reports_router, prefix=API_PREFIX)
app.include_router(plan_times_router, prefix=API_PREFIX)
app.include_router(tasks_router, prefix=API_PREFIX)
app.include_router(task_admin_router, prefix=API_PREFIX)
app.include_router(user_group_admin_router, prefix=API_PREFIX)
app.include_router(api_admin_router, prefix=API_PREFIX)
app.include_router(meetings_router, prefix=API_PREFIX)

# =============================================================================
# Public API (dis entegrasyonlar) — /api/public altina mount edilen IZOLE
# alt-uygulama. Kendi OpenAPI'si, kendi middleware zinciri ve kendi hata
# zarfi vardir; internal route/semalar oraya sizamaz. Bkz. app/public_api/.
# =============================================================================
from .public_api.app import create_public_app  # noqa: E402

app.mount("/api/public", create_public_app())


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}


@app.get("/ready", tags=["Health"])
async def readiness_check():
    """Readiness — trafige HAZIR miyim?

    `/health` (liveness) ile farki bilinclidir:
      - liveness: surec ayakta mi? (yeniden baslatma karari)
      - readiness: bu pod ISTEK ALABILIR mi? (trafige alma karari)

    WS10: readiness sema uyumlulugunu DA kontrol eder. Yanlis sema
    uzerinde calisan bir pod'a trafik vermek, tenant cutover'inda
    sessizce yanlis veri yazmak demektir.

    Ayrinti SIZDIRILMAZ: yanit yalnizca hazir/degil soyler. Revizyon
    adi, tablo adi veya hata metni disariya cikmaz (ic teshis loglarda).
    """
    from fastapi.responses import JSONResponse

    from app.database import engine
    from shared.schema_guard import verify_schema_compatibility

    try:
        verify_schema_compatibility("core", engine)
    except Exception:  # noqa: BLE001 — ayrinti disariya CIKMAZ
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "service": settings.SERVICE_NAME},
        )
    return {"status": "ready", "service": settings.SERVICE_NAME}


@app.get("/", tags=["Root"])
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
