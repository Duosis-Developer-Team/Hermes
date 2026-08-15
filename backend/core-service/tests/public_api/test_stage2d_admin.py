# =============================================================================
# HERMES - Stage 2D testleri: API Management admin backend (gercek Postgres)
# =============================================================================
# pg_session fixture'i gercek bir Postgres ister (conftest'e bakin);
# yoksa bu dosya SKIP edilir. Admin oturumu dependency override ile
# saglanir; public /v1/me cagrilari AYNI DB'ye baglanir — boylece
# create→token→me→revoke→rotate zinciri UCTAN UCA gercek veriyle calisir.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.tenant_db import get_tenant_db
from app.models.api_client import ApiRequestLog
from shared.auth import CurrentUser, get_current_user

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
    # Mounted public app'in get_db'si AYRI instance'tadir — ayni test
    # DB'sine baglanmasi icin onu da override et.
    public_app = next(
        r.app
        for r in app.routes
        if getattr(r, "path", "") == "/api/public"
    )
    app.dependency_overrides[get_db] = lambda: pg_session
    # Internal router'lar tenant baglamli session kullanir.
    app.dependency_overrides[get_tenant_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    public_app.dependency_overrides[get_db] = lambda: pg_session

    http = TestClient(app, raise_server_exceptions=False)
    yield http
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)
    authz_client.effective_permissions = _orig_resolve
    public_app.dependency_overrides.pop(get_db, None)


