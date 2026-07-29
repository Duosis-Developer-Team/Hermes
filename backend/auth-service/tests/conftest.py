# =============================================================================
# auth-service tests - Stage 5B-2 internal directory
# =============================================================================
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.dirname(_ROOT)
for _p in (_ROOT, _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Lokaldeki auth-service/.env legacy anahtarlar icerir ve Settings
# (extra=forbid) dotenv fazlaliklarini reddeder — cwd'yi tests/ yapip
# dotenv'i devre disi birakiyoruz (CI'da .env zaten yok).
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Modul-yukleme kontrolleri icin dummy anahtarlar (JWT testte kullanilmaz).
os.environ.setdefault("JWT_PRIVATE_KEY", "test-only-not-a-key")
os.environ.setdefault("JWT_PUBLIC_KEY", "test-only-not-a-key")
os.environ["HERMES_S2S_TOKEN_CURRENT"] = "s2s-current-" + "c" * 40
os.environ["HERMES_S2S_TOKEN_NEXT"] = "s2s-next-" + "n" * 43

import pytest  # noqa: E402

S2S_CURRENT = os.environ["HERMES_S2S_TOKEN_CURRENT"]
S2S_NEXT = os.environ["HERMES_S2S_TOKEN_NEXT"]

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
        pytest.skip("test database unavailable")
    from app.database import Base
    from app.models import rbac, user  # noqa: F401

    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def pg_session(pg_engine):
    from sqlalchemy import text as sa_text
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(bind=pg_engine, autoflush=False,
                           autocommit=False)
    s = Session()
    s.execute(sa_text("TRUNCATE users, rbac_roles CASCADE"))
    s.commit()
    yield s
    s.rollback()
    s.close()


@pytest.fixture()
def auth_http(pg_session):
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app
    from app.routers import internal_directory

    internal_directory._fail_counts.clear()
    app.dependency_overrides[get_db] = lambda: pg_session
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    app.dependency_overrides.pop(get_db, None)
