# =============================================================================
# auth-service tests - RBAC R1 (katalog, bootstrap, rol CRUD, atamalar,
# S2S authz resolve, legacy is_admin koprusu)
# =============================================================================
# Kimlik: get_current_user dependency override ile sentezlenir (RS256
# imzalamak yerine — core testlerindeki public_http deseniyle ayni).
# KRITIK dogrulama: RBAC kararlari JWT claim'ine ASLA bakmaz — is_admin
# claim'i True olan ama rolu olmayan kullanici 403 alir (fail-open
# fallback yasak; eski G4 dersinin kilidi).
# =============================================================================

import uuid

import pytest
from fastapi.testclient import TestClient

from shared.auth import CurrentUser, get_current_user
from shared.permissions import ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, Perm

# WS3: CurrentUser artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

BASE = "/api/v1/auth/rbac"


# ── Yardimcilar ────────────────────────────────────────────────────────


def ensure_tenant(db):
    """Test tenant'ini garanti eder (idempotent).

    WS3: RBAC cozumu artik (tenant, uyelik) uzerinden gecer; tenant
    satiri olmadan hicbir izin cozulmez.
    """
    from sqlalchemy import text as _t

    db.execute(_t(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) VALUES "
        "(CAST(:id AS uuid), 'test-tenant', 'Test Tenant', 'active', "
        "'tr-TR', 'Europe/Istanbul', 'shared', 'shared-default', 1, "
        "now(), now()) ON CONFLICT (id) DO NOTHING"
    ), {"id": TEST_TENANT_ID})
    db.commit()


def mk_user(db, *, email=None, is_admin=False, active=True):
    from app.models.tenancy import TenantMembership
    from app.models.user import User

    ensure_tenant(db)
    u = User(
        id=uuid.uuid4(),
        email=email or f"u-{uuid.uuid4().hex[:8]}@x.com",
        full_name="Test User",
        hashed_password="x",
        is_admin=is_admin,
        is_active=active,
    )
    db.add(u)
    db.flush()
    # Aktif uyelik: pasif kullanicinin uyeligi de 'active' birakilir ki
    # "pasif kullanici -> bos izin" kuralini uyelik degil KULLANICI
    # durumunun sagladigi test edilebilsin.
    db.add(TenantMembership(
        tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id, status="active",
    ))
    db.commit()
    return u


def run_bootstrap(db):
    from app.services.rbac_service import bootstrap_tenant

    ensure_tenant(db)
    bootstrap_tenant(db, tenant_id=uuid.UUID(TEST_TENANT_ID))
    db.commit()


@pytest.fixture()
def rbac_http(pg_session):
    from app.database import get_db
    from app.main import app
    from app.routers import internal_directory

    internal_directory._fail_counts.clear()
    holder = {"user": None}
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    client = TestClient(app, raise_server_exceptions=False)
    client.as_user = lambda u: holder.__setitem__(
        "user",
        CurrentUser(id=str(u.id), email=u.email, is_admin=u.is_admin, tenant_id=TEST_TENANT_ID),
    )
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def grant_role(db, user, *perms, code=None):
    """Test rolu yarat ve kullaniciya ata."""
    from app.models.rbac import RbacRole, RbacUserRole

    role = RbacRole(
        tenant_id=uuid.UUID(TEST_TENANT_ID),
        code=code or f"r-{uuid.uuid4().hex[:8]}",
        name="Test Role",
        permissions=sorted(perms),
    )
    db.add(role)
    db.flush()
    db.add(RbacUserRole(
        user_id=user.id, role_id=role.id,
        tenant_id=uuid.UUID(TEST_TENANT_ID),
    ))
    db.commit()
    return role


# ── Katalog kilitleri ──────────────────────────────────────────────────


def test_catalog_all_is_derived_not_manual():
    """ALL, Perm sinifindan turetilir — LogiSlot'un manuel-ALL drift'i
    yapisal olarak imkansiz."""
    expected = sorted(
        v
        for k, v in vars(Perm).items()
        if not k.startswith("_") and isinstance(v, str)
    )
    assert list(ALL_PERMISSIONS) == expected
    assert len(ALL_PERMISSIONS) == len(set(ALL_PERMISSIONS))


def test_catalog_descriptions_complete_and_naming_locked():
    import re

    pattern = re.compile(r"^[a-z]+(\.[a-z_]+)+$")
    for code in ALL_PERMISSIONS:
        assert pattern.match(code), code
        assert ":" not in code  # public API scope ayraciyla karismaz
        assert PERMISSION_DESCRIPTIONS.get(code, "").strip(), code
    # Aciklama sozlugunde katalog disi anahtar da olamaz.
    assert set(PERMISSION_DESCRIPTIONS) == set(ALL_PERMISSIONS)


