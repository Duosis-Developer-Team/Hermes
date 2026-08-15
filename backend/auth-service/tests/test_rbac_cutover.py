# =============================================================================
# auth-service - RBAC cutover testleri
# =============================================================================
# 1. Bagimlilik invariant'i YAZIM yolunda: assign izni ayni scope'un
#    access'i olmadan role yazilamaz (422) — frontend checkbox'ina
#    guvenilmez.
# 2. Bootstrap 4 komponent rolu idempotent olusturur (varsa dokunmaz).
# 3. /internal/authz/task-backfill: yalniz-ekleme, tekrar kosunca
#    duplicate uretmez, bilinmeyen kullanici/rol sayilir, S2S korumali.
# =============================================================================

import uuid

import pytest
from fastapi import HTTPException

from app.models.rbac import RbacRole, RbacUserRole
from app.models.user import User
from app.services import rbac_service as svc

from .conftest import S2S_CURRENT

# WS3: CurrentUser artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

BACKFILL = "/internal/authz/task-backfill"


# ── 1. Bagimlilik invariant'i ──────────────────────────────────────────


def test_assign_without_access_rejected_422():
    with pytest.raises(HTTPException) as e:
        svc.validate_permission_codes(["tasks.assign"])
    assert e.value.status_code == 422
    assert "tasks.assign requires tasks.access" in e.value.detail

    with pytest.raises(HTTPException) as e2:
        svc.validate_permission_codes(["issues.assign", "tasks.access"])
    assert e2.value.status_code == 422
    assert "issues.assign requires issues.access" in e2.value.detail


def test_assign_with_access_accepted():
    got = svc.validate_permission_codes(
        ["tasks.assign", "tasks.access", "issues.access", "issues.assign"]
    )
    assert got == sorted(
        ["tasks.access", "tasks.assign", "issues.access", "issues.assign"]
    )


def _ensure_tenant(s):
    """Test tenant'ini garanti eder (idempotent).

    WS3: RBAC cozumu (tenant, uyelik) uzerinden gecer.
    """
    from sqlalchemy import text as _t

    s.execute(_t(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) VALUES "
        "(CAST(:id AS uuid), 'test-tenant', 'Test Tenant', 'active', "
        "'tr-TR', 'Europe/Istanbul', 'shared', 'shared-default', 1, "
        "now(), now()) ON CONFLICT (id) DO NOTHING"
    ), {"id": TEST_TENANT_ID})
    s.commit()


def _add_membership(s, user_id):
    from app.models.tenancy import TenantMembership

    s.add(TenantMembership(
        tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=user_id,
        status="active",
    ))
    s.commit()



def test_role_create_endpoint_enforces_dependency(auth_http, pg_session,
                                                  monkeypatch):
    """Gercek rol yazim ucu da 422 doner (sadece servis degil)."""
    _ensure_tenant(pg_session)
    svc.bootstrap_tenant(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.commit()
    admin = User(
        id=uuid.uuid4(), email="admin@x.com", full_name="Admin",
        is_admin=True, is_active=True,
    )
    pg_session.add(admin)
    pg_session.commit()
    _add_membership(pg_session, admin.id)
    role = svc.get_role_by_code(pg_session, svc.SYSTEM_ADMIN_CODE, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.add(RbacUserRole(
        user_id=admin.id, role_id=role.id, tenant_id=uuid.UUID(TEST_TENANT_ID)
    ))
    pg_session.commit()

    from shared.auth import CurrentUser, get_current_user

    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(admin.id), email=admin.email, is_admin=True
    , tenant_id=TEST_TENANT_ID)
    try:
        r = auth_http.post(
            "/api/v1/auth/rbac/roles",
            json={
                "code": "broken-role",
                "name": "Broken",
                "permissions": ["tasks.assign"],
            },
        )
        assert r.status_code == 422, r.text
        assert "requires tasks.access" in r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── 2. Komponent rol bootstrap'i ───────────────────────────────────────


def test_bootstrap_creates_component_roles_idempotently(pg_session):
    _ensure_tenant(pg_session)
    svc.bootstrap_tenant(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.commit()
    codes = {
        r.code: r
        for r in pg_session.query(RbacRole)
        .filter(RbacRole.code.in_(list(svc.TASK_COMPONENT_ROLES)))
        .all()
    }
    assert set(codes) == {
        "task-access", "task-assigner", "issues-access", "issues-assigner",
    }
    assert sorted(codes["task-assigner"].permissions) == [
        "tasks.access", "tasks.assign",
    ]
    assert codes["task-access"].permissions == ["tasks.access"]
    assert not codes["task-access"].is_system

    # Idempotent + admin duzenlemesine saygi: izni degistir, tekrar kos.
    codes["task-access"].permissions = ["tasks.access", "issues.access"]
    pg_session.commit()
    _ensure_tenant(pg_session)
    svc.bootstrap_tenant(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.commit()
    again = svc.get_role_by_code(pg_session, "task-access", tenant_id=uuid.UUID(TEST_TENANT_ID))
    assert sorted(again.permissions) == ["issues.access", "tasks.access"]
    assert (
        pg_session.query(RbacRole)
        .filter(RbacRole.code == "task-access")
        .count()
        == 1
    )


# ── 3. S2S backfill ucu ────────────────────────────────────────────────


def _mk_user(s, email):
    u = User(id=uuid.uuid4(), email=email, full_name=email.split("@")[0],
             is_admin=False, is_active=True)
    s.add(u)
    s.commit()
    _add_membership(s, u.id)
    return u


def test_backfill_endpoint_is_s2s_guarded(auth_http):
    r = auth_http.post(BACKFILL, json={"assignments": []})
    assert r.status_code in (401, 403)


def test_backfill_assigns_idempotently(auth_http, pg_session):
    _ensure_tenant(pg_session)
    svc.bootstrap_tenant(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID))
    pg_session.commit()
    u1 = _mk_user(pg_session, "u1@x.com")
    u2 = _mk_user(pg_session, "u2@x.com")
    ghost = uuid.uuid4()  # DB'de olmayan kullanici

    payload = {
        "tenant_id": TEST_TENANT_ID,
        "assignments": [
            {"user_id": str(u1.id), "role_codes": ["task-assigner"]},
            {"user_id": str(u2.id),
             "role_codes": ["task-access", "issues-access"]},
            {"user_id": str(ghost), "role_codes": ["task-access"]},
            {"user_id": str(u1.id), "role_codes": ["ghost-role"]},
        ]
    }
    h = {"Authorization": f"Bearer {S2S_CURRENT}"}
    r1 = auth_http.post(BACKFILL, json=payload, headers=h)
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["assigned"] == 3
    assert b1["unknown_users"] == 1
    assert b1["unknown_roles"] == 1
    assert b1["skipped_existing"] == 0

    # Tekrar kosmak: hicbir yeni atama YOK, hepsi skipped.
    r2 = auth_http.post(BACKFILL, json=payload, headers=h)
    b2 = r2.json()
    assert b2["assigned"] == 0
    assert b2["skipped_existing"] == 3

    # Efektif izinler dogru birlesir.
    perms1 = svc.effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u1.id)
    assert {"tasks.access", "tasks.assign"} <= set(perms1)
    perms2 = svc.effective_permissions(pg_session, tenant_id=uuid.UUID(TEST_TENANT_ID), user_id=u2.id)
    assert {"tasks.access", "issues.access"} <= set(perms2)
    assert "tasks.assign" not in perms2

    # Hicbir sey silinmedi; yalnizca beklenen atamalar var.
    assert pg_session.query(RbacUserRole).count() >= 3
