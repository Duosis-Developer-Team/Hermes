# =============================================================================
# HERMES - Stage 5B-2 testleri: public users/groups dizini
# =============================================================================
# auth-service GERCEK degil: directory_client'a httpx.MockTransport
# enjekte edilir (fake profiller + istek yakalama). Gorunurluk kumesi
# core'da hesaplandigindan matris testleri gercek PG uzerinde kosulur.
# =============================================================================

import json as _json
import uuid
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.services import directory_client

from .test_stage3a_tasks_read import make_api_client

BASE = "/api/public/v1"

U_BOUND = uuid.uuid4()   # user-bound token'in kullanicisi
U_TEAM = uuid.uuid4()    # ayni grubun uyesi
U_ASSIGNER = uuid.uuid4()  # gorunur task'in atayani
U_STRANGER = uuid.uuid4()  # HICBIR gorunur kayitta yok
U_GHOST = uuid.uuid4()     # var olmayan kullanici

_NAMES = {
    str(U_BOUND): "Bound User",
    str(U_TEAM): "Team Mate",
    str(U_ASSIGNER): "Assigner Person",
    str(U_STRANGER): "Stranger Danger",
}


@pytest.fixture()
def fake_auth(monkeypatch):
    """directory_client'a sahte auth-service enjekte eder; yapilan
    istekleri yakalar."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("/users/resolve"):
            ids = _json.loads(request.content)["user_ids"]
            users = [
                {
                    "id": i,
                    "display_name": _NAMES[i],
                    "work_email": f"{_NAMES[i].split()[0].lower()}@x.com",
                    "is_active": True,
                }
                for i in ids
                if i in _NAMES
            ]
            return httpx.Response(200, json={"users": users})
        # global liste
        users = [
            {
                "id": k,
                "display_name": v,
                "work_email": "g@x.com",
                "is_active": True,
            }
            for k, v in sorted(_NAMES.items(), key=lambda kv: kv[1])
        ]
        return httpx.Response(200, json={"users": users,
                                         "has_more": False})

    directory_client.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    directory_client.clear_cache()
    monkeypatch.setattr(
        directory_client.get_settings(),
        "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )
    yield calls
    directory_client.set_client_factory(lambda: httpx.Client(timeout=5))
    directory_client.clear_cache()


@pytest.fixture()
def world(pg_session):
    from sqlalchemy import text as sa_text

    from app.models.customer import Customer
    from app.models.project import Project
    from app.models.task import Task
    from app.models.user_group import UserGroup, UserGroupMember

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE user_group_members, user_groups, work_logs, "
            "meeting_attendees, meetings, task_comments, "
            "task_activity_events, tasks, projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM",
                 is_active=True)
    s.add_all([c1, p1])

    # Gorunur task: assignee=U_BOUND, assigner=U_ASSIGNER.
    s.add(
        Task(
            id=uuid.uuid4(), task_number=701, type_number=701,
            task_type="task", title="t", description="d",
            customer_id=c1.id, project_id=p1.id,
            assignee_user_id=U_BOUND, assigner_user_id=U_ASSIGNER,
            scheduled_date=date(2026, 7, 1), status="pending",
            priority="medium",
        )
    )

    g1 = UserGroup(id=uuid.uuid4(), name="Platform Team",
                   description="desc", is_active=True)
    g_other = UserGroup(id=uuid.uuid4(), name="Other Team",
                        is_active=True)
    s.add_all([g1, g_other])
    s.flush()
    s.add_all(
        [
            UserGroupMember(id=uuid.uuid4(), group_id=g1.id,
                            user_id=U_BOUND, is_active=True),
            UserGroupMember(id=uuid.uuid4(), group_id=g1.id,
                            user_id=U_TEAM, is_active=True),
            UserGroupMember(id=uuid.uuid4(), group_id=g_other.id,
                            user_id=U_STRANGER, is_active=True),
        ]
    )
    s.commit()
    return {"g1": g1, "g_other": g_other}


@pytest.fixture()
def public_http(pg_session):
    from app.main import app

    public_app = next(
        r.app for r in app.routes if getattr(r, "path", "") == "/api/public"
    )
    public_app.dependency_overrides[get_db] = lambda: pg_session
    http = TestClient(app, raise_server_exceptions=False)
    yield http
    public_app.dependency_overrides.pop(get_db, None)


DIR_SCOPES = ["users:read", "groups:read"]


def bound_headers(pg_session, scopes=None):
    return make_api_client(
        pg_session,
        f"dir-{uuid.uuid4().hex[:6]}",
        [("user", U_BOUND)],
        client_type="user",
        bound_user_id=U_BOUND,
        scopes=scopes or DIR_SCOPES,
    )


# ── Gorunurluk matrisi ─────────────────────────────────────────────────


def test_user_bound_sees_only_derived_identities(
    world, fake_auth, public_http, pg_session
):
    h = bound_headers(pg_session)
    r = public_http.get(f"{BASE}/users", headers=h)
    assert r.status_code == 200
    names = [u["display_name"] for u in r.json()["data"]]
    # Kendisi + task atayani + grup arkadasi; STRANGER YOK.
    assert names == ["Assigner Person", "Bound User", "Team Mate"]
    # E-posta minimal semada var; yasak alan yok.
    for u in r.json()["data"]:
        assert set(u.keys()) == {
            "id", "display_name", "work_email", "is_active",
        }


def test_unrelated_enumeration_blocked_404_identical(
    world, fake_auth, public_http, pg_session
):
    h = bound_headers(pg_session)
    hidden = public_http.get(f"{BASE}/users/{U_STRANGER}", headers=h)
    missing = public_http.get(f"{BASE}/users/{U_GHOST}", headers=h)
    assert hidden.status_code == missing.status_code == 404
    b1, b2 = hidden.json(), missing.json()
    b1["error"].pop("request_id")
    b2["error"].pop("request_id")
    assert b1 == b2


def test_search_restricted_to_authorized_set(
    world, fake_auth, public_http, pg_session
):
    h = bound_headers(pg_session)
    # "Stranger" ismen eslesirdi ama yetkili kumede degil → bos.
    r = public_http.get(f"{BASE}/users?q=stranger", headers=h)
    assert r.json()["data"] == []
    r = public_http.get(f"{BASE}/users?q=team", headers=h)
    assert [u["display_name"] for u in r.json()["data"]] == ["Team Mate"]
    # Yetkili kume disina hicbir resolve istegi ID'si cikmadi.
    for req in fake_auth:
        if req.url.path.endswith("/resolve"):
            ids = set(_json.loads(req.content)["user_ids"])
            assert str(U_STRANGER) not in ids


def test_global_binding_lists_broad_directory(
    world, fake_auth, public_http, pg_session
):
    h = make_api_client(
        pg_session, "dir-global", [("global", None)], scopes=DIR_SCOPES
    )
    r = public_http.get(f"{BASE}/users", headers=h)
    names = [u["display_name"] for u in r.json()["data"]]
    assert "Stranger Danger" in names  # global genis dizini gorur
    # Genis dizin YALNIZCA global yolda cagrilir (GET /users).
    assert any(
        req.method == "GET" and req.url.path.endswith("/directory/users")
        for req in fake_auth
    )


def test_scope_required(world, fake_auth, public_http, pg_session):
    h = bound_headers(pg_session, scopes=["groups:read"])
    r = public_http.get(f"{BASE}/users", headers=h)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"


# ── Gruplar ─────────────────────────────────────────────────────────────


def test_groups_visibility_and_member_count(
    world, fake_auth, public_http, pg_session
):
    h = bound_headers(pg_session)
    r = public_http.get(f"{BASE}/groups", headers=h)
    groups = r.json()["data"]
    assert [g["name"] for g in groups] == ["Platform Team"]
    assert groups[0]["member_count"] == 2
    assert "members" not in groups[0]  # uye listesi ASLA yok

    hidden = public_http.get(
        f"{BASE}/groups/{world['g_other'].id}", headers=h
    )
    missing = public_http.get(f"{BASE}/groups/{uuid.uuid4()}", headers=h)
    assert hidden.status_code == missing.status_code == 404
    b1, b2 = hidden.json(), missing.json()
    b1["error"].pop("request_id")
    b2["error"].pop("request_id")
    assert b1 == b2


def test_explicit_group_binding_grants_that_group(
    world, fake_auth, public_http, pg_session
):
    h = make_api_client(
        pg_session,
        "dir-grpbind",
        [("group", world["g_other"].id)],
        scopes=DIR_SCOPES,
    )
    r = public_http.get(f"{BASE}/groups", headers=h)
    assert [g["name"] for g in r.json()["data"]] == ["Other Team"]
    # Grup uyeleri kullanici gorunurlugune de girer (scope.user_ids).
    r = public_http.get(f"{BASE}/users", headers=h)
    assert [u["display_name"] for u in r.json()["data"]] == [
        "Stranger Danger"
    ]


# ── Cache + fail-closed ────────────────────────────────────────────────


def test_positive_cache_avoids_second_call(
    world, fake_auth, public_http, pg_session
):
    h = bound_headers(pg_session)
    public_http.get(f"{BASE}/users/{U_BOUND}", headers=h)
    resolves_before = sum(
        1 for r in fake_auth if r.url.path.endswith("/resolve")
    )
    public_http.get(f"{BASE}/users/{U_BOUND}", headers=h)
    resolves_after = sum(
        1 for r in fake_auth if r.url.path.endswith("/resolve")
    )
    assert resolves_after == resolves_before  # cache'ten geldi


def test_negative_cache_short_ttl(world, fake_auth, monkeypatch):
    from app.services import directory_client as dc

    out = dc.resolve_users([str(U_GHOST)])
    assert out == {}
    n_before = sum(1 for r in fake_auth if r.url.path.endswith("/resolve"))
    out = dc.resolve_users([str(U_GHOST)])  # negatif cache'ten
    assert out == {}
    assert (
        sum(1 for r in fake_auth if r.url.path.endswith("/resolve"))
        == n_before
    )
    # TTL dolunca yeniden sorulur.
    key = str(U_GHOST)
    expires, val = dc._cache[key]
    dc._cache[key] = (0.0, val)
    dc.resolve_users([key])
    assert (
        sum(1 for r in fake_auth if r.url.path.endswith("/resolve"))
        == n_before + 1
    )


def test_auth_unavailable_fails_closed_sanitized(
    world, public_http, pg_session, monkeypatch
):
    def boom(request):
        raise httpx.ConnectError("SECRET-HOST-DETAIL")

    directory_client.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(boom))
    )
    directory_client.clear_cache()
    monkeypatch.setattr(
        directory_client.get_settings(),
        "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )
    h = bound_headers(pg_session)
    r = public_http.get(f"{BASE}/users", headers=h)
    assert r.status_code == 500
    body = r.json()["error"]
    assert body["code"] == "internal_error"
    assert "SECRET-HOST-DETAIL" not in r.text
    assert "auth-service" not in r.text
    directory_client.set_client_factory(lambda: httpx.Client(timeout=5))
    directory_client.clear_cache()


def test_s2s_unconfigured_fails_closed(world, public_http, pg_session):
    directory_client.clear_cache()  # config bos (default)
    h = bound_headers(pg_session)
    r = public_http.get(f"{BASE}/users", headers=h)
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal_error"


# ── E-posta S2S yolu ───────────────────────────────────────────────────


def test_notification_lookup_uses_s2s_without_jwt(monkeypatch):
    """token='' olsa bile S2S varsa alicilar cozulur → API-token
    kaynakli olaylarda e-posta paritesi."""
    import anyio

    from app.services import task_notifications as tn

    captured = {}

    class FakeResp:
        status_code = 200

        @staticmethod
        def json():
            return {
                "users": [
                    {
                        "id": str(U_BOUND),
                        "display_name": "Bound User",
                        "work_email": "bound@x.com",
                        "is_active": True,
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["auth"] = headers["Authorization"]
            return FakeResp()

    monkeypatch.setattr(tn.httpx, "AsyncClient", FakeClient)
    from app import config as core_config

    monkeypatch.setattr(
        core_config.get_settings(),
        "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "y" * 40,
    )

    out = anyio.run(tn._resolve_users, "", [str(U_BOUND)])
    assert out[str(U_BOUND)]["email"] == "bound@x.com"
    assert "/internal/directory/users/resolve" in captured["url"]
    assert "s2s-test-" in captured["auth"]  # JWT degil, S2S
