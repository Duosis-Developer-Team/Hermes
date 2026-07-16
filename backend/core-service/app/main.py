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
    api_admin_router,
    meetings_router,
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
        # inserts can't collide with a backfilled row. Guard the
        # empty-table case: setval(seq, 0, true) is out of range because
        # the sequence minimum is 1, which previously made this whole
        # migration roll back on a fresh DB (no tasks yet). When there
        # are no rows, leave the sequence at its fresh state so the
        # first task gets task_number = 1.
        max_task_number = db.execute(text(
            "SELECT COALESCE(MAX(task_number), 0) FROM tasks"
        )).scalar() or 0
        if int(max_task_number) > 0:
            db.execute(
                text("SELECT setval('task_number_seq', :v, true)"),
                {"v": int(max_task_number)},
            )
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


def _migrate_meetings_schema() -> None:
    """
    Idempotent additive migration for the Meetings module
    (Microsoft Teams / Outlook calendar integration).

    SQLAlchemy's create_all() handles the actual table creation
    because Meeting + MeetingAttendee are registered in
    models/__init__.py. This helper:

      1) Guarantees the composite index meetings(start_datetime,
         is_cancelled) for the calendar week-window scans, which
         create_all() can't be relied on to emit deterministically.
      2) Adds work_logs.meeting_id (nullable UUID FK → meetings.id
         ON DELETE SET NULL) so a Log Time submitted from a meeting
         card can link to its source. Mirrors the existing
         work_logs.task_id pattern exactly.

    Safe to re-run on every startup. No row is touched and no data
    is deleted.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        # Composite scan index for "this week's meetings, hide
        # cancelled" — the most common Meetings page query.
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_meetings_start_cancelled "
            "ON meetings(start_datetime, is_cancelled)"
        ))

        # work_logs.meeting_id — additive, mirrors task_id.
        db.execute(text(
            "ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS meeting_id UUID"
        ))
        db.execute(text(
            "DO $$ BEGIN "
            "  IF NOT EXISTS ("
            "    SELECT 1 FROM information_schema.table_constraints "
            "    WHERE table_name = 'work_logs' "
            "      AND constraint_name = 'fk_work_logs_meeting_id'"
            "  ) THEN "
            "    ALTER TABLE work_logs "
            "    ADD CONSTRAINT fk_work_logs_meeting_id "
            "    FOREIGN KEY (meeting_id) REFERENCES meetings(id) "
            "    ON DELETE SET NULL; "
            "  END IF; "
            "END $$;"
        ))
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_work_logs_meeting_id "
            "ON work_logs(meeting_id)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  meetings schema migration hatası: {e}")
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


def _migrate_tasks_task_type() -> None:
    """
    Idempotent additive migration: adds tasks.task_type (task | issue |
    suggestion), defaulting existing + new rows to 'task'. Safe to re-run.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
            "task_type VARCHAR(20) NOT NULL DEFAULT 'task'"
        ))
        db.execute(text(
            "ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_task_type"
        ))
        db.execute(text(
            "ALTER TABLE tasks ADD CONSTRAINT chk_tasks_task_type "
            "CHECK (task_type IN ('task', 'issue', 'suggestion'))"
        ))
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_tasks_task_type "
            "ON tasks(task_type)"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  tasks.task_type migration hatası: {e}")
    finally:
        db.close()


