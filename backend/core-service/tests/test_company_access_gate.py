# =============================================================================
# Sirket hesabi kapisi + kullanici bazli modul kapisi (docs/tenant-platform/01)
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. ROUTE-WALK: /api/v1/core altindaki her uc ya `require_internal_account`
#      tasir ya da sirket hesabina acik dar kumedendir (talep portali, yardim
#      merkezi, /tickets/context, saglayici kapili hub uclari). Yeni router
#      eklenip kapi unutulursa test kirilir.
#   2. Sirket hesabi (token claim'i YA DA auth profili) ic uclarda 404 alir;
#      auth'a ulasilamasa bile claim yeter (fail-closed).
#   3. Modul kapisi kullanici bazli: auth profilindeki etkin moduller; profil
#      yoksa kisi tenant tavanina duser, sirket hesabi hicbir seye.
#   4. Grup kimlikleri auth'a istekle gider; /internal/access/groups S2S.
# =============================================================================

import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from .conftest import AUTHZ_PROFILES, AUTHZ_REQUESTS, TEST_TENANT_ID

EXTERNAL_PREFIXES = ("/api/v1/core/support/",)
EXTERNAL_PATHS = {"/api/v1/core/tickets/context"}
HUB_GATES = {"require_support_surface", "hub_scope"}


def _dependency_names(dependant) -> set:
    names = set()
    stack = [dependant]
    while stack:
        d = stack.pop()
        if d.call is not None:
            names.add(getattr(d.call, "__name__", ""))
        stack.extend(d.dependencies)
    return names


def test_every_core_route_is_internal_or_explicitly_open_to_companies():
    from app.main import app

    leaks = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/v1/core"):
            continue
        names = _dependency_names(route.dependant)
        if "require_internal_account" in names:
            continue
        if route.path in EXTERNAL_PATHS or route.path.startswith(EXTERNAL_PREFIXES):
            continue
        if route.path.startswith("/api/v1/core/tickets") and names & HUB_GATES:
            continue          # saglayici kapisi: sirket hesabi saglayici DEGIL → 404
        leaks.append(f"{sorted(route.methods)} {route.path}")
    assert leaks == [], "Sirket hesabina acik kalan uclar:\n" + "\n".join(leaks)


def _client(user_id, *, kind="person", db=None):
    from app.database import get_db
    from app.main import app
    from app.tenant_db import get_tenant_db
    from shared.auth import CurrentUser, get_current_user

    if db is not None:
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_tenant_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(user_id), email=f"{user_id}@duosis.com", tenant_id=TEST_TENANT_ID, account_kind=kind,
    )
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def clean_overrides():
    from app.main import app

    yield
    app.dependency_overrides.clear()


def test_company_accounts_are_kept_out_of_internal_surfaces(pg_session, authz_grants, clean_overrides):
    account = uuid.uuid4()
    authz_grants[str(account)] = ["tickets.access", "tickets.create"]
    client = _client(account, kind="company")
    for path in ("/api/v1/core/customers", "/api/v1/core/projects", "/api/v1/core/notifications",
                 "/api/v1/core/admin/user-groups", "/api/v1/core/home/week"):
        assert client.get(path).status_code == 404, path

    # Claim'i olmayan (person) token'a ragmen auth profili sirket diyorsa → 404.
    sneaky = uuid.uuid4()
    AUTHZ_PROFILES[str(sneaky)] = {"account_kind": "company", "modules": ["tickets"]}
    assert _client(sneaky).get("/api/v1/core/customers").status_code == 404


def test_company_claim_alone_is_enough_when_auth_is_unreachable(pg_session, clean_overrides):
    # authz fake YOK: S2S yapilandirilmamis → profil alinamaz. Kisi tenant
    # tavanina duser, sirket hesabi yine kapali.
    assert _client(uuid.uuid4(), kind="company").get("/api/v1/core/customers").status_code == 404
    assert _client(uuid.uuid4(), db=pg_session).get("/api/v1/core/customers").status_code == 200


def test_module_gate_follows_the_users_effective_modules(pg_session, authz_grants, clean_overrides):
    user = uuid.uuid4()
    authz_grants[str(user)] = ["tasks.access"]
    AUTHZ_PROFILES[str(user)] = {"modules": ["tickets"], "account_kind": "person"}
    client = _client(user, db=pg_session)
    assert client.get("/api/v1/core/work-types").status_code == 404          # zaman girisi kapali
    assert client.get("/api/v1/core/meetings/sync-status").status_code == 404
    AUTHZ_PROFILES[str(user)] = {"modules": ["time_entry", "meetings", "tickets"], "account_kind": "person"}
    from app.services import authz_client

    authz_client.clear_cache()
    assert client.get("/api/v1/core/work-types").status_code == 200

    # Eski auth (modulsuz yanit) → tenant tavani.
    legacy = uuid.uuid4()
    authz_grants[str(legacy)] = []
    assert _client(legacy, db=pg_session).get("/api/v1/core/work-types").status_code == 200


def test_group_ids_travel_with_the_permission_lookup(pg_session, authz_grants, clean_overrides):
    from app.services import authz_client

    user, group = str(uuid.uuid4()), str(uuid.uuid4())
    authz_client.set_group_resolver(lambda tenant_id, ids: {u: [group] for u in ids})
    authz_client.access_profile(user, tenant_id=TEST_TENANT_ID)
    assert AUTHZ_REQUESTS[-1]["group_ids"] == {user: [group]}


def test_internal_group_lookup_is_s2s_only(pg_session, monkeypatch):
    from app.config import get_settings
    from app.main import app
    from app.models.user_group import UserGroup, UserGroupMember

    token = "s2s-" + "g" * 40
    monkeypatch.setattr(get_settings(), "HERMES_S2S_TOKEN_CURRENT", token)
    group = UserGroup(id=uuid.uuid4(), name=f"Destek {uuid.uuid4().hex[:6]}", is_active=True)
    off = UserGroup(id=uuid.uuid4(), name=f"Eski {uuid.uuid4().hex[:6]}", is_active=False)
    user = uuid.uuid4()
    pg_session.add_all([group, off])
    pg_session.flush()
    pg_session.add_all([UserGroupMember(group_id=group.id, user_id=user, is_active=True),
                        UserGroupMember(group_id=off.id, user_id=user, is_active=True)])
    pg_session.commit()
    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: pg_session
    try:
        client = TestClient(app)
        body = {"tenant_id": TEST_TENANT_ID, "user_ids": [str(user)]}
        assert client.post("/internal/access/groups", json=body).status_code == 401
        r = client.post("/internal/access/groups", json=body, headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["users"] == {str(user): [str(group.id)]}        # pasif grup sayilmaz
    finally:
        app.dependency_overrides.pop(get_db, None)
        pg_session.query(UserGroupMember).filter(UserGroupMember.user_id == user).delete()
        pg_session.query(UserGroup).filter(UserGroup.id.in_([group.id, off.id])).delete()
        pg_session.commit()
