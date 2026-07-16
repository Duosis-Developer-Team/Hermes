# =============================================================================
# HERMES - Stage 2B testleri: token uretimi + kimlik dogrulama zinciri
# =============================================================================
# DB'siz calisir: _lookup_token monkeypatch'lenir, get_db sahte session'la
# override edilir (dogrulama zincirinin kendisi ORM nesneleri uzerinde
# calisir — detached instance yeterli).
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.models.api_client import ApiClient, ApiToken
from app.public_api import deps
from app.public_api.app import create_public_app
from app.services import api_client_service as svc


# ── Yardimcilar ─────────────────────────────────────────────────────────


class FakeSession:
    """Dogrulama zincirinin dokundugu kadarini taklit eder."""

    def __init__(self):
        self.commits = 0
        self.rollbacks = 0
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def flush(self):
        pass

    def refresh(self, obj):
        pass

    def query(self, *a, **k):  # /v1/me bindings sorgusu icin
        class _Q:
            def filter(self, *a, **k):
                return self

            def all(self):
                return []

            def first(self):
                return None

        return _Q()


def make_client(**kw):
    base = dict(
        id=uuid.uuid4(),
        name="Test Client",
        client_type="service",
        environment="dev",
        scopes=["tasks:read"],
        status="active",
        bound_user_id=None,
    )
    base.update(kw)
    return ApiClient(**base)


def make_token(client, plaintext=None, **kw):
    if plaintext is None:
        plaintext, prefix, digest = svc.generate_token(client.environment)
    else:
        prefix, digest = plaintext[:12], svc.hash_token(plaintext)
    base = dict(
        id=uuid.uuid4(),
        client_id=client.id,
        token_prefix=prefix,
        token_hash=digest,
        status="active",
        expires_at=None,
        last_used_at=None,
        created_by=uuid.uuid4(),
    )
    base.update(kw)
    return ApiToken(**base), plaintext


@pytest.fixture()
def harness(monkeypatch):
    """(client_setter, http) — client_setter(token_row, client_row) ile
    lookup sonucunu belirle, http ile istek at."""
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
    root.mount("/api/public", public)
    http = TestClient(root, raise_server_exceptions=False)

    def setter(token_row, client_row):
        state["token"] = token_row
        state["client"] = client_row

    return setter, http, fake_db


def get_me(http, token_value):
    return http.get(
        "/api/public/v1/me",
        headers={"Authorization": f"Bearer {token_value}"},
    )


# ── Token uretimi ───────────────────────────────────────────────────────


def test_generate_token_format():
    plaintext, prefix, digest = svc.generate_token("dev")
    assert plaintext.startswith("hms_dev_")
    assert len(plaintext) >= 40  # 32 byte urlsafe ~43 char + prefix
    assert prefix == plaintext[:12]
    assert digest == svc.hash_token(plaintext)
    assert len(digest) == 64  # sha256 hex

    live, _, _ = svc.generate_token("live")
    assert live.startswith("hms_live_")


def test_generate_token_unknown_env_rejected():
    with pytest.raises(ValueError):
        svc.generate_token("staging")


def test_tokens_are_unique():
    seen = {svc.generate_token("dev")[0] for _ in range(50)}
    assert len(seen) == 50


# ── Kimlik dogrulama zinciri ────────────────────────────────────────────


