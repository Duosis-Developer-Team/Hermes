# =============================================================================
# HERMES core-service — cutover ONCESI semanin OTORITER tarifi (WS1)
# =============================================================================
# Bu modul, `app/main.py` icinde startup'ta kosan 13 ad-hoc `_migrate_*`
# fonksiyonunun ve `init_db()` (create_all) cagrisinin BIREBIR karsiligidir.
# Tenant cutover'i icin sema degisikliklerinin otoritesi Alembic'e
# tasindi; bu dosya `versions/0001_baseline.py` tarafindan cagrilir.
#
# ONEMLI FARK: orijinal startup fonksiyonlari her hatayi yutuyordu
# (`except: print(...)`). Migration BUNU YAPMAZ — hata, CD'yi durduran
# gercek bir hatadir. Sessiz yarim sema, tenant cutover'inda kabul
# edilemez.
#
# Butun ifadeler IDEMPOTENT'tir: hem BOS bir veritabaninda hem de
# mevcut hermes-dev/hermes-test veritabanlarinda ayni sonucu uretir.
# Var olan hicbir satir silinmez, hicbir PK/FK degistirilmez.
# =============================================================================

from __future__ import annotations

from typing import List

from sqlalchemy import text


# =============================================================================
# 1) create_all ONCESI gereken tablo-disi nesneler
# =============================================================================
# tasks.task_number kolonunun server_default'u nextval('task_number_seq')
# oldugu icin, BOS bir veritabaninda create_all "tasks" tablosunu kurmaya
# calisirken sequence yoksa UndefinedTable ile patlar.
PREREQUISITE_STATEMENTS: List[str] = [
    "CREATE SEQUENCE IF NOT EXISTS task_number_seq",
]


# =============================================================================
# 2) create_all SONRASI sema tamamlayicilari
# =============================================================================
# Sira ONEMLIDIR: kolon eklemeleri, onlara bagli index/constraint'lerden
# once gelir.

# --- tasks.assignment_batch_id (migration 007) ---
_ASSIGNMENT_BATCH_ID: List[str] = [
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_batch_id UUID",
    "CREATE INDEX IF NOT EXISTS idx_tasks_assignment_batch_id "
    "ON tasks(assignment_batch_id)",
]

# --- tasks.status: 'rejected' degerinin acilmasi ---
_STATUS_REJECTED: List[str] = [
    "ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status",
    "ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status "
    "CHECK (status IN ("
    "'pending', 'in_progress', 'completed', 'cancelled', 'rejected'"
    "))",
]

# --- work_logs.task_id (Log Time → task baglantisi) ---
_WORK_LOGS_TASK_ID: List[str] = [
    "ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS task_id UUID",
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
    "END $$;",
    "CREATE INDEX IF NOT EXISTS idx_work_logs_task_id "
    "ON work_logs(task_id)",
]

# --- task_activity_events / task_comments erisim index'leri ---
_ACTIVITY_AND_COMMENT_INDEXES: List[str] = [
    "CREATE INDEX IF NOT EXISTS idx_task_activity_events_task_created "
    "ON task_activity_events(task_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_task_comments_task_created "
    "ON task_comments(task_id, created_at)",
]

# --- Meetings modulu: takvim index'i + work_logs.meeting_id ---
_MEETINGS_SCHEMA: List[str] = [
    "CREATE INDEX IF NOT EXISTS idx_meetings_start_cancelled "
    "ON meetings(start_datetime, is_cancelled)",
    "ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS meeting_id UUID",
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
    "END $$;",
    "CREATE INDEX IF NOT EXISTS idx_work_logs_meeting_id "
    "ON work_logs(meeting_id)",
]

# --- tasks: tek seferlik accept/complete e-posta damgalari ---
_STATUS_EVENT_TIMESTAMPS: List[str] = [
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
    "first_accepted_at TIMESTAMPTZ",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
    "first_completed_at TIMESTAMPTZ",
]

# --- tasks.task_type (task | issue | suggestion) ---
_TASK_TYPE: List[str] = [
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
    "task_type VARCHAR(20) NOT NULL DEFAULT 'task'",
    "ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_task_type",
    "ALTER TABLE tasks ADD CONSTRAINT chk_tasks_task_type "
    "CHECK (task_type IN ('task', 'issue', 'suggestion'))",
    "CREATE INDEX IF NOT EXISTS idx_tasks_task_type "
    "ON tasks(task_type)",
]

# --- tasks.type_number kolonu + per-type sequence'lar ---
TYPE_NUMBER_SEQUENCES = {
    "task": "tasks_type_seq_task",
    "issue": "tasks_type_seq_issue",
    "suggestion": "tasks_type_seq_suggestion",
}

_TYPE_NUMBER_OBJECTS: List[str] = [
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type_number BIGINT",
    *[f"CREATE SEQUENCE IF NOT EXISTS {seq}"
      for seq in TYPE_NUMBER_SEQUENCES.values()],
    "CREATE INDEX IF NOT EXISTS idx_tasks_type_number "
    "ON tasks(type_number)",
]