# ── Bootstrap ──────────────────────────────────────────────────────────


def test_bootstrap_creates_roles_and_migrates_admins(pg_session):
    from app.services import rbac_service as svc

    admin_u = mk_user(pg_session, is_admin=True)
    plain_u = mk_user(pg_session)
    run_bootstrap(pg_session)

    admin_role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))
    assert admin_role is not None
    assert admin_role.is_system and admin_role.is_active
    assert sorted(admin_role.permissions) == list(ALL_PERMISSIONS)
    assert svc.get_role_by_code(pg_session, svc.MEMBER_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID)) is not None

    assert svc.effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=admin_u.id) == frozenset(
        ALL_PERMISSIONS
    )
    assert svc.effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=plain_u.id) == frozenset()


def test_bootstrap_is_idempotent(pg_session):
    from app.models.rbac import RbacRole, RbacUserRole

    mk_user(pg_session, is_admin=True)
    run_bootstrap(pg_session)
    roles_before = pg_session.query(RbacRole).count()
    links_before = pg_session.query(RbacUserRole).count()
    run_bootstrap(pg_session)
    assert pg_session.query(RbacRole).count() == roles_before
    assert pg_session.query(RbacUserRole).count() == links_before


def test_bootstrap_syncs_catalog_additions_to_system_admin(pg_session):
    """Kataloga eklenen izin, elle migration YAZILMADAN bir sonraki
    startup'ta system-admin'e yayilir (LogiSlot aebbb08f3bd8 dersi)."""
    from app.services import rbac_service as svc

    run_bootstrap(pg_session)
    role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))
    role.permissions = [p for p in role.permissions if p != Perm.API_MANAGE]
    pg_session.commit()

    run_bootstrap(pg_session)
    role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))
    assert Perm.API_MANAGE in role.permissions


def test_bootstrap_derives_is_admin_from_role(pg_session):
    """Rolu olmayan ama is_admin=True kalmis kullanici bootstrap'te rol
    ALIR (gecis); rol atamasi kaldirilinca sutun False'a iner."""
    from app.services import rbac_service as svc
    from app.models.rbac import RbacUserRole

    u = mk_user(pg_session, is_admin=True)
    other_admin = mk_user(pg_session, is_admin=True)
    run_bootstrap(pg_session)

    role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.query(RbacUserRole).filter(
        RbacUserRole.user_id == u.id,
        RbacUserRole.role_id == role.id,
    ).delete()
    pg_session.commit()
    svc.sync_is_admin(pg_session, u.id, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.commit()
    pg_session.refresh(u)
    assert u.is_admin is False
    pg_session.refresh(other_admin)
    assert other_admin.is_admin is True


# ── Efektif izin cozumu ────────────────────────────────────────────────


def test_effective_permissions_is_union_of_active_roles(pg_session):
    from app.services.rbac_service import effective_permissions

    u = mk_user(pg_session)
    grant_role(pg_session, u, Perm.REPORTS_VIEW)
    grant_role(pg_session, u, Perm.CUSTOMERS_MANAGE, Perm.REPORTS_VIEW)
    assert effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset(
        {Perm.REPORTS_VIEW, Perm.CUSTOMERS_MANAGE}
    )


def test_inactive_role_grants_nothing(pg_session):
    """LogiSlot'un en somut sessiz hatasinin kilidi: pasif rolun
    izinleri CALISMAZ (orada calisiyordu)."""
    from app.services.rbac_service import effective_permissions

    u = mk_user(pg_session)
    role = grant_role(pg_session, u, Perm.REPORTS_VIEW)
    assert Perm.REPORTS_VIEW in effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id)
    role.is_active = False
    pg_session.commit()
    assert effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset()


def test_inactive_user_has_no_permissions(pg_session):
    from app.services.rbac_service import effective_permissions

    u = mk_user(pg_session, active=False)
    grant_role(pg_session, u, Perm.REPORTS_VIEW)
    assert effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset()


