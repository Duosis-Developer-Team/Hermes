# =============================================================================
# HERMES - Stage 2C testleri: data-access + rate limit + audit
# =============================================================================

import logging
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.database import get_db
from app.models.api_client import ApiClientAccess
from app.public_api import audit, deps, rate_limit
from app.public_api.app import create_public_app
from app.services import api_access_service as access
from app.services import api_client_service as svc

from .test_stage2b_auth import FakeSession, make_client, make_token

UID1, UID2, UID3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def make_binding(access_type, target_id=None):
    return ApiClientAccess(
        id=uuid.uuid4(),
        client_id=uuid.uuid4(),
        access_type=access_type,
        target_id=target_id,
    )


# ── AccessScope cozumlemesi (build_scope — saf, DB'siz) ─────────────────


def test_no_bindings_fails_closed():
    scope = access.build_scope(make_client(), [], set())
    assert scope.is_empty
    assert not scope.is_global


def test_global_binding_unrestricted():
    scope = access.build_scope(
        make_client(), [make_binding("global")], set()
    )
    assert scope.is_global and not scope.is_empty


def test_union_of_categories():
    scope = access.build_scope(
        make_client(),
        [
            make_binding("user", UID1),
            make_binding("customer", UID2),
            make_binding("project", UID3),
        ],
        set(),
    )
    assert scope.user_ids == frozenset({UID1})
    assert scope.customer_ids == frozenset({UID2})
    assert scope.project_ids == frozenset({UID3})


def test_group_members_merged_into_users():
    scope = access.build_scope(
        make_client(),
        [make_binding("group", UID1), make_binding("user", UID2)],
        {UID1, UID3},  # grubun aktif uyeleri
    )
    assert scope.user_ids == frozenset({UID1, UID2, UID3})


def test_user_bound_client_capped_at_bound_user():
    """Amendment #6: user-bound client, binding'ler ne derse desin bagli
    kullanicidan fazlasini goremez — baska user binding'i YOK SAYILIR."""
    client = make_client(client_type="user", bound_user_id=UID1)
    scope = access.build_scope(
        client,
        [
            make_binding("user", UID2),  # baska kullanici — yok sayilmali
            make_binding("global"),  # yazim katmani engeller; savunma
        ],
        set(),
    )
    assert not scope.is_global
    assert scope.user_ids == frozenset({UID1})


def test_user_bound_client_without_bound_user_fails_closed():
    client = make_client(client_type="user", bound_user_id=None)
    scope = access.build_scope(client, [make_binding("global")], set())
    assert scope.is_empty


# ── SQL filtre uretimi (compile-only, baglanti yok) ─────────────────────