# `type_number`i dolduran BEFORE INSERT trigger'i. Tenant cutover'inda
# (0004) tenant-bazli sayaca gecerken bu fonksiyon DEGISTIRILIR; burada
# cutover ONCESI hali korunur ki 0001 gercekten "bugunku sema" olsun.
_TYPE_NUMBER_TRIGGER: List[str] = [
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
    "END; $$ LANGUAGE plpgsql",
    "DROP TRIGGER IF EXISTS trg_assign_type_number ON tasks",
    "CREATE TRIGGER trg_assign_type_number BEFORE INSERT ON tasks "
    "FOR EACH ROW EXECUTE PROCEDURE assign_task_type_number()",
]

# --- issue/suggestion izin kapsami ---
_ISSUE_SCOPE_PERMISSIONS: List[str] = [
    # per-user dogrudan bayraklar
    "ALTER TABLE task_user_permissions ADD COLUMN IF NOT EXISTS "
    "can_access_issues BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE task_user_permissions ADD COLUMN IF NOT EXISTS "
    "can_assign_issues BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE task_user_permissions DROP CONSTRAINT IF EXISTS "
    "chk_issue_assign_requires_access",
    "ALTER TABLE task_user_permissions ADD CONSTRAINT "
    "chk_issue_assign_requires_access CHECK "
    "(can_access_issues = TRUE OR can_assign_issues = FALSE)",
    # grup varsayilanlari
    "ALTER TABLE task_group_permissions ADD COLUMN IF NOT EXISTS "
    "can_access_issues_default BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE task_group_permissions ADD COLUMN IF NOT EXISTS "
    "can_assign_issues_default BOOLEAN NOT NULL DEFAULT false",
    # uye bazli tri-state override'lar
    "ALTER TABLE task_group_member_overrides ADD COLUMN IF NOT EXISTS "
    "can_access_issues_override BOOLEAN",
    "ALTER TABLE task_group_member_overrides ADD COLUMN IF NOT EXISTS "
    "can_assign_issues_override BOOLEAN",
    # atama iliskileri: scope ayirici
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
    # atama GRUP iliskileri: scope ayirici
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


def post_create_statements() -> List[str]:
    """create_all SONRASI kosulacak tum DDL — dogru sirada."""
    from app.services.task_lifecycle import LIFECYCLE_SCHEMA_STATEMENTS

    return [
        *_ASSIGNMENT_BATCH_ID,
        *LIFECYCLE_SCHEMA_STATEMENTS,
        *_STATUS_REJECTED,
        *_WORK_LOGS_TASK_ID,
        *_ACTIVITY_AND_COMMENT_INDEXES,
        *_MEETINGS_SCHEMA,
        *_STATUS_EVENT_TIMESTAMPS,
        *_TASK_TYPE,
        *_TYPE_NUMBER_OBJECTS,
        *_ISSUE_SCOPE_PERMISSIONS,
    ]


# =============================================================================
# 3) Tek seferlik veri doldurmalari (hepsi idempotent)
# =============================================================================

def _backfill_billable_hours(conn) -> None:
    """billable_duration_hours sonradan eklendi; eski satirlar NULL."""
    conn.execute(text(
        "UPDATE work_logs SET billable_duration_hours = duration_hours "
        "WHERE billable_duration_hours IS NULL"
    ))


def _backfill_lifecycle(conn) -> None:
    from app.services.task_lifecycle import LIFECYCLE_BACKFILL_SQL

    conn.execute(text(LIFECYCLE_BACKFILL_SQL))


def _backfill_task_number(conn) -> None:
    """tasks.task_number: created_at sirasiyla doldur, default + NOT NULL."""
    conn.execute(text(
        "WITH ranked AS ("
        "    SELECT id FROM tasks "
        "    WHERE task_number IS NULL "
        "    ORDER BY created_at, id"
        ") "
        "UPDATE tasks SET task_number = nextval('task_number_seq') "
        "FROM ranked WHERE tasks.id = ranked.id"
    ))
    conn.execute(text(
        "ALTER TABLE tasks "
        "ALTER COLUMN task_number SET DEFAULT nextval('task_number_seq')"
    ))
    # Sequence'i mevcut en yuksek degerin otesine tasi. BOS tabloda
    # setval(seq, 0, true) araligin disinda kalir — o durumda dokunma.
    max_task_number = conn.execute(text(
        "SELECT COALESCE(MAX(task_number), 0) FROM tasks"
    )).scalar() or 0
    if int(max_task_number) > 0:
        conn.execute(
            text("SELECT setval('task_number_seq', :v, true)"),
            {"v": int(max_task_number)},
        )
    null_count = conn.execute(text(
        "SELECT COUNT(*) FROM tasks WHERE task_number IS NULL"
    )).scalar()
    if (null_count or 0) == 0:
        conn.execute(text(
            "ALTER TABLE tasks ALTER COLUMN task_number SET NOT NULL"
        ))
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_task_number "
        "ON tasks(task_number)"
    ))


