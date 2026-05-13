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


def _migrate_tasks_task_number() -> None:
    """
    Idempotent additive migration for the Task ID / short-code feature.

    Adds a sequence + tasks.task_number column. Existing rows get
    backfilled in created_at order so older tasks earn smaller codes.
    Steps:
      1) CREATE SEQUENCE IF NOT EXISTS task_number_seq
      2) ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_number BIGINT
      3) Backfill any NULL task_number values in created_at order
         (idempotent — only touches rows still NULL).
      4) ALTER COLUMN SET DEFAULT nextval('task_number_seq') so new
         rows pick the next value without app-side bookkeeping.
      5) Advance the sequence past the current max so concurrent
         inserts during deploy don't collide with backfill values.
      6) ALTER COLUMN SET NOT NULL — only safe once no NULLs remain.
      7) CREATE UNIQUE INDEX IF NOT EXISTS for the column.

    Safe to re-run on every startup. No row is deleted; no data is
    overwritten.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "CREATE SEQUENCE IF NOT EXISTS task_number_seq"
        ))
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_number BIGINT"
        ))
        # Backfill in created_at order so older rows get lower numbers.
        # WITH-clause UPDATE keyed by task id; nextval() runs once per
        # row picked, in the deterministic order we asked for.
        db.execute(text(
            "WITH ranked AS ("
            "    SELECT id FROM tasks "
            "    WHERE task_number IS NULL "
            "    ORDER BY created_at, id"
            ") "
            "UPDATE tasks "
            "SET task_number = nextval('task_number_seq') "
            "FROM ranked "
            "WHERE tasks.id = ranked.id"
        ))
        db.execute(text(
            "ALTER TABLE tasks "
            "ALTER COLUMN task_number SET DEFAULT nextval('task_number_seq')"
        ))
        # Push the sequence past the highest existing value so new
        # inserts can't collide with a backfilled row.
        db.execute(text(
            "SELECT setval("
            "  'task_number_seq', "
            "  COALESCE((SELECT MAX(task_number) FROM tasks), 0), "
            "  true"
            ")"
        ))
        # Only flip to NOT NULL if every row is filled — defensive.
        null_count = db.execute(text(
            "SELECT COUNT(*) FROM tasks WHERE task_number IS NULL"
        )).scalar()
        if (null_count or 0) == 0:
            db.execute(text(
                "ALTER TABLE tasks "
                "ALTER COLUMN task_number SET NOT NULL"
            ))
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_task_number "
            "ON tasks(task_number)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  tasks.task_number migration hatası: {e}")
    finally:
        db.close()


def _migrate_work_logs_task_id() -> None:
    """
    Idempotent additive migration: add work_logs.task_id (nullable FK
    → tasks.id, ON DELETE SET NULL). Lets Log Time submitted from a
    completed task store a real link to that task. Backward
    compatible — plain Time Entry rows stay NULL.

    Safe to re-run on every startup.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS task_id UUID"
        ))
        # The FK constraint name is fixed so re-runs no-op cleanly.
        db.execute(text(
            "DO $$ BEGIN "
            "  IF NOT EXISTS ("
            "    SELECT 1 FROM information_schema.table_constraints "
            "    WHERE table_name = 'work_logs' "
            "      AND constraint_name = 'fk_work_logs_task_id'"
            "  ) THEN "
            "    ALTER TABLE work_logs "
            "    ADD CONSTRAINT fk_work_logs_task_id "
            "    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL; "
            "  END IF; "
            "END $$;"
        ))
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_work_logs_task_id "
            "ON work_logs(task_id)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  work_logs.task_id migration hatası: {e}")
    finally:
        db.close()


def _migrate_task_comments() -> None:
    """
    Idempotent additive migration for task_comments. SQLAlchemy's
    create_all() (the model is registered in models/__init__.py)
    creates the table itself; we add a composite index for the
    most common access pattern — list a single task's comments
    oldest-first — and never destroy data.

    Safe to re-run on every startup.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_task_comments_task_created "
            "ON task_comments(task_id, created_at)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  task_comments migration hatası: {e}")
    finally:
        db.close()


def _migrate_task_activity_events() -> None:
    """
    Idempotent additive migration for task_activity_events. The table
    itself is created by SQLAlchemy's create_all() (the model is
    registered in models/__init__.py) but we also guarantee the
    helpful composite index here so we never depend on a particular
    column-order being picked by create_all.

    Safe to re-run on every startup.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_task_activity_events_task_created "
            "ON task_activity_events(task_id, created_at DESC)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  task_activity_events migration hatası: {e}")
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
    _migrate_tasks_task_number()
    _migrate_work_logs_task_id()
    _migrate_task_activity_events()
    _migrate_task_comments()
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
