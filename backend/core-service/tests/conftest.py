# =============================================================================
# HERMES core-service tests - shared fixtures
# =============================================================================
# Onemli: env degiskenleri APP IMPORT'UNDAN ONCE ayarlanmalidir —
# shared/auth.py modul yuklenirken JWT_PUBLIC_KEY yoksa sys.exit(1) yapar.
# DB'ye BAGLANILMAZ: TestClient lifespan calistirmaz (context manager
# olarak kullanilmadigi surece), create_engine lazy'dir.
# =============================================================================

import os
import sys

# core-service koku (`app` paketi) + backend koku (`shared` paketi —
# Docker'da image'a kopyalanir; lokalde backend/shared'ten cozulur.
# NOT: core-service/shared BOS bir klasordur, backend koku ONCE gelmeli
# ki gercek `shared` paketi onu golgede biraksin).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.dirname(_ROOT)
for _p in (_ROOT, _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# shared/auth.py'nin modul-yuklenme kontrolu icin dummy anahtar (yalnizca
# saklanir; testler JWT dogrulamasi yapmaz). DEBUG bilerek AYARLANMAZ —
# default False, internal OpenAPI hardening'i bu modda test ediyoruz.
os.environ.setdefault("JWT_PUBLIC_KEY", "test-only-not-a-real-key")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_rate_limiter():
    """Her test taze bir limiter'la baslar — global sayac durumu testler
    arasinda tasinmaz."""
    from app.public_api import rate_limit

    rate_limit.set_limiter(rate_limit.InMemoryRateLimiter())
    yield
    rate_limit.set_limiter(rate_limit.InMemoryRateLimiter())


# Gercek-Postgres entegrasyon testleri (Stage 2D+). Lokalde:
#   docker run -d --name hermes-test-pg -e POSTGRES_USER=hermes \
#     -e POSTGRES_PASSWORD=hermes -e POSTGRES_DB=hermes_test \
#     -p 55433:5432 postgres:15-alpine
# CI ayni URL'i servis container'iyla saglar. DB yoksa bu fixture'i
# kullanan testler SKIP edilir (foundation testleri etkilenmez).
TEST_DB_URL = os.environ.get(
    "HERMES_TEST_DATABASE_URL",
    "postgresql://hermes:hermes@localhost:55433/hermes_test",
)


@pytest.fixture(scope="session")
def pg_engine():
    from sqlalchemy import create_engine

    engine = create_engine(TEST_DB_URL, pool_pre_ping=True)
    try:
        with engine.connect():
            pass
    except Exception:
        pytest.skip("test database unavailable (see conftest for setup)")
    import app.models  # noqa: F401 — metadata kaydi

    from app.database import Base
    from sqlalchemy import text as sa_text

    # create_all onkosulu: tasks.task_number server_default'u bu sequence'i
    # kullanir (main.py _ensure_prerequisite_objects ile ayni gereklilik).
    with engine.begin() as conn:
        conn.execute(
            sa_text("CREATE SEQUENCE IF NOT EXISTS task_number_seq")
        )
    Base.metadata.create_all(bind=engine)
    # Production parity: type_number trigger'i (main.py
    # _migrate_tasks_type_number'in minimal hali — backfill'siz) olmadan
    # public task_code lookup'lari yeni olusturulan satirlari bulamaz.
    with engine.begin() as conn:
        for seq in (
            "tasks_type_seq_task",
            "tasks_type_seq_issue",
            "tasks_type_seq_suggestion",
        ):
            conn.execute(sa_text(f"CREATE SEQUENCE IF NOT EXISTS {seq}"))
        conn.execute(
            sa_text(
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
            )
        )
        conn.execute(
            sa_text(
                "DROP TRIGGER IF EXISTS trg_assign_type_number ON tasks"
            )
        )
        conn.execute(
            sa_text(
                "CREATE TRIGGER trg_assign_type_number BEFORE INSERT ON "
                "tasks FOR EACH ROW EXECUTE PROCEDURE "
                "assign_task_type_number()"
            )
        )
    yield engine
    engine.dispose()


@pytest.fixture()
def pg_session(pg_engine):
    from sqlalchemy import text as sa_text
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(
        bind=pg_engine, autoflush=False, autocommit=False
    )
    s = Session()
    # Test izolasyonu: yalnizca api_* tablolari temizlenir.
    s.execute(
        sa_text(
            "TRUNCATE api_request_logs, api_client_access, api_tokens, "
            "api_clients, api_cleanup_runs RESTART IDENTITY CASCADE"
        )
    )
    s.commit()
    yield s
    s.rollback()
    s.close()


@pytest.fixture(autouse=True)
def audit_records(monkeypatch):
    """Audit yazimini yakalar: testler gercek DB'ye yazmaz ve kayitlari
    dogrulayabilir. _persist'i patchler; audit middleware'in 'asla istegi
    bozma' garantisi ayri testte gercek hata enjekte edilerek sinanir."""
    records = []
    from app.public_api import audit

    monkeypatch.setattr(audit, "_persist", records.append)
    return records