def _backfill_status_event_timestamps(conn) -> None:
    """Zaten kabul/tamamlanmis satirlar sahte 'ilk kez' e-postasi atmasin."""
    conn.execute(text(
        "UPDATE tasks SET first_completed_at = completed_at "
        "WHERE first_completed_at IS NULL AND completed_at IS NOT NULL"
    ))
    conn.execute(text(
        "UPDATE tasks SET first_accepted_at = "
        "COALESCE(completed_at, updated_at, created_at) "
        "WHERE first_accepted_at IS NULL "
        "AND status IN ('in_progress', 'completed')"
    ))


def _backfill_type_number(conn) -> None:
    """Per-type numaralandirma — YALNIZCA trigger henuz yokken.

    Trigger varsa sema zaten bu asamayi gecmistir; yeniden numaralandirma
    mevcut TASK-56 gibi paylasilmis kodlari bozardi.
    """
    trigger_exists = conn.execute(text(
        "SELECT 1 FROM pg_trigger WHERE tgname = 'trg_assign_type_number'"
    )).first() is not None
    if trigger_exists:
        return

    # Mevcut task'lar kodunu KORUR: type_number = task_number.
    conn.execute(text(
        "UPDATE tasks SET type_number = task_number "
        "WHERE task_type = 'task' AND type_number IS NULL"
    ))
    conn.execute(text(
        "WITH numbered AS ("
        "  SELECT id, row_number() OVER ("
        "    PARTITION BY task_type ORDER BY task_number, created_at, id"
        "  ) AS rn FROM tasks "
        "  WHERE task_type IN ('issue', 'suggestion')"
        ") UPDATE tasks t SET type_number = n.rn "
        "FROM numbered n WHERE t.id = n.id AND t.type_number IS NULL"
    ))
    for typ, seq in TYPE_NUMBER_SEQUENCES.items():
        mx = int(conn.execute(
            text(
                "SELECT COALESCE(MAX(type_number), 0) FROM tasks "
                "WHERE task_type = :t"
            ),
            {"t": typ},
        ).scalar() or 0)
        if mx > 0:
            conn.execute(text(f"SELECT setval('{seq}', :v, true)"),
                         {"v": mx})
        else:
            conn.execute(text(f"SELECT setval('{seq}', 1, false)"))


# =============================================================================
# Genel giris noktasi
# =============================================================================

# Cutover ile GELEN tablolar — 0001 baseline'a AIT DEGILDIR.
# (0001 "bugunku sema"yi tarif eder; tenant nesneleri 0002'de gelir.)
POST_BASELINE_TABLES = ("tenant_registry", "tenant_counters")


def apply_baseline(conn) -> None:
    """Cutover oncesi semanin tamamini idempotent olarak uygular.

    `conn` acik bir SQLAlchemy Connection'dir (Alembic'in transaction'i
    icinde). Hata YUTULMAZ.
    """
    import app.models  # noqa: F401 — modelleri Base'e kaydeder
    from app.database import Base

    for stmt in PREREQUISITE_STATEMENTS:
        conn.execute(text(stmt))

    Base.metadata.create_all(
        bind=conn,
        tables=[
            table for name, table in Base.metadata.tables.items()
            if name not in POST_BASELINE_TABLES
        ],
        checkfirst=True,
    )

    for stmt in post_create_statements():
        conn.execute(text(stmt))

    _backfill_billable_hours(conn)
    _backfill_lifecycle(conn)
    _backfill_task_number(conn)
    _backfill_status_event_timestamps(conn)
    _backfill_type_number(conn)

    # Trigger EN SON: backfill'in "trigger yoksa" kosulu bozulmasin.
    for stmt in _TYPE_NUMBER_TRIGGER:
        conn.execute(text(stmt))


# =============================================================================
# 4) WS2 — tenant projeksiyonu ve sayaclari
# =============================================================================

def apply_tenant_projection(conn) -> None:
    """`tenant_registry` + `tenant_counters` (0002).

    Bu tablolar tenant-OWNED DEGILDIR: `tenant_registry` kontrol duzlemi
    projeksiyonudur ve `tenant_counters` her tenant icin tek satir tutar.
    Ikisi de RLS politikasi ALMAZ; erisimleri repository/rol siniriyla
    korunur (05_POSTGRES_RLS_AND_TENANT_CONTEXT.md §6 ile ayni gerekce).
    """
    import app.models  # noqa: F401 — modelleri Base'e kaydeder
    from app.database import Base

    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in POST_BASELINE_TABLES],
        checkfirst=True,
    )


def apply_all(conn) -> None:
    """Testler icin: bugunku head semasinin tamami."""
    apply_baseline(conn)
    apply_tenant_projection(conn)