def test_unknown_permission_codes_are_filtered(pg_session):
    """Katalogdan cikarilmis/bozuk kod rolde kayitli kalsa bile efektif
    hesapta olmez — olu izin sessizce yasayamaz."""
    from app.models.rbac import RbacRole, RbacUserRole
    from app.services.rbac_service import effective_permissions

    u = mk_user(pg_session)
    role = RbacRole(
        tenant_id=uuid.UUID(TEST_TENANT_ID),
        code="stale", name="Stale",
        permissions=[Perm.REPORTS_VIEW, "ghost.permission"],
    )
    pg_session.add(role)
    pg_session.flush()
    pg_session.add(RbacUserRole(user_id=u.id, role_id=role.id, tenant_id=uuid.UUID(TEST_TENANT_ID)))
    pg_session.commit()
    assert effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset(
        {Perm.REPORTS_VIEW}
    )


def test_unknown_user_resolves_empty(pg_session):
    from app.services.rbac_service import effective_permissions

    assert effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=uuid.uuid4()) == frozenset()


# ── Guard'lar: claim degil DB ──────────────────────────────────────────


def test_admin_claim_without_role_is_rejected(rbac_http, pg_session):
    """is_admin=True CLAIM'i tasiyan ama rolu olmayan kullanici 403 —
    RBAC hicbir kararinda JWT claim'ine bakmaz (fail-open yasak)."""
    u = mk_user(pg_session, is_admin=True)  # claim True, rol YOK
    rbac_http.as_user(u)
    r = rbac_http.get(f"{BASE}/roles")
    assert r.status_code == 403


def test_permission_grants_access_regardless_of_claim(
    rbac_http, pg_session
):
    u = mk_user(pg_session, is_admin=False)  # claim False, rol VAR
    grant_role(pg_session, u, Perm.ROLES_MANAGE)
    rbac_http.as_user(u)
    r = rbac_http.get(f"{BASE}/roles")
    assert r.status_code == 200


def test_users_router_now_permission_based(rbac_http, pg_session):
    """auth'un kullanici yonetimi artik users.manage ister; rolu olmayan
    admin-claim'li kullanici reddedilir."""
    claim_only = mk_user(pg_session, is_admin=True)
    rbac_http.as_user(claim_only)
    assert rbac_http.get("/api/v1/auth/users").status_code == 403

    managed = mk_user(pg_session)
    grant_role(pg_session, managed, Perm.USERS_MANAGE)
    rbac_http.as_user(managed)
    assert rbac_http.get("/api/v1/auth/users").status_code == 200


# ── Rol CRUD ───────────────────────────────────────────────────────────


@pytest.fixture()
def role_admin(rbac_http, pg_session):
    """roles.manage + users.manage tasiyan aktor (system-admin DEGIL —
    subset kurali testleri icin sinirli)."""
    u = mk_user(pg_session)
    grant_role(
        pg_session, u, Perm.ROLES_MANAGE, Perm.USERS_MANAGE,
        Perm.REPORTS_VIEW,
    )
    rbac_http.as_user(u)
    return u


def test_role_create_and_fetch(rbac_http, pg_session, role_admin):
    r = rbac_http.post(
        f"{BASE}/roles",
        json={
            "code": "report-viewer",
            "name": "Report Viewer",
            "permissions": [Perm.REPORTS_VIEW],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["code"] == "report-viewer"
    assert body["permissions"] == [Perm.REPORTS_VIEW]
    assert body["is_system"] is False

    dup = rbac_http.post(
        f"{BASE}/roles",
        json={"code": "report-viewer", "name": "X", "permissions": []},
    )
    assert dup.status_code == 409


def test_role_create_validations(rbac_http, role_admin):
    bad_code = rbac_http.post(
        f"{BASE}/roles",
        json={"code": "Bad Code!", "name": "X", "permissions": []},
    )
    assert bad_code.status_code == 422

    unknown = rbac_http.post(
        f"{BASE}/roles",
        json={"code": "xx-role", "name": "X",
              "permissions": ["no.such.permission"]},
    )
    assert unknown.status_code == 422
    assert "no.such.permission" in unknown.text


def test_self_escalation_blocked_on_create(rbac_http, role_admin):
    """SUBSET KURALI (LogiSlot'ta yoktu): aktor sahip olmadigi izni
    icine koyan rol yaratamaz → user.manage sahibi kendini full-admin
    yapamaz."""
    r = rbac_http.post(
        f"{BASE}/roles",
        json={
            "code": "sneaky-admin",
            "name": "Sneaky",
            "permissions": [Perm.API_MANAGE],  # aktorde YOK
        },
    )
    assert r.status_code == 403
    assert Perm.API_MANAGE in r.text


def test_self_escalation_blocked_on_patch_add(
    rbac_http, pg_session, role_admin
):
    created = rbac_http.post(
        f"{BASE}/roles",
        json={"code": "grow-role", "name": "G",
              "permissions": [Perm.REPORTS_VIEW]},
    ).json()
    r = rbac_http.patch(
        f"{BASE}/roles/{created['id']}",
        json={"permissions": [Perm.REPORTS_VIEW, Perm.API_MANAGE]},
    )
    assert r.status_code == 403


def test_system_role_locked(rbac_http, pg_session, role_admin):
    run_bootstrap(pg_session)
    from app.services import rbac_service as svc

    role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))

    for payload in (
        {"name": "Renamed"},
        {"permissions": []},
        {"is_active": False},
    ):
        r = rbac_http.patch(f"{BASE}/roles/{role.id}", json=payload)
        assert r.status_code == 409, payload

    assert (
        rbac_http.delete(f"{BASE}/roles/{role.id}").status_code == 409
    )
    # Aciklama duzenlenebilir (tek serbest alan).
    ok = rbac_http.patch(
        f"{BASE}/roles/{role.id}", json={"description": "updated"}
    )
    assert ok.status_code == 200


