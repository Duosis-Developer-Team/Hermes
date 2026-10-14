# =============================================================================
# Sirket hesaplari + modul erisimi (docs/tenant-platform/01, auth 0007)
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. Kural yoksa davranis AYNEN: her ic kullanici tenant'in tum modullerini
#      gorur (K6.3).
#   2. Modul "Seçili"ye alininca yalniz kural sahibi kullanici/grup gorur;
#      yonetici MUAF (K6.4); izinler etkin modullerle kesisir.
#   3. Sirket hesabi: yalniz kendisine acilan moduller; "Herkes" onu
#      KAPSAMAZ; cekirdek izin HIC gecmez (role yazilsa bile); Talepler
#      varsa talep izni ORTUK (K6.2); rol atanamaz.
#   4. Sirket hesabi kisi listelerinde yok; dizinde yalniz kendini gorur.
#   5. Yonetim uclari izinle korunur ve gecersiz kurali reddeder.
# =============================================================================

import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.models.rbac import RbacRole, RbacUserRole
from app.models.tenancy import Tenant, TenantMembership
from app.models.user import User
from app.services import module_access as access
from app.services import tenant_provisioning as prov
from shared.auth import hash_password
from shared.modules import ALL_MODULES
from shared.permissions import Perm


@pytest.fixture(autouse=True)
def _clean(pg_session):
    from sqlalchemy import text as sa_text

    pg_session.execute(sa_text(
        "TRUNCATE tenants, tenant_provisioning_operations, plans, "
        "platform_audit_events CASCADE"
    ))
    pg_session.commit()
    access.clear_group_cache()
    yield


@pytest.fixture()
def world(pg_session):
    with patch.object(prov, "_project_to_core", return_value=None):
        prov.provision_tenant(pg_session, slug="duosis", display_name="Duosis",
                              owner_email="cto@duosis.com")
    pg_session.commit()
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "duosis").one()
    owner = pg_session.query(User).filter(User.email == "cto@duosis.com").one()
    member = _person(pg_session, tenant, "ali@duosis.com",
                     [Perm.TASKS_ACCESS, Perm.TICKETS_ACCESS, Perm.TICKETS_RESPOND])
    return {"s": pg_session, "tenant": tenant, "owner": owner, "member": member}


def _person(db, tenant, email, perms):
    user = User(email=email, full_name=email.split("@")[0], hashed_password=hash_password("x" * 10),
                is_active=True, is_admin=False)
    db.add(user)
    db.flush()
    db.add(TenantMembership(tenant_id=tenant.id, user_id=user.id, status="active"))
    role = RbacRole(tenant_id=tenant.id, code=f"r-{uuid.uuid4().hex[:8]}", name=email, permissions=perms,
                    is_active=True)
    db.add(role)
    db.flush()
    db.add(RbacUserRole(tenant_id=tenant.id, user_id=user.id, role_id=role.id))
    db.commit()
    return user


@contextmanager
def _as(db, user, tenant):
    from app.database import get_db
    from app.main import app
    from shared.auth import CurrentUser, get_current_user

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(user.id), email=user.email, full_name=user.full_name, is_admin=False,
        tenant_id=str(tenant.id), membership_id=str(uuid.uuid4()),
    )
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def _profile(w, user, **kw):
    return access.access_profile(w["s"], user.id, tenant_id=w["tenant"].id, **kw)


def _create_company(w, **body):
    with _as(w["s"], w["owner"], w["tenant"]) as c:
        r = c.post("/api/v1/auth/companies", json={
            "name": "Defacto", "email": "destek@defacto.com.tr", "password": "Guclu-Parola-1", **body})
    assert r.status_code == 201, r.text
    return r.json()


def test_without_rules_everyone_keeps_every_module(world):
    p = _profile(world, world["member"])
    assert p.kind == "person" and p.modules_list() == list(ALL_MODULES)
    assert Perm.TASKS_ACCESS in p.permissions


def test_selected_module_needs_a_rule_and_admins_are_exempt(world):
    w, s = world, world["s"]
    tid = w["tenant"].id
    access.set_policy(s, tenant_id=tid, module="work", everyone=False, grants=[], actor_id=w["owner"].id)
    s.commit()
    hidden = _profile(w, w["member"])
    assert "work" not in hidden.modules and Perm.TASKS_ACCESS not in hidden.permissions
    assert Perm.TICKETS_RESPOND in hidden.permissions                    # diger moduller aynen
    assert "work" in _profile(w, w["owner"]).modules                     # yonetici muaf

    group = uuid.uuid4()
    access.set_policy(s, tenant_id=tid, module="work", everyone=False,
                      grants=[{"type": "group", "id": str(group)}], actor_id=w["owner"].id)
    s.commit()
    assert "work" in _profile(w, w["member"], group_ids=[group]).modules
    assert "work" not in _profile(w, w["member"], group_ids=[]).modules

    access.set_policy(s, tenant_id=tid, module="work", everyone=False,
                      grants=[{"type": "user", "id": str(w["member"].id)}], actor_id=w["owner"].id)
    s.commit()
    assert Perm.TASKS_ACCESS in _profile(w, w["member"]).permissions