def _create_client(http, **overrides):
    payload = {
        "name": overrides.pop("name", f"Client {uuid.uuid4().hex[:8]}"),
        "client_type": "service",
        "environment": "dev",
        "scopes": ["tasks:read"],
        "access": [{"access_type": "global"}],
    }
    payload.update(overrides)
    r = http.post(f"{BASE}/api-clients", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ── Oturum korumasi ─────────────────────────────────────────────────────


def test_admin_endpoints_require_session(pg_session):
    """Override YOKKEN: oturum yok → 401; public API token'i (hms_...)
    internal admin endpoint'inde KIMLIK DEGIL → 401."""
    from app.main import app

    http = TestClient(app, raise_server_exceptions=False)
    r = http.get(f"{BASE}/api-clients")
    assert r.status_code == 401

    r = http.get(
        f"{BASE}/api-clients",
        headers={"Authorization": f"Bearer hms_dev_{'x' * 43}"},
    )
    assert r.status_code == 401


def test_admin_endpoints_not_in_public_surface(admin_http):
    """Admin yollari public sub-app'te YOK (404) ve public OpenAPI'de
    gorunmez."""
    assert (
        admin_http.get("/api/public/v1/admin/api-clients").status_code
        == 404
    )
    paths = admin_http.get("/api/public/v1/openapi.json").json()["paths"]
    assert all("api-client" not in p for p in paths)


# ── Client CRUD ─────────────────────────────────────────────────────────


def test_create_client_with_bindings(admin_http):
    body = _create_client(
        admin_http,
        name="Reporting Bot",
        scopes=["tasks:read", "work-logs:read"],
    )
    assert body["name"] == "Reporting Bot"
    assert body["scopes"] == ["tasks:read", "work-logs:read"]
    assert body["status"] == "active"
    assert body["access"][0]["access_type"] == "global"
    assert body["tokens"] == []  # token creation ayri adim


def test_duplicate_client_name_conflicts(admin_http):
    _create_client(admin_http, name="Duplicate Name")
    r = admin_http.post(
        f"{BASE}/api-clients",
        json={
            "name": "Duplicate Name",
            "client_type": "service",
            "environment": "dev",
            "scopes": [],
        },
    )
    assert r.status_code == 409


def test_invalid_scope_rejected(admin_http):
    r = admin_http.post(
        f"{BASE}/api-clients",
        json={
            "name": "Bad Scope Client",
            "client_type": "service",
            "environment": "dev",
            "scopes": ["tasks:annihilate"],
        },
    )
    assert r.status_code == 422


def test_patch_client(admin_http):
    created = _create_client(admin_http)
    r = admin_http.patch(
        f"{BASE}/api-clients/{created['id']}",
        json={"scopes": ["projects:read"], "rate_limit_per_min": 10},
    )
    assert r.status_code == 200
    assert r.json()["scopes"] == ["projects:read"]
    assert r.json()["rate_limit_per_min"] == 10


# ── Token yasam dongusu (uctan uca, gercek DB) ──────────────────────────


def _issue_token(http, client_id, **kw):
    r = http.post(f"{BASE}/api-clients/{client_id}/tokens", json=kw)
    assert r.status_code == 201, r.text
    return r.json()


def _me(http, plaintext):
    return http.get(
        "/api/public/v1/me",
        headers={"Authorization": f"Bearer {plaintext}"},
    )


def test_token_create_and_full_chain(admin_http):
    created = _create_client(admin_http, name="Chain Client")
    issued = _issue_token(admin_http, created["id"])
    plaintext = issued["token"]
    assert plaintext.startswith("hms_dev_")
    assert issued["token_row"]["token_prefix"] == plaintext[:12]

    # Uctan uca: plaintext gercek DB'deki hash'le /v1/me'de dogrulanir.
    r = _me(admin_http, plaintext)
    assert r.status_code == 200, r.text
    assert r.json()["client"]["name"] == "Chain Client"
    assert r.json()["access"][0]["access_type"] == "global"

    # Plaintext bir daha HICBIR yerden alinamaz; hash asla gorunmez.
    detail = admin_http.get(f"{BASE}/api-clients/{created['id']}")
    assert plaintext not in detail.text
    assert "token_hash" not in detail.text
    tokens = admin_http.get(
        f"{BASE}/api-tokens", params={"client_id": created["id"]}
    )
    assert plaintext not in tokens.text


def test_revoke_kills_token(admin_http):
    created = _create_client(admin_http)
    issued = _issue_token(admin_http, created["id"])
    token_id = issued["token_row"]["id"]

    assert _me(admin_http, issued["token"]).status_code == 200
    r = admin_http.post(f"{BASE}/api-tokens/{token_id}/revoke")
    assert r.status_code == 200
    assert r.json()["status"] == "revoked"

    r = _me(admin_http, issued["token"])
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "revoked_token"


def test_rotate_swaps_credentials_atomically(admin_http):
    created = _create_client(admin_http)
    issued = _issue_token(admin_http, created["id"])
    old_plain, old_id = issued["token"], issued["token_row"]["id"]

    r = admin_http.post(f"{BASE}/api-tokens/{old_id}/rotate")
    assert r.status_code == 201
    new_plain = r.json()["token"]
    assert new_plain != old_plain
    assert r.json()["token_row"]["rotated_from_token_id"] == old_id

    assert _me(admin_http, new_plain).status_code == 200
    r = _me(admin_http, old_plain)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "revoked_token"


def test_disable_client_soft_and_immediate(admin_http):
    created = _create_client(admin_http)
    issued = _issue_token(admin_http, created["id"])
    assert _me(admin_http, issued["token"]).status_code == 200

    r = admin_http.delete(f"{BASE}/api-clients/{created['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "disabled"  # soft — satir duruyor

    # Token satiri hala 'active' ama client disabled → aninda 401.
    assert _me(admin_http, issued["token"]).status_code == 401

    # Disabled client'a yeni token verilemez.
    r = admin_http.post(f"{BASE}/api-clients/{created['id']}/tokens", json={})
    assert r.status_code == 409


def test_token_expiry_update(admin_http):
    created = _create_client(admin_http)
    issued = _issue_token(admin_http, created["id"])
    token_id = issued["token_row"]["id"]

    future = (
        datetime.now(timezone.utc) + timedelta(days=30)
    ).isoformat()
    r = admin_http.patch(
        f"{BASE}/api-tokens/{token_id}", json={"expires_at": future}
    )
    assert r.status_code == 200 and r.json()["expires_at"] is not None

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = admin_http.patch(
        f"{BASE}/api-tokens/{token_id}", json={"expires_at": past}
    )
    assert r.status_code == 400


# ── Binding degisimi ────────────────────────────────────────────────────


def test_replace_bindings_transactional(admin_http):
    created = _create_client(admin_http)
    project_id = str(uuid.uuid4())
    r = admin_http.put(
        f"{BASE}/api-clients/{created['id']}/bindings",
        json={
            "access": [
                {"access_type": "project", "target_id": project_id},
                {"access_type": "customer", "target_id": str(uuid.uuid4())},
            ]
        },
    )
    assert r.status_code == 200
    types = sorted(b["access_type"] for b in r.json())
    assert types == ["customer", "project"]

    # global + dar binding birlikte → 422; eski set BOZULMADAN kalir.
    r = admin_http.put(
        f"{BASE}/api-clients/{created['id']}/bindings",
        json={
            "access": [
                {"access_type": "global"},
                {"access_type": "project", "target_id": project_id},
            ]
        },
    )
    assert r.status_code == 422
    detail = admin_http.get(f"{BASE}/api-clients/{created['id']}").json()
    assert len(detail["access"]) == 2  # onceki transactional set duruyor


# ── Request log listesi ─────────────────────────────────────────────────


def test_request_log_filtering(admin_http, pg_session):
    c1, c2 = uuid.uuid4(), uuid.uuid4()
    base_time = datetime.now(timezone.utc)
    rows = [
        ApiRequestLog(
            request_id=f"req_{i:032x}",
            client_id=c1 if i % 2 == 0 else c2,
            token_id=None,
            method="GET",
            path="/v1/me",
            status_code=200 if i < 8 else 429,
            duration_ms=10 + i,
            source_ip="203.0.113.1",
            user_agent="bot",
            rate_limited=i >= 8,
            created_at=base_time - timedelta(minutes=i),
        )
        for i in range(10)
    ]
    pg_session.add_all(rows)
    pg_session.commit()

    # Pagination
    r = admin_http.get(f"{BASE}/api-request-logs", params={"limit": 3})
    assert r.status_code == 200 and len(r.json()) == 3

    # Client filtresi
    r = admin_http.get(
        f"{BASE}/api-request-logs", params={"client_id": str(c1)}
    )
    assert {row["client_id"] for row in r.json()} == {str(c1)}

    # Status filtresi
    r = admin_http.get(
        f"{BASE}/api-request-logs", params={"status_code": 429}
    )
    assert len(r.json()) == 2
    assert all(row["rate_limited"] for row in r.json())

    # request_id aramasi
    r = admin_http.get(
        f"{BASE}/api-request-logs",
        params={"request_id": f"req_{3:032x}"},
    )
    assert len(r.json()) == 1

    # Tarih araligi
    r = admin_http.get(
        f"{BASE}/api-request-logs",
        params={
            "created_from": (
                base_time - timedelta(minutes=2, seconds=30)
            ).isoformat()
        },
    )
    assert len(r.json()) == 3
