# =============================================================================
# HERMES - Stage 3F testleri: retention / cleanup
# =============================================================================
# Onayli kurallar sinanir:
#   - api_request_logs 90 gun, api_idempotency_keys 25 saat (24h TTL +
#     1h guvenlik payi) — yalnizca cutoff'tan ESKI satirlar silinir
#   - batch delete (tek dev transaction yok), idempotent tekrar calisma
#   - pg_try_advisory_lock tek-calisan guard'i (cakisan calisma skipped)
#   - hata izolasyonu: exception yutulur, sonuc yalnizca hata SINIFI tasir
#   - is verisi/client/token YAPISAL olarak dokunulamaz
#   - disabled → hicbir sey silinmez, kayit atilmaz
#   - admin status/manuel tetik endpoint'leri (require_admin arkasinda)
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from app.database import get_db
from app.models.api_client import (
    ApiClient,
    ApiCleanupRun,
    ApiIdempotencyKey,
    ApiRequestLog,
)
from app.services import api_cleanup_service as cleanup
from shared.auth import CurrentUser, get_current_user

NOW = datetime.now(timezone.utc)

SETTINGS = cleanup.CleanupSettings(
    enabled=True,
    request_log_retention_days=90,
    idempotency_retention_hours=25,
    batch_size=5000,
)


def _mk_client(s, name="cleanup-client"):
    c = ApiClient(
        tenant_id=TEST_TENANT_ID,
        name=name,
        client_type="service",
        environment="dev",
        scopes=[],
        status="active",
        created_by=uuid.uuid4(),
    )
    s.add(c)
    s.commit()
    return c


def _log(s, age_days):
    s.add(
        ApiRequestLog(
            request_id=f"req_{uuid.uuid4().hex[:10]}",
            method="GET",
            path="/v1/tasks",
            status_code=200,
            duration_ms=5,
            created_at=NOW - timedelta(days=age_days),
        )
    )


def _key(s, client_id, age_hours, key=None):
    s.add(
        ApiIdempotencyKey(
            client_id=client_id,
            key=key or f"k-{uuid.uuid4().hex[:12]}",
            request_hash="h" * 64,
            response_status=201,
            created_at=NOW - timedelta(hours=age_hours),
        )
    )


def _counts(s):
    return (
        s.query(ApiRequestLog).count(),
        s.query(ApiIdempotencyKey).count(),
    )


# ── Cutoff dogrulugu ────────────────────────────────────────────────────


def test_cutoffs_delete_old_keep_recent(pg_session):
    s = pg_session
    c = _mk_client(s)
    _log(s, age_days=91)   # silinmeli
    _log(s, age_days=89)   # kalmali
    _key(s, c.id, age_hours=26)    # silinmeli
    _key(s, c.id, age_hours=23)    # kalmali
    # 24h TTL'i dolmus AMA 25h retention icinde: temizlik DOKUNMAZ
    # (dokumante guvenlik payi — TTL'i okuma katmani uygular).
    _key(s, c.id, age_hours=24.5)
    s.commit()

    result = cleanup.run_cleanup(s, SETTINGS)

    assert result["ok"] is True
    assert result["status"] == "success"
    assert result["request_logs_deleted"] == 1
    assert result["idempotency_keys_deleted"] == 1
    assert _counts(s) == (1, 2)
    run = cleanup.last_run(s)
    assert run.status == "success"
    assert run.request_logs_deleted == 1
    assert run.idempotency_keys_deleted == 1
    assert run.failure_class is None


def test_configured_retention_values_honored(pg_session):
    s = pg_session
    c = _mk_client(s)
    _log(s, age_days=2)          # default 90d'de KALIR
    _key(s, c.id, age_hours=2)   # default 25h'te KALIR
    s.commit()

    assert cleanup.run_cleanup(s, SETTINGS)["status"] == "success"
    assert _counts(s) == (1, 1)  # defaults: dokunulmadi

    tight = cleanup.CleanupSettings(
        enabled=True,
        request_log_retention_days=1,
        idempotency_retention_hours=1,
        batch_size=100,
    )
    result = cleanup.run_cleanup(s, tight)
    assert result["request_logs_deleted"] == 1
    assert result["idempotency_keys_deleted"] == 1
    assert _counts(s) == (0, 0)


def test_rerun_is_idempotent(pg_session):
    s = pg_session
    _log(s, age_days=100)
    s.commit()
    assert cleanup.run_cleanup(s, SETTINGS)["request_logs_deleted"] == 1
    again = cleanup.run_cleanup(s, SETTINGS)
    assert again["status"] == "success"
    assert again["request_logs_deleted"] == 0


# ── Batch davranisi ─────────────────────────────────────────────────────


def test_batch_deletion_avoids_single_transaction(pg_session):
    s = pg_session
    for _ in range(7):
        _log(s, age_days=100)
    s.commit()
    small = cleanup.CleanupSettings(
        enabled=True,
        request_log_retention_days=90,
        idempotency_retention_hours=25,
        batch_size=3,
    )
    result = cleanup.run_cleanup(s, small)
    assert result["request_logs_deleted"] == 7
    assert result["batches"] == 3  # 3 + 3 + 1
    assert _counts(s)[0] == 0