def test_dependencies_hold_per_user(world):
    w, s = world, world["s"]
    access.set_policy(s, tenant_id=w["tenant"].id, module="time_entry", everyone=False, grants=[],
                      actor_id=w["owner"].id)
    s.commit()
    modules = _profile(w, w["member"]).modules
    assert "time_entry" not in modules and "reports" not in modules     # raporlar zaman girisine bagli


def test_company_account_sees_only_its_modules_and_no_core_permission(world):
    w, s = world, world["s"]
    company = _create_company(w)
    assert company["modules"] == ["tickets"] and company["is_active"] is True
    user = s.get(User, uuid.UUID(company["id"]))
    p = _profile(w, user)
    assert p.kind == "company" and p.modules_list() == ["tickets"]
    assert p.permissions == {Perm.TICKETS_ACCESS, Perm.TICKETS_CREATE}   # ortuk, rolsuz

    # Bir rol satiri dogrudan yazilsa bile cekirdek izin GECMEZ.
    role = RbacRole(tenant_id=w["tenant"].id, code="sneaky", name="x",
                    permissions=[Perm.USERS_MANAGE, Perm.TICKETS_ADMIN, Perm.TASKS_ACCESS], is_active=True)
    s.add(role)
    s.flush()
    s.add(RbacUserRole(tenant_id=w["tenant"].id, user_id=user.id, role_id=role.id))
    s.commit()
    p = _profile(w, user)
    assert Perm.USERS_MANAGE not in p.permissions and Perm.TASKS_ACCESS not in p.permissions
    assert Perm.TICKETS_ADMIN in p.permissions                           # modulun kendi izni

    # Rol atama ucu sirket hesabini reddeder.
    with _as(s, w["owner"], w["tenant"]) as c:
        r = c.put(f"/api/v1/auth/rbac/users/{user.id}/roles", json={"role_ids": [str(role.id)]})
    assert r.status_code == 409


def test_everyone_does_not_include_companies_but_rules_do(world):
    w, s = world, world["s"]
    company = _create_company(w, modules=[])
    user = s.get(User, uuid.UUID(company["id"]))
    assert _profile(w, user).modules == frozenset()
    access.set_policy(s, tenant_id=w["tenant"].id, module="meetings", everyone=True,
                      grants=[{"type": "user", "id": company["id"]}], actor_id=w["owner"].id)
    s.commit()
    assert _profile(w, user).modules_list() == ["meetings"]


def test_company_management_and_listings(world):
    w, s = world, world["s"]
    company = _create_company(w)
    with _as(s, w["owner"], w["tenant"]) as c:
        assert [x["name"] for x in c.get("/api/v1/auth/companies").json()] == ["Defacto"]
        listed = c.get("/api/v1/auth/users", params={"include_inactive": True}).json()["data"]
        assert company["id"] not in [u["id"] for u in listed]
        assert c.post("/api/v1/auth/companies", json={
            "name": "Kopya", "email": "destek@defacto.com.tr", "password": "Guclu-Parola-1"}).status_code == 409
        bad = c.patch(f"/api/v1/auth/companies/{company['id']}", json={"modules": ["payroll"]})
        assert bad.status_code == 422
        off = c.patch(f"/api/v1/auth/companies/{company['id']}", json={"is_active": False}).json()
        assert off["is_active"] is False
    user = s.get(User, uuid.UUID(company["id"]))
    assert _profile(w, user).modules == frozenset()                     # askidaki hesap: hicbir sey
    with _as(s, w["member"], w["tenant"]) as c:
        assert c.get("/api/v1/auth/companies").status_code == 403


