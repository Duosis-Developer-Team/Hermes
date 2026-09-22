"""
=============================================================================
PM rework P3.6 — A5: eski `issues` modulu emekli (410 Gone)
=============================================================================
  1. Token'siz istek yine 401 (kimlik kapisi once).
  2. Kimlikli her istek (liste/olustur/oku/guncelle/sil) 410 + yonlendirme
     mesaji; hicbir sey okunmaz/yazilmaz.
  3. Issue is kalemi olarak /tasks'ta yasar: `task_type=issue` listesi
     calisir (issues.access ile).
=============================================================================
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from app.database import get_db
from app.tenant_db import get_tenant_db
from app.main import app

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
USER = uuid.UUID("00000000-0000-4000-8000-00000000a501")
ISSUES = "/api/v1/core/issues"


@pytest.fixture()
def http(pg_session, authz_grants):
    authz_grants[str(USER)] = [Perm.ISSUES_ACCESS, Perm.TASKS_ACCESS]
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_tenant_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(USER), email="a5@x.com", full_name="U", is_admin=False, tenant_id=TEST_TENANT_ID,
    )
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def test_unauthenticated_is_still_401(pg_session):
    app.dependency_overrides[get_db] = lambda: pg_session
    try:
        assert TestClient(app, raise_server_exceptions=False).get(ISSUES).status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_every_legacy_endpoint_is_gone(http):
    some_id = uuid.uuid4()
    assert http.get(ISSUES).status_code == 410
    assert http.post(ISSUES, json={"title": "x", "project_id": str(some_id)}).status_code == 410
    assert http.get(f"{ISSUES}/{some_id}").status_code == 410
    assert http.put(f"{ISSUES}/{some_id}", json={"title": "y"}).status_code == 410
    assert http.delete(f"{ISSUES}/{some_id}").status_code == 410
    body = http.get(ISSUES).json()
    assert "task_type=issue" in body["detail"]


def test_issues_live_as_work_items(http):
    res = http.get("/api/v1/core/tasks", params={"task_type": "issue"})
    assert res.status_code == 200 and isinstance(res.json(), list)