def _sql(expr):
    return str(
        expr.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def test_task_filter_fail_closed_sql():
    assert _sql(access.task_filter(access.AccessScope())) == "false"


def test_task_filter_global_sql():
    assert (
        _sql(access.task_filter(access.AccessScope(is_global=True)))
        == "true"
    )


def test_task_filter_union_sql():
    scope = access.AccessScope(
        user_ids=frozenset({UID1}),
        project_ids=frozenset({UID2}),
    )
    sql = _sql(access.task_filter(scope))
    assert "tasks.assignee_user_id IN" in sql
    assert "tasks.assigner_user_id IN" in sql
    assert "tasks.project_id IN" in sql
    assert " OR " in sql


def test_work_log_filter_sql():
    scope = access.AccessScope(customer_ids=frozenset({UID1}))
    sql = _sql(access.work_log_filter(scope))
    assert "work_logs.customer_id IN" in sql
    assert (
        _sql(access.work_log_filter(access.AccessScope())) == "false"
    )


# ── InMemoryRateLimiter ─────────────────────────────────────────────────


def test_limiter_fixed_window():
    clock = {"t": 1000.0}
    lim = rate_limit.InMemoryRateLimiter(now_fn=lambda: clock["t"])
    results = [lim.check("k", 3, 60) for _ in range(4)]
    assert [r.allowed for r in results] == [True, True, True, False]
    assert results[0].remaining == 2 and results[3].remaining == 0
    # Pencere doner → sayac sifirlanir.
    clock["t"] = 1060.0
    assert lim.check("k", 3, 60).allowed is True


def test_limiter_keys_are_independent():
    lim = rate_limit.InMemoryRateLimiter(now_fn=lambda: 1000.0)
    assert lim.check("a", 1, 60).allowed
    assert not lim.check("a", 1, 60).allowed
    assert lim.check("b", 1, 60).allowed


# ── Token rate limiting (HTTP seviyesi) ─────────────────────────────────


@pytest.fixture()
def harness(monkeypatch):
    public = create_public_app()
    fake_db = FakeSession()
    public.dependency_overrides[get_db] = lambda: fake_db

    state = {"token": None, "client": None}

    def fake_lookup(db, digest):
        t, c = state["token"], state["client"]
        if t is None or t.token_hash != digest:
            return None, None
        return t, c

    monkeypatch.setattr(deps, "_lookup_token", fake_lookup)
    root = FastAPI()
    root.mount("/api/public", create_public_app_alias(public))
    http = TestClient(root, raise_server_exceptions=False)
    return (lambda t, c: state.update(token=t, client=c)), http


def create_public_app_alias(app):
    return app


def test_token_rate_limit_enforced(harness):
    setter, http = harness
    client = make_client(rate_limit_per_min=2)
    token, plaintext = make_token(client)
    setter(token, client)
    auth = {"Authorization": f"Bearer {plaintext}"}

    r1 = http.get("/api/public/v1/me", headers=auth)
    assert r1.status_code == 200
    # Basarili yanit rate-limit basliklarini tasir.
    assert r1.headers["X-RateLimit-Limit"] == "2"
    assert r1.headers["X-RateLimit-Remaining"] == "1"

    assert http.get("/api/public/v1/me", headers=auth).status_code == 200
    r3 = http.get("/api/public/v1/me", headers=auth)
    assert r3.status_code == 429
    body = r3.json()
    assert body["error"]["code"] == "rate_limit_exceeded"
    assert r3.headers["X-RateLimit-Remaining"] == "0"
    assert "Retry-After" in r3.headers


def test_invalid_auth_ip_limited(harness, monkeypatch):
    """Amendment #7: gecersiz token denemeleri IP bazinda limitlenir;
    denenen token degeri hicbir yerde saklanmaz/loglanmaz."""
    from app.config import get_settings

    monkeypatch.setattr(
        get_settings(), "PUBLIC_API_AUTH_FAIL_LIMIT_PER_MIN", 5
    )
    _, http = harness
    attempted = "hms_dev_" + "guess" * 9
    for _ in range(5):
        r = http.get(
            "/api/public/v1/me",
            headers={"Authorization": f"Bearer {attempted}"},
        )
        assert r.status_code == 401
    r = http.get(
        "/api/public/v1/me",
        headers={"Authorization": f"Bearer {attempted}"},
    )
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limit_exceeded"

    # Limiter anahtarlari yalnizca IP tasir — token degeri ASLA.
    buckets = rate_limit.get_limiter()._buckets
    assert all("hms_" not in k and "guess" not in k for k in buckets)
    assert any(k.startswith("authfail:") for k in buckets)


# ── Audit ───────────────────────────────────────────────────────────────


def test_audit_record_fields(audit_records, harness):
    setter, http = harness
    client = make_client()
    token, plaintext = make_token(client)
    setter(token, client)
    r = http.get(
        "/api/public/v1/me",
        headers={
            "Authorization": f"Bearer {plaintext}",
            "User-Agent": "integration-bot/1.0",
        },
    )
    assert r.status_code == 200
    rec = audit_records[-1]
    assert rec["path"] == "/v1/me"  # route SABLONU, ham URL degil
    assert rec["method"] == "GET"
    assert rec["status_code"] == 200
    assert rec["request_id"] == r.headers["x-request-id"]
    assert rec["client_id"] == str(client.id)
    assert rec["token_id"] == str(token.id)
    assert rec["user_agent"] == "integration-bot/1.0"
    assert isinstance(rec["duration_ms"], int)
    # Sanitizasyon: token/hash/authorization hicbir alanda yok.
    dump = str(rec)
    assert plaintext not in dump
    assert token.token_hash not in dump
    assert "Authorization" not in dump


def test_audit_unauthenticated_request_has_no_identity(
    audit_records, harness
):
    _, http = harness
    r = http.get("/api/public/v1/me")
    assert r.status_code == 401
    rec = audit_records[-1]
    assert rec["client_id"] is None and rec["token_id"] is None
    assert rec["status_code"] == 401


def test_audit_marks_rate_limited(audit_records, harness):
    setter, http = harness
    client = make_client(rate_limit_per_min=1)
    token, plaintext = make_token(client)
    setter(token, client)
    auth = {"Authorization": f"Bearer {plaintext}"}
    http.get("/api/public/v1/me", headers=auth)
    http.get("/api/public/v1/me", headers=auth)  # 429
    assert audit_records[-1]["rate_limited"] is True
    assert audit_records[-1]["status_code"] == 429


def test_audit_failure_never_breaks_request(
    harness, monkeypatch, caplog
):
    """Amendment #8: audit yazimi patlarsa istek yine basarili; server
    loguna sanitize yapisal uyari duser (exception SINIFI, mesaj yok)."""
    setter, http = harness
    client = make_client()
    token, plaintext = make_token(client)
    setter(token, client)

    def boom(record):
        raise RuntimeError("db exploded with secret param hms_dev_xyz")

    monkeypatch.setattr(audit, "_persist", boom)
    with caplog.at_level(logging.WARNING, logger="hermes.public_api.audit"):
        r = http.get(
            "/api/public/v1/me",
            headers={"Authorization": f"Bearer {plaintext}"},
        )
    assert r.status_code == 200  # istek BOZULMADI
    log_text = caplog.text
    assert "audit write failed" in log_text
    assert "RuntimeError" in log_text  # sinif adi var
    assert "secret param" not in log_text  # mesaj YOK (sanitize)
    assert plaintext not in log_text


def test_client_ip_prefers_cloudflare_header(harness):
    """Guven zinciri: CF-Connecting-IP → X-Forwarded-For[0] → soket."""
    setter, http = harness
    client = make_client()
    token, plaintext = make_token(client)
    setter(token, client)
    r = http.get(
        "/api/public/v1/me",
        headers={
            "Authorization": f"Bearer {plaintext}",
            "CF-Connecting-IP": "203.0.113.9",
            "X-Forwarded-For": "10.0.0.1, 10.0.0.2",
        },
    )
    assert r.status_code == 200
    assert token.last_used_ip == "203.0.113.9"