def test_missing_bearer_rejected(harness):
    _, http, _ = harness
    r = http.get("/api/public/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


def test_cookie_never_authenticates(harness):
    """Internal oturum cookie'si public API'de kimlik DEGILDIR."""
    setter, http, _ = harness
    client = make_client()
    token, plaintext = make_token(client)
    setter(token, client)
    r = http.get(
        "/api/public/v1/me",
        cookies={"access_token": plaintext},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


def test_hash_as_token_rejected(harness):
    """DB'deki hash calinsa bile token yerine KULLANILAMAZ."""
    setter, http, _ = harness
    client = make_client()
    token, _ = make_token(client)
    setter(token, client)
    r = get_me(http, token.token_hash)  # 64-hex, hms_ prefix'i yok
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


def test_unknown_token_rejected(harness):
    setter, http, _ = harness
    setter(None, None)
    r = get_me(http, "hms_dev_" + "x" * 43)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


def test_valid_token_returns_me(harness):
    setter, http, _ = harness
    client = make_client(scopes=["tasks:read", "projects:read"])
    token, plaintext = make_token(client)
    setter(token, client)
    r = get_me(http, plaintext)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["client"]["name"] == "Test Client"
    assert body["client"]["environment"] == "dev"
    assert body["token"]["prefix"] == plaintext[:12]
    assert body["scopes"] == ["projects:read", "tasks:read"]
    # Plaintext veya hash yanitin hicbir yerinde olmamali.
    assert plaintext not in r.text
    assert token.token_hash not in r.text


def test_revoked_token_fails_immediately(harness):
    setter, http, _ = harness
    client = make_client()
    token, plaintext = make_token(client, status="revoked")
    setter(token, client)
    r = get_me(http, plaintext)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "revoked_token"


def test_expired_token_fails_immediately(harness):
    setter, http, _ = harness
    client = make_client()
    token, plaintext = make_token(
        client,
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    setter(token, client)
    r = get_me(http, plaintext)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "expired_token"


def test_disabled_client_kills_all_tokens(harness):
    """Amendment #3: client disable → token satirina dokunmadan tum
    token'lar aninda gecersiz."""
    setter, http, _ = harness
    client = make_client(status="disabled")
    token, plaintext = make_token(client)  # token hala 'active'
    setter(token, client)
    r = get_me(http, plaintext)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"
    assert "disabled" in r.json()["error"]["message"]


def test_environment_mismatch_rejected(harness):
    """live token, PUBLIC_API_ENV=dev deployment'inda calismaz."""
    setter, http, _ = harness
    client = make_client(environment="live")
    token, plaintext = make_token(client)
    setter(token, client)
    r = get_me(http, plaintext)
    assert r.status_code == 401
    assert "environment" in r.json()["error"]["message"]


def test_last_used_updates_are_throttled(harness):
    setter, http, fake_db = harness
    client = make_client()
    token, plaintext = make_token(client)
    setter(token, client)
    assert get_me(http, plaintext).status_code == 200
    first_commits = fake_db.commits
    assert token.last_used_at is not None
    # Ikinci istek 60 sn icinde → yeni commit YOK.
    assert get_me(http, plaintext).status_code == 200
    assert fake_db.commits == first_commits


# ── Scope kontrolu ──────────────────────────────────────────────────────


def test_require_scopes_flow(monkeypatch):
    """require_scopes: eksik scope 403, mevcut scope 200."""
    from fastapi import Depends

    from app.public_api.deps import require_scopes

    public = create_public_app()
    fake_db = FakeSession()
    public.dependency_overrides[get_db] = lambda: fake_db

    client = make_client(scopes=["tasks:read"])
    token, plaintext = make_token(client)

    def fake_lookup(db, digest):
        return (token, client) if token.token_hash == digest else (None, None)

    monkeypatch.setattr(deps, "_lookup_token", fake_lookup)

    @public.get("/v1/_test/read")
    async def _read(ctx=Depends(require_scopes("tasks:read"))):
        return {"ok": True}

    @public.get("/v1/_test/write")
    async def _write(ctx=Depends(require_scopes("tasks:write"))):
        return {"ok": True}

    root = FastAPI()
    root.mount("/api/public", public)
    http = TestClient(root, raise_server_exceptions=False)
    auth = {"Authorization": f"Bearer {plaintext}"}

    assert http.get("/api/public/v1/_test/read", headers=auth).status_code == 200
    r = http.get("/api/public/v1/_test/write", headers=auth)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"
    assert "tasks:write" in r.json()["error"]["message"]


# ── Revoke / rotate servis davranisi ────────────────────────────────────


def test_revoke_is_idempotent():
    db = FakeSession()
    client = make_client()
    token, _ = make_token(client)
    svc.revoke_token(db, token)
    first_revoked_at = token.revoked_at
    svc.revoke_token(db, token)
    assert token.status == "revoked"
    assert token.revoked_at == first_revoked_at


def test_rotate_is_transactional_single_commit():
    """Amendment #4: rotate = yeni token + eski revoke, TEK commit."""
    db = FakeSession()
    client = make_client()
    token, old_plain = make_token(client)
    new_plain, new_row = svc.rotate_token(
        db, token, client, created_by=uuid.uuid4()
    )
    assert db.commits == 1  # atomik
    assert token.status == "revoked"
    assert new_row.status == "active"
    assert new_row.rotated_from_token_id == token.id
    assert new_plain != old_plain
    assert new_plain.startswith("hms_dev_")
    # Yeni credential DB'ye plaintext olarak GITMEZ.
    assert new_row.token_hash == svc.hash_token(new_plain)


def test_rotate_revoked_token_conflicts():
    from fastapi import HTTPException

    db = FakeSession()
    client = make_client()
    token, _ = make_token(client, status="revoked")
    with pytest.raises(HTTPException) as e:
        svc.rotate_token(db, token, client, created_by=uuid.uuid4())
    assert e.value.status_code == 409
    assert db.commits == 0


def test_create_token_rejects_past_expiry():
    from fastapi import HTTPException

    db = FakeSession()
    client = make_client()
    with pytest.raises(HTTPException) as e:
        svc.create_token(
            db,
            client,
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
            created_by=uuid.uuid4(),
        )
    assert e.value.status_code == 400