def test_soft_deleted_role_stops_granting(
    rbac_http, pg_session, role_admin
):
    from app.services.rbac_service import effective_permissions

    u = mk_user(pg_session)
    role = grant_role(pg_session, u, Perm.REPORTS_VIEW, code="temp-role")
    assert Perm.REPORTS_VIEW in effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id)

    r = rbac_http.delete(f"{BASE}/roles/{role.id}")
    assert r.status_code == 200
    assert effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset()


# ── Atamalar ───────────────────────────────────────────────────────────


def test_put_user_roles_replaces_set(rbac_http, pg_session, role_admin):
    target = mk_user(pg_session)
    r1 = rbac_http.post(
        f"{BASE}/roles",
        json={"code": "viewer-a", "name": "A",
              "permissions": [Perm.REPORTS_VIEW]},
    ).json()

    put1 = rbac_http.put(
        f"{BASE}/users/{target.id}/roles",
        json={"role_ids": [r1["id"]]},
    )
    assert put1.status_code == 200
    assert put1.json()["effective_permissions"] == [Perm.REPORTS_VIEW]

    put2 = rbac_http.put(
        f"{BASE}/users/{target.id}/roles", json={"role_ids": []}
    )
    assert put2.status_code == 200
    assert put2.json()["effective_permissions"] == []


def test_assignment_subset_rule(rbac_http, pg_session, role_admin):
    """Aktor, kendinde olmayan izni TASIYAN rolu baskasina atayamaz."""
    from app.models.rbac import RbacRole

    strong = RbacRole(
        tenant_id=uuid.UUID(TEST_TENANT_ID),
        code="strong", name="Strong", permissions=[Perm.API_MANAGE]
    )
    pg_session.add(strong)
    pg_session.commit()

    target = mk_user(pg_session)
    r = rbac_http.put(
        f"{BASE}/users/{target.id}/roles",
        json={"role_ids": [str(strong.id)]},
    )
    assert r.status_code == 403


def test_inactive_role_not_assignable(rbac_http, pg_session, role_admin):
    from app.models.rbac import RbacRole

    dead = RbacRole(
        tenant_id=uuid.UUID(TEST_TENANT_ID),
        code="dead-role", name="Dead",
        permissions=[Perm.REPORTS_VIEW], is_active=False,
    )
    pg_session.add(dead)
    pg_session.commit()
    target = mk_user(pg_session)
    r = rbac_http.put(
        f"{BASE}/users/{target.id}/roles",
        json={"role_ids": [str(dead.id)]},
    )
    assert r.status_code == 422


def test_assigning_system_admin_derives_is_admin(rbac_http, pg_session):
    run_bootstrap(pg_session)
    from app.services import rbac_service as svc

    # Aktor: bootstrap'li gercek admin (ALL izinli — subset engeli yok).
    actor = mk_user(pg_session, is_admin=True)
    run_bootstrap(pg_session)  # actor'e rol atansin
    rbac_http.as_user(actor)

    target = mk_user(pg_session)
    role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))
    r = rbac_http.put(
        f"{BASE}/users/{target.id}/roles",
        json={"role_ids": [str(role.id)]},
    )
    assert r.status_code == 200
    pg_session.refresh(target)
    assert target.is_admin is True  # sutun turetildi

    r2 = rbac_http.put(
        f"{BASE}/users/{target.id}/roles", json={"role_ids": []}
    )
    assert r2.status_code == 200
    pg_session.refresh(target)
    assert target.is_admin is False