# ── Tek-calisan guard'i ─────────────────────────────────────────────────


def test_advisory_lock_skips_concurrent_run(pg_session):
    s = pg_session
    _log(s, age_days=100)
    s.commit()

    holder = s.get_bind().connect()
    try:
        holder.execute(
            sa_text("SELECT pg_advisory_lock(:k)"),
            {"k": cleanup.ADVISORY_LOCK_KEY},
        )
        result = cleanup.run_cleanup(s, SETTINGS)
        assert result["ok"] is True  # hata degil — yarisi kaybetmek normal
        assert result["status"] == "skipped_already_running"
        assert _counts(s)[0] == 1  # hicbir sey silinmedi
        assert cleanup.last_run(s) is None  # kayit da atilmadi
    finally:
        holder.execute(
            sa_text("SELECT pg_advisory_unlock(:k)"),
            {"k": cleanup.ADVISORY_LOCK_KEY},
        )
        holder.close()

    # Kilit birakilinca normal calisir (kilit sizdirilmemis).
    assert cleanup.run_cleanup(s, SETTINGS)["request_logs_deleted"] == 1


# ── Hata izolasyonu ─────────────────────────────────────────────────────


def test_failure_is_isolated_and_sanitized(pg_session, monkeypatch):
    s = pg_session
    _log(s, age_days=100)
    s.commit()

    def boom(conn, table, cutoff, limit):
        raise RuntimeError("SECRET SQL DETAIL must never leak")

    monkeypatch.setattr(cleanup, "_delete_batch", boom)
    result = cleanup.run_cleanup(s, SETTINGS)  # exception FIRLATMAZ

    assert result["ok"] is False
    assert result["status"] == "failed"
    assert result["failure_class"] == "RuntimeError"
    assert "SECRET" not in str(result)  # detay sizmaz
    run = cleanup.last_run(s)
    assert run.status == "failed"
    assert run.failure_class == "RuntimeError"
    assert _counts(s)[0] == 1  # satir yerinde


# ── Is verisi dokunulmazligi ───────────────────────────────────────────


def test_target_catalog_is_locked():
    """Temizlenebilir tablolar SABIT: yalnizca api_request_logs +
    api_idempotency_keys. Katalog genislemesi bilincli karar ister."""
    assert set(cleanup._TARGETS) == {
        "api_request_logs",
        "api_idempotency_keys",
    }


def test_business_and_credential_tables_untouched(pg_session):
    import json as _json

    from .test_stage3a_tasks_read import make_api_client
    from app.models.customer import Customer
    from app.models.project import Project
    from app.models.task import Task
    from app.models.work_log import WorkLog
    from app.models.work_type import WorkType
    from app.models.api_client import ApiToken

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE work_logs, tasks, work_types, projects, customers "
            "CASCADE"
        )
    )
    s.commit()

    make_api_client(s, "keepme", [("global", None)], scopes=["tasks:read"])
    cust = Customer(id=uuid.uuid4(), name="Keep Co", is_active=True)
    proj = Project(
        id=uuid.uuid4(), customer_id=cust.id, name="Keep", is_active=True
    )
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    s.add_all([cust, proj, wt])
    task = Task(
        id=uuid.uuid4(), task_number=901, type_number=901, task_type="task",
        title="keep", description="d", customer_id=cust.id,
        project_id=proj.id, assignee_user_id=uuid.uuid4(),
        assigner_user_id=uuid.uuid4(),
        scheduled_date=NOW.date() - timedelta(days=400),
        status="pending", priority="medium",
    )
    s.add(task)
    s.flush()
    s.add(
        WorkLog(
            user_id=uuid.uuid4(), customer_id=cust.id, project_id=proj.id,
            work_type_id=wt.id,
            date_worked=NOW.date() - timedelta(days=400),
            duration_hours=Decimal("1.0"),
        )
    )
    _log(s, age_days=400)  # tek silinecek sey bu
    s.commit()

    before = {
        "clients": s.query(ApiClient).count(),
        "tokens": s.query(ApiToken).count(),
        "customers": s.query(Customer).count(),
        "projects": s.query(Project).count(),
        "tasks": s.query(Task).count(),
        "work_logs": s.query(WorkLog).count(),
    }
    result = cleanup.run_cleanup(s, SETTINGS)
    assert result["request_logs_deleted"] == 1
    after = {
        "clients": s.query(ApiClient).count(),
        "tokens": s.query(ApiToken).count(),
        "customers": s.query(Customer).count(),
        "projects": s.query(Project).count(),
        "tasks": s.query(Task).count(),
        "work_logs": s.query(WorkLog).count(),
    }
    assert before == after
    assert before["tokens"] >= 1  # gercekten korunacak sey vardi
    _json.dumps(result)  # ozet JSON-serializable (CronJob stdout'u)


