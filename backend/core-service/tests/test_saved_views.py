"""
=============================================================================
PM rework P3.5 — kayitli gorunumler (E2)
=============================================================================
  1. Kisisel gorunum yalniz sahibine; paylasilan herkese (is erisimi olan).
  2. Yazma sahibi | tasks.admin; baskasinin kisiseli 404 (varlik sizmaz).
  3. filter_json sekli dogrulanir (bilinmeyen anahtar 422), layout
     list|board|calendar, scope personal|shared (system API'den YAZILAMAZ).
  4. Erisimi olmayan kullanici 403.
=============================================================================
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from app.database import get_db
from app.tenant_db import get_tenant_db
from app.main import app

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
ADMIN = uuid.UUID("00000000-0000-4000-8000-00000000e201")
ALICE = uuid.UUID("00000000-0000-4000-8000-00000000e202")
BOB = uuid.UUID("00000000-0000-4000-8000-00000000e203")
NOBODY = uuid.UUID("00000000-0000-4000-8000-00000000e204")
VIEWS = "/api/v1/core/views"


@pytest.fixture()
def http(pg_session, authz_grants):
    pg_session.execute(sa_text("TRUNCATE saved_views CASCADE"))
    pg_session.commit()
    authz_grants[str(ADMIN)] = [Perm.TASKS_ADMIN]
    authz_grants[str(ALICE)] = [Perm.TASKS_ACCESS]
    authz_grants[str(BOB)] = [Perm.ISSUES_ACCESS]
    authz_grants[str(NOBODY)] = []
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_tenant_db] = lambda: pg_session

    def _as(user_id):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user_id), email=f"{user_id}@x.com", full_name="U",
            is_admin=False, tenant_id=TEST_TENANT_ID,
        )
        return TestClient(app, raise_server_exceptions=False)

    yield _as
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _create(http, user, **over):
    body = {"name": "Benim gecikmislerim", "scope": "personal", "layout": "list",
            "filter_json": {"scope": "my-tasks", "due": "overdue", "group_by": "project"}}
    body.update(over)
    return http(user).post(VIEWS, json=body)


def test_personal_and_shared_visibility(http):
    mine = _create(http, ALICE).json()
    shared = _create(http, ALICE, name="Ekip panosu", scope="shared", layout="board",
                     filter_json={"scope": "all", "group_by": "status"}).json()
    _create(http, BOB, name="Bob ozel")

    names = [v["name"] for v in http(ALICE).get(VIEWS).json()["items"]]
    assert names == ["Benim gecikmislerim", "Ekip panosu"]      # kisisel once, sonra paylasilan
    bob = http(BOB).get(VIEWS).json()["items"]
    assert [v["name"] for v in bob] == ["Bob ozel", "Ekip panosu"]
    assert {v["can_edit"] for v in bob if v["name"] == "Ekip panosu"} == {False}
    assert mine["can_edit"] is True and mine["owner_user_id"] == str(ALICE)
    assert shared["scope"] == "shared" and shared["filter_json"]["group_by"] == "status"
    # Admin herkesin paylasilanini duzenleyebilir; baskasinin kisiselini listede gormez.
    admin = http(ADMIN).get(VIEWS).json()["items"]
    assert [v["name"] for v in admin] == ["Ekip panosu"] and admin[0]["can_edit"] is True


def test_update_and_delete_authority(http):
    mine = _create(http, ALICE).json()
    shared = _create(http, ALICE, name="Paylasilan", scope="shared").json()
    # Sahibi gunceller.
    res = http(ALICE).patch(f"{VIEWS}/{mine['id']}", json={"name": "Yeni ad", "layout": "board", "position": 2})
    assert res.status_code == 200 and res.json()["name"] == "Yeni ad" and res.json()["layout"] == "board"
    assert res.json()["position"] == 2
    # Baskasi paylasilani okur ama yazamaz (403); baskasinin kisiselini goremez (404).
    assert http(BOB).patch(f"{VIEWS}/{shared['id']}", json={"name": "x"}).status_code == 403
    assert http(BOB).patch(f"{VIEWS}/{mine['id']}", json={"name": "x"}).status_code == 404
    assert http(BOB).delete(f"{VIEWS}/{mine['id']}").status_code == 404
    # Admin paylasilani silebilir.
    assert http(ADMIN).delete(f"{VIEWS}/{shared['id']}").status_code == 204
    assert http(ALICE).delete(f"{VIEWS}/{mine['id']}").status_code == 204
    assert http(ALICE).get(VIEWS).json()["items"] == []


def test_validation_and_access(http):
    assert http(NOBODY).get(VIEWS).status_code == 403
    assert _create(http, NOBODY).status_code == 403
    assert _create(http, ALICE, filter_json={"bogus": 1}).status_code == 422
    assert _create(http, ALICE, layout="timeline").status_code == 422
    assert _create(http, ALICE, scope="system").status_code == 422
    assert _create(http, ALICE, name="   ").status_code == 422
    assert _create(http, ALICE, filter_json={"status": ["pending"], "type": "issue"}).status_code == 201
    res = http(ALICE).patch(f"{VIEWS}/{uuid.uuid4()}", json={"name": "x"})
    assert res.status_code == 404