def test_last_admin_cannot_be_stripped(rbac_http, pg_session):
    run_bootstrap(pg_session)
    from app.services import rbac_service as svc

    only_admin = mk_user(pg_session, is_admin=True)
    run_bootstrap(pg_session)
    rbac_http.as_user(only_admin)

    r = rbac_http.put(
        f"{BASE}/users/{only_admin.id}/roles", json={"role_ids": []}
    )
    assert r.status_code == 409
    assert svc.effective_permissions(
        pg_session, only_admin.id, tenant_id=uuid.UUID(TEST_TENANT_ID)
    ) == frozenset(ALL_PERMISSIONS)


def test_last_admin_cannot_be_deactivated_via_user_service(pg_session):
    from fastapi import HTTPException

    from app.services.user_service import UserService

    only_admin = mk_user(pg_session, is_admin=True)
    run_bootstrap(pg_session)

    with pytest.raises(HTTPException) as exc:
        UserService(pg_session).delete(
            only_admin.id, soft=True,
            tenant_id=uuid.UUID(TEST_TENANT_ID),
        )
    assert exc.value.status_code == 409


# ── Legacy is_admin koprusu ────────────────────────────────────────────


def test_legacy_is_admin_update_bridges_to_role(pg_session):
    from app.schemas.user import UserUpdate
    from app.services import rbac_service as svc
    from app.services.user_service import UserService

    run_bootstrap(pg_session)
    # Ikinci bir admin olsun ki son-admin kilidi devreye girmesin.
    mk_user(pg_session, is_admin=True)
    run_bootstrap(pg_session)

    u = mk_user(pg_session)
    UserService(pg_session).update(
        u.id, UserUpdate(is_admin=True),
        tenant_id=uuid.UUID(TEST_TENANT_ID),
    )
    assert svc.effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset(
        ALL_PERMISSIONS
    )

    UserService(pg_session).update(
        u.id, UserUpdate(is_admin=False),
        tenant_id=uuid.UUID(TEST_TENANT_ID),
    )
    assert svc.effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u.id) == frozenset()


# ── /rbac/me + katalog ucu ─────────────────────────────────────────────


def test_me_returns_own_permissions(rbac_http, pg_session):
    u = mk_user(pg_session)
    grant_role(pg_session, u, Perm.REPORTS_VIEW, code="my-role")
    rbac_http.as_user(u)
    r = rbac_http.get(f"{BASE}/me")
    assert r.status_code == 200
    body = r.json()
    assert body["permissions"] == [Perm.REPORTS_VIEW]
    assert body["roles"][0]["code"] == "my-role"


def test_permission_catalog_endpoint(rbac_http, pg_session, role_admin):
    r = rbac_http.get(f"{BASE}/permission-catalog")
    assert r.status_code == 200
    codes = [p["code"] for p in r.json()["permissions"]]
    assert codes == list(ALL_PERMISSIONS)
    assert all(p["description"] for p in r.json()["permissions"])


# ── S2S authz resolve ──────────────────────────────────────────────────


def test_s2s_resolve_requires_credential(rbac_http, pg_session):
    r = rbac_http.post(
        "/internal/authz/resolve",
        json={"tenant_id": TEST_TENANT_ID, "user_ids": [str(uuid.uuid4())]},
    )
    assert r.status_code == 401


def test_s2s_resolve_batch(rbac_http, pg_session):
    from .conftest import S2S_CURRENT

    u1 = mk_user(pg_session)
    grant_role(pg_session, u1, Perm.REPORTS_VIEW, Perm.TASKS_ADMIN)
    u2 = mk_user(pg_session, active=False)
    grant_role(pg_session, u2, Perm.REPORTS_VIEW)
    ghost = uuid.uuid4()

    r = rbac_http.post(
        "/internal/authz/resolve",
        headers={"Authorization": f"Bearer {S2S_CURRENT}"},
        json={"tenant_id": TEST_TENANT_ID, "user_ids": [str(u1.id), str(u2.id), str(ghost),
                           str(u1.id)]},
    )
    assert r.status_code == 200
    users = r.json()["users"]
    # Dedup: u1 bir kez.
    assert [u["id"] for u in users] == [
        str(u1.id), str(u2.id), str(ghost)
    ]
    by_id = {u["id"]: u["permissions"] for u in users}
    assert by_id[str(u1.id)] == sorted(
        [Perm.REPORTS_VIEW, Perm.TASKS_ADMIN]
    )
    assert by_id[str(u2.id)] == []  # pasif kullanici → fail-closed bos
    assert by_id[str(ghost)] == []  # bilinmeyen → bos