def test_company_account_sees_only_itself_in_the_directory(world):
    w, s = world, world["s"]
    company = _create_company(w)
    user = s.get(User, uuid.UUID(company["id"]))
    with _as(s, user, w["tenant"]) as c:
        rows = c.get("/api/v1/auth/users/lookup").json()
        me = c.get("/api/v1/auth/rbac/me").json()
        profile = c.get("/api/v1/auth/users/me").json()
    assert [r["id"] for r in rows] == [company["id"]]
    assert me["account_kind"] == "company" and me["modules"] == ["tickets"]
    assert profile["access"] == {"account_kind": "company", "modules": ["tickets"]}
    with _as(s, w["member"], w["tenant"]) as c:
        everyone = [r["id"] for r in c.get("/api/v1/auth/users/lookup").json()]
        by_id = [r["id"] for r in c.get("/api/v1/auth/users/lookup", params={"ids": [company["id"]]}).json()]
    assert company["id"] not in everyone and by_id == [company["id"]]  # ad cozumu calisir


def test_module_access_endpoints(world):
    w, s = world, world["s"]
    with _as(s, w["owner"], w["tenant"]) as c:
        rows = c.get("/api/v1/auth/module-access").json()
        assert [r["module"] for r in rows] == list(ALL_MODULES) and all(r["everyone"] for r in rows)
        stranger = {"everyone": False, "grants": [{"type": "user", "id": str(uuid.uuid4())}]}
        assert c.put("/api/v1/auth/module-access/work", json=stranger).status_code == 422
        assert c.put("/api/v1/auth/module-access/payroll", json={"everyone": True}).status_code == 404
        ok = c.put("/api/v1/auth/module-access/work", json={
            "everyone": False, "grants": [{"type": "user", "id": str(w["member"].id)}]})
        assert ok.status_code == 200
        work = [r for r in ok.json() if r["module"] == "work"][0]
        assert work == {"module": "work", "everyone": False,
                        "grants": [{"type": "user", "id": str(w["member"].id)}]}
    with _as(s, w["member"], w["tenant"]) as c:
        assert c.get("/api/v1/auth/module-access").status_code == 403


def test_resolve_carries_modules_and_kind_with_core_groups(world, auth_http, monkeypatch):
    from app.config import get_settings

    w, s = world, world["s"]
    group = uuid.uuid4()
    access.set_policy(s, tenant_id=w["tenant"].id, module="work", everyone=False,
                      grants=[{"type": "group", "id": str(group)}], actor_id=w["owner"].id)
    s.commit()
    token = "s2s-" + "k" * 40
    monkeypatch.setattr(get_settings(), "HERMES_S2S_TOKEN_CURRENT", token)
    body = {"tenant_id": str(w["tenant"].id), "user_ids": [str(w["member"].id)],
            "group_ids": {str(w["member"].id): [str(group)]}}
    r = auth_http.post("/internal/authz/resolve", json=body, headers={"Authorization": f"Bearer {token}"})
    user = r.json()["users"][0]
    assert user["account_kind"] == "person" and "work" in user["modules"]
    assert Perm.TASKS_ACCESS in user["permissions"]

    # Grup verilmezse auth core'a sorar (S2S); hata → grup kurali sayilmaz.
    fake = MagicMock(return_value=MagicMock(status_code=200, json=lambda: {
        "users": {str(w["member"].id): [str(group)]}}))
    with patch.object(access.httpx, "post", fake):
        assert "work" in _profile(w, w["member"]).modules
    assert fake.call_args.kwargs["json"]["user_ids"] == [str(w["member"].id)]
    access.clear_group_cache()
    with patch.object(access.httpx, "post", MagicMock(side_effect=RuntimeError("down"))):
        assert "work" not in _profile(w, w["member"]).modules


def test_company_kind_travels_in_the_access_token(world, monkeypatch):
    """core sirket hesabini auth'a sormadan tanir: claim token'da."""
    from app.services.auth_service import AuthService
    from shared import auth as shared_auth
    from shared.auth import TENANT_AUDIENCE
    from tests.test_tenant_auth import _rsa_keypair

    private_pem, public_pem = _rsa_keypair()
    monkeypatch.setattr(shared_auth, "SIGNING_KEY", private_pem)
    monkeypatch.setattr(shared_auth, "VERIFY_KEY", public_pem)
    w, s = world, world["s"]
    company = _create_company(w)
    user = s.get(User, uuid.UUID(company["id"]))
    membership = s.query(TenantMembership).filter(TenantMembership.user_id == user.id).one()

    class _T:
        id = w["tenant"].id

    token = AuthService(s)._create_token_for_user(user, tenant=_T(), membership=membership, auth_method="local")
    assert shared_auth.verify_token(token, expected_audience=TENANT_AUDIENCE).account_kind == "company"
    person = s.query(TenantMembership).filter(TenantMembership.user_id == w["member"].id).one()
    token = AuthService(s)._create_token_for_user(w["member"], tenant=_T(), membership=person, auth_method="local")
    assert shared_auth.verify_token(token, expected_audience=TENANT_AUDIENCE).account_kind == "person"