def _migrate_tasks_type_number() -> None:
    """
    Per-type sequential numbering: each work-item type gets its OWN counter
    (TASK-1, ISSUE-1, SUGGESTION-1 …), independent of the global task_number.

    - adds tasks.type_number
    - one sequence per type
    - a BEFORE INSERT trigger fills type_number from the right sequence based
      on task_type, so every insert path stays collision-free
    - one-time backfill of existing rows (per type, by creation order) +
      sequence alignment; the backfill is skipped once the trigger exists, so
      re-runs never renumber or move a sequence backward.
    Safe to re-run.
    """
    from sqlalchemy import text

    seqs = {
        "task": "tasks_type_seq_task",
        "issue": "tasks_type_seq_issue",
        "suggestion": "tasks_type_seq_suggestion",
    }

    db = SessionLocal()
    try:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type_number BIGINT"
        ))
        for seq in seqs.values():
            db.execute(text(f"CREATE SEQUENCE IF NOT EXISTS {seq}"))
        db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_tasks_type_number "
            "ON tasks(type_number)"
        ))

        trigger_exists = db.execute(text(
            "SELECT 1 FROM pg_trigger WHERE tgname = 'trg_assign_type_number'"
        )).first() is not None

        if not trigger_exists:
            # One-time backfill. Existing tasks PRESERVE their current code:
            # type_number = task_number, so TASK-56 stays TASK-56 (no churn
            # for already-shared task codes). Issues + suggestions are brand
            # new, so they get fresh per-type 1-based numbers by creation
            # order. Sequences are aligned to each type's max below.
            db.execute(text(
                "UPDATE tasks SET type_number = task_number "
                "WHERE task_type = 'task' AND type_number IS NULL"
            ))
            db.execute(text(
                "WITH numbered AS ("
                "  SELECT id, row_number() OVER ("
                "    PARTITION BY task_type ORDER BY task_number, created_at, id"
                "  ) AS rn FROM tasks "
                "  WHERE task_type IN ('issue', 'suggestion')"
                ") UPDATE tasks t SET type_number = n.rn "
                "FROM numbered n WHERE t.id = n.id AND t.type_number IS NULL"
            ))
            for typ, seq in seqs.items():
                mx = int(db.execute(
                    text(
                        "SELECT COALESCE(MAX(type_number), 0) FROM tasks "
                        "WHERE task_type = :t"
                    ),
                    {"t": typ},
                ).scalar() or 0)
                if mx > 0:
                    # next nextval → mx + 1
                    db.execute(
                        text(f"SELECT setval('{seq}', :v, true)"), {"v": mx}
                    )
                else:
                    # no rows yet → first nextval returns 1
                    db.execute(text(f"SELECT setval('{seq}', 1, false)"))

        db.execute(text(
            "CREATE OR REPLACE FUNCTION assign_task_type_number() "
            "RETURNS trigger AS $$ BEGIN "
            "  IF NEW.type_number IS NULL THEN "
            "    IF NEW.task_type = 'issue' THEN "
            "      NEW.type_number := nextval('tasks_type_seq_issue'); "
            "    ELSIF NEW.task_type = 'suggestion' THEN "
            "      NEW.type_number := nextval('tasks_type_seq_suggestion'); "
            "    ELSE "
            "      NEW.type_number := nextval('tasks_type_seq_task'); "
            "    END IF; "
            "  END IF; "
            "  RETURN NEW; "
            "END; $$ LANGUAGE plpgsql"
        ))
        db.execute(text(
            "DROP TRIGGER IF EXISTS trg_assign_type_number ON tasks"
        ))
        db.execute(text(
            "CREATE TRIGGER trg_assign_type_number BEFORE INSERT ON tasks "
            "FOR EACH ROW EXECUTE PROCEDURE assign_task_type_number()"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  tasks.type_number migration hatası: {e}")
    finally:
        db.close()


def _migrate_issue_scope_permissions() -> None:
    """
    Idempotent additive migration for the issue/suggestion permission scope:
      - task_user_permissions: + can_access_issues / can_assign_issues
      - task_group_permissions: + can_access_issues_default / *_assign_*
      - task_group_member_overrides: + can_access_issues_override / *_assign_*
      - task_assignment_relations / *_group_relations: + scope ('task'|'issue'),
        with the uniqueness key widened to include scope.
    All existing rows resolve to the 'task' scope, so task behaviour is
    unchanged. Safe to re-run.
    """
    from sqlalchemy import text

    stmts = [
        # --- per-user direct flags ---
        "ALTER TABLE task_user_permissions ADD COLUMN IF NOT EXISTS "
        "can_access_issues BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE task_user_permissions ADD COLUMN IF NOT EXISTS "
        "can_assign_issues BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE task_user_permissions DROP CONSTRAINT IF EXISTS "
        "chk_issue_assign_requires_access",
        "ALTER TABLE task_user_permissions ADD CONSTRAINT "
        "chk_issue_assign_requires_access CHECK "
        "(can_access_issues = TRUE OR can_assign_issues = FALSE)",
        # --- per-group defaults ---
        "ALTER TABLE task_group_permissions ADD COLUMN IF NOT EXISTS "
        "can_access_issues_default BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE task_group_permissions ADD COLUMN IF NOT EXISTS "
        "can_assign_issues_default BOOLEAN NOT NULL DEFAULT false",
        # --- per-member tri-state overrides (nullable) ---
        "ALTER TABLE task_group_member_overrides ADD COLUMN IF NOT EXISTS "
        "can_access_issues_override BOOLEAN",
        "ALTER TABLE task_group_member_overrides ADD COLUMN IF NOT EXISTS "
        "can_assign_issues_override BOOLEAN",
        # --- assignment relations: scope discriminator ---
        "ALTER TABLE task_assignment_relations ADD COLUMN IF NOT EXISTS "
        "scope VARCHAR(10) NOT NULL DEFAULT 'task'",
        "ALTER TABLE task_assignment_relations DROP CONSTRAINT IF EXISTS "
        "chk_task_assignment_scope",
        "ALTER TABLE task_assignment_relations ADD CONSTRAINT "
        "chk_task_assignment_scope CHECK (scope IN ('task', 'issue'))",
        "ALTER TABLE task_assignment_relations DROP CONSTRAINT IF EXISTS "
        "uq_task_assignment_relation",
        "ALTER TABLE task_assignment_relations DROP CONSTRAINT IF EXISTS "
        "uq_task_assignment_relation_scope",
        "ALTER TABLE task_assignment_relations ADD CONSTRAINT "
        "uq_task_assignment_relation_scope UNIQUE "
        "(assigner_user_id, assignee_user_id, scope)",
        "CREATE INDEX IF NOT EXISTS idx_task_assignment_relations_scope "
        "ON task_assignment_relations(scope)",
        # --- assignment GROUP relations: scope discriminator ---
        "ALTER TABLE task_assignment_group_relations ADD COLUMN IF NOT EXISTS "
        "scope VARCHAR(10) NOT NULL DEFAULT 'task'",
        "ALTER TABLE task_assignment_group_relations DROP CONSTRAINT IF EXISTS "
        "chk_task_assignment_group_scope",
        "ALTER TABLE task_assignment_group_relations ADD CONSTRAINT "
        "chk_task_assignment_group_scope CHECK (scope IN ('task', 'issue'))",
        "ALTER TABLE task_assignment_group_relations DROP CONSTRAINT IF EXISTS "
        "uq_task_assignment_group_relation",
        "ALTER TABLE task_assignment_group_relations DROP CONSTRAINT IF EXISTS "
        "uq_task_assignment_group_relation_scope",
        "ALTER TABLE task_assignment_group_relations ADD CONSTRAINT "
        "uq_task_assignment_group_relation_scope UNIQUE "
        "(assigner_user_id, assignee_group_id, scope)",
        "CREATE INDEX IF NOT EXISTS idx_task_assignment_group_relations_scope "
        "ON task_assignment_group_relations(scope)",
    ]

    db = SessionLocal()
    try:
        for stmt in stmts:
            db.execute(text(stmt))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  issue-scope permissions migration hatası: {e}")
    finally:
        db.close()


def _migrate_tasks_status_event_timestamps() -> None:
    """
    Idempotent additive migration: adds tasks.first_accepted_at and
    tasks.first_completed_at (nullable timestamptz) that drive the
    one-time accept/complete e-mail notifications. Safe to re-run.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
            "first_accepted_at TIMESTAMPTZ"
        ))
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
            "first_completed_at TIMESTAMPTZ"
        ))
        # Backfill existing rows so tasks already accepted/completed before
        # this feature don't fire a spurious "first time" e-mail when they
        # are next touched. Idempotent — only fills NULLs.
        db.execute(text(
            "UPDATE tasks SET first_completed_at = completed_at "
            "WHERE first_completed_at IS NULL AND completed_at IS NOT NULL"
        ))
        db.execute(text(
            "UPDATE tasks SET first_accepted_at = "
            "COALESCE(completed_at, updated_at, created_at) "
            "WHERE first_accepted_at IS NULL "
            "AND status IN ('in_progress', 'completed')"
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  tasks status-event timestamps migration hatası: {e}")
    finally:
        db.close()


def _ensure_prerequisite_objects() -> None:
    """
    create_all()'dan ÖNCE çalışması gereken, tablo dışı şema nesnelerini
    garanti eder.

    tasks.task_number kolonunun server_default'u nextval('task_number_seq')
    olduğu için, BOŞ bir veritabanında create_all() "tasks" tablosunu kurmaya
    çalışırken sequence henüz yoksa
    `UndefinedTable: relation "task_number_seq" does not exist` ile patlar.
    (Mevcut DB'lerde tablo zaten var; create_all onu atlar, bu yüzden sorun
    yalnızca taze/backup kurulumlarında görülür.)

    Sequence'i tablo kurulumundan önce yaratarak bu yumurta-tavuk problemini
    çözüyoruz. CREATE SEQUENCE IF NOT EXISTS sayesinde her startup'ta güvenle
    yeniden çalışır; sıra/değer asla sıfırlanmaz. Backfill ve SET DEFAULT
    gibi mevcut-DB mantığı _migrate_tasks_task_number()'da kalır.
    """
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text("CREATE SEQUENCE IF NOT EXISTS task_number_seq"))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"⚠️  task_number_seq ön-hazırlık hatası: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Uygulama yaşam döngüsü yönetimi."""
    settings = get_settings()
    print(f"🚀 {settings.SERVICE_NAME} v{settings.SERVICE_VERSION} başlatılıyor...")
    # create_all()'dan önce: tasks tablosunun default'unun bağlı olduğu
    # sequence'i garanti et (taze/backup DB'de create_all aksi halde patlar).
    _ensure_prerequisite_objects()
    init_db()
    print("✅ Veritabanı tabloları hazır")
    _migrate_billable_hours()
    _migrate_tasks_assignment_batch_id()
    _migrate_tasks_status_rejected()
    _migrate_tasks_task_number()
    _migrate_work_logs_task_id()
    _migrate_task_activity_events()
    _migrate_task_comments()
    # Meetings: create_all builds the tables (models registered in
    # models/__init__.py); this helper adds the helpful index +
    # work_logs.meeting_id link column.
    _migrate_meetings_schema()
    _migrate_tasks_status_event_timestamps()
    _migrate_tasks_task_type()
    _migrate_tasks_type_number()
    _migrate_issue_scope_permissions()
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


@app.get("/", tags=["Root"])
async def root():
    return {"service": settings.SERVICE_NAME, "version": settings.SERVICE_VERSION}
