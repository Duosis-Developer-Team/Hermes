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
from app.database import init_db, SessionLocal
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
)
from shared.exceptions import HermesException


def _migrate_billable_hours() -> None:
    """
    Tek seferlik veri düzeltmesi:
    billable_duration_hours kolonu sonradan eklendiği için (df40f7c) eski
    satırlar NULL. Bunları duration_hours ile dolduruyoruz.
    Zaten dolu satırlar (admin manuel düzenlemiş) dokunulmaz.
    """
    from sqlalchemy import text
    db = SessionLocal()
    try:
        result = db.execute(text(
            "UPDATE work_logs "
            "SET billable_duration_hours = duration_hours "
            "WHERE billable_duration_hours IS NULL"
        ))
        db.commit()
        if result.rowcount:
            print(f"✅ {result.rowcount} eski work log için billable_duration_hours düzeltildi")
    except Exception as e:
        db.rollback()
        print(f"⚠️  billable migration hatası: {e}")
    finally:
        db.close()


def _migrate_tasks_status_rejected() -> None:
    """
    Idempotent additive migration: extend the tasks.status check
    constraint to allow the new value 'rejected'. The existing
    constraint only permits ('pending', 'in_progress', 'completed',
    'cancelled'), so attempting to write status='rejected' would
    otherwise be blocked at insert/update time.

    Safe to re-run on every startup: we DROP IF EXISTS the old
    constraint and ADD the new one with the same name. No row is
    touched and no data is deleted.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status"
        ))
        db.execute(text(
            "ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status "
            "CHECK (status IN ("
            "'pending', 'in_progress', 'completed', 'cancelled', 'rejected'"
            "))"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  tasks.status 'rejected' migration hatası: {e}")
    finally:
        db.close()


def _migrate_tasks_assignment_batch_id() -> None:
    """
    Idempotent additive migration for migration 007:
    adds tasks.assignment_batch_id (nullable UUID) + index. SQLAlchemy
    create_all() never modifies existing tables, so we apply the ALTER
    explicitly. Safe to re-run on every startup.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_batch_id UUID"
        ))
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_tasks_assignment_batch_id "
            "ON tasks(assignment_batch_id)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  tasks.assignment_batch_id migration hatası: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Uygulama yaşam döngüsü yönetimi."""
    settings = get_settings()
    print(f"🚀 {settings.SERVICE_NAME} v{settings.SERVICE_VERSION} başlatılıyor...")
    init_db()
    print("✅ Veritabanı tabloları hazır")
    _migrate_billable_hours()
    _migrate_tasks_assignment_batch_id()
    _migrate_tasks_status_rejected()
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
    redoc_url="/redoc" if settings.DEBUG else None
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
API_PREFIX = "/api/v1/core"

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


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}


@app.get("/", tags=["Root"])
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