# ── Dry-run ve disabled ─────────────────────────────────────────────────


def test_dry_run_counts_but_deletes_nothing(pg_session):
    s = pg_session
    c = _mk_client(s)
    _log(s, age_days=100)
    _key(s, c.id, age_hours=30)
    s.commit()

    result = cleanup.run_cleanup(s, SETTINGS, dry_run=True)
    assert result["status"] == "success"
    assert result["dry_run"] is True
    assert result["request_logs_deleted"] == 1  # aday sayisi
    assert result["idempotency_keys_deleted"] == 1
    assert _counts(s) == (1, 1)  # hicbir sey silinmedi
    assert cleanup.last_run(s).dry_run is True


def test_disabled_cleanup_is_noop(pg_session):
    s = pg_session
    _log(s, age_days=100)
    s.commit()
    off = cleanup.CleanupSettings(
        enabled=False,
        request_log_retention_days=90,
        idempotency_retention_hours=25,
        batch_size=5000,
    )
    result = cleanup.run_cleanup(s, off)
    assert result["ok"] is True  # calisma hatasi degil — bilincli kapali
    assert result["status"] == "disabled"
    assert _counts(s)[0] == 1
    assert cleanup.last_run(s) is None


# ── Admin endpoint'leri ─────────────────────────────────────────────────

# WS3: CurrentUser artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
ADMIN = CurrentUser(
    id=str(uuid.uuid4()), email="admin@test.local", is_admin=True,
    tenant_id=TEST_TENANT_ID,
)
BASE = "/api/v1/core/admin"


@pytest.fixture()
def admin_http(pg_session):
    from app.main import app
    from app.services import authz_client
    from shared.permissions import ALL_PERMISSIONS

    # RBAC R2: eski require_admin override'inin yeni karsiligi — kimlik
    # get_current_user'dan, izinler stub'lanmis authz cozumunden (ADMIN'e
    # tam katalog). BILEREK monkeypatch KULLANILMAZ: bazi testler kendi
    # icinde monkeypatch.undo() cagirir ve fixture'la ayni ornegi
    # paylastigi icin stub'i da geri alirdi (3f'te yasandi — 503).
    _orig_resolve = authz_client.effective_permissions
    authz_client.effective_permissions = (
        lambda uid, **_kw: frozenset(ALL_PERMISSIONS)
        if str(uid) == ADMIN.id
        else frozenset()
    )
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    http = TestClient(app, raise_server_exceptions=False)
    yield http
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)
    authz_client.effective_permissions = _orig_resolve


def test_admin_status_and_manual_trigger(admin_http, pg_session):
    r = admin_http.get(f"{BASE}/api-cleanup")
    assert r.status_code == 200
    body = r.json()
    assert body["policy"]["request_log_retention_days"] == 90
    assert body["policy"]["idempotency_retention_hours"] == 25
    assert body["last_run"] is None

    _log(pg_session, age_days=100)
    pg_session.commit()

    dry = admin_http.post(f"{BASE}/api-cleanup/run?dry_run=true").json()
    assert dry["status"] == "success" and dry["dry_run"] is True
    assert _counts(pg_session)[0] == 1

    real = admin_http.post(f"{BASE}/api-cleanup/run").json()
    assert real["status"] == "success"
    assert real["request_logs_deleted"] == 1
    assert _counts(pg_session)[0] == 0

    status = admin_http.get(f"{BASE}/api-cleanup").json()
    assert status["last_run"]["status"] == "success"
    assert status["last_run"]["request_logs_deleted"] == 1
    assert status["last_run"]["trigger"] == "manual"


def test_admin_cleanup_requires_admin(pg_session):
    from app.main import app

    app.dependency_overrides[get_db] = lambda: pg_session
    try:
        http = TestClient(app, raise_server_exceptions=False)
        assert http.get(f"{BASE}/api-cleanup").status_code in (401, 403)
        assert http.post(f"{BASE}/api-cleanup/run").status_code in (401, 403)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_admin_manual_trigger_failure_returns_500_sanitized(
    admin_http, pg_session, monkeypatch
):
    """Onayli follow-up: gercek calisma hatasi HTTP 500 + sanitize govde
    (ok=false, failure_class — SQL/mesaj/stack yok)."""
    _log(pg_session, age_days=100)
    pg_session.commit()

    def boom(conn, table, cutoff, limit):
        raise RuntimeError("SECRET SQL DETAIL must never leak")

    monkeypatch.setattr(cleanup, "_delete_batch", boom)
    r = admin_http.post(f"{BASE}/api-cleanup/run")
    assert r.status_code == 500
    body = r.json()
    assert body["ok"] is False
    assert body["status"] == "failed"
    assert body["failure_class"] == "RuntimeError"
    assert "SECRET" not in r.text
    # Basari yollari 200 kalir (ayni oturumda dogrula).
    monkeypatch.undo()
    ok = admin_http.post(f"{BASE}/api-cleanup/run?dry_run=true")
    assert ok.status_code == 200
    assert ok.json()["ok"] is True
