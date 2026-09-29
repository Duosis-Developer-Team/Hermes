# =============================================================================
# /users ciktilari: saklanmis e-posta toleransi + /users/lookup tenant kapsami
# =============================================================================
# Kilitlenen sozlesmeler (2026-09-29):
#   1. CIKTI semalari e-postayi yeniden dogrulamaz: `.invalid` gibi
#      special-use bir alan adi saklanmis tek bir kayit GET /users
#      listesini (ve tekil/me uclarini) 500'e dusuremez. Girdi semalari
#      (create/update) hala kati EmailStr.
#   2. GET /users/lookup YALNIZCA cagiranin mevcut tenant'inda uyeligi
#      olan kimlikleri doner; baska tenant'in kullanicisi `ids` ile acikca
#      istense bile yoktur.
#   3. include_inactive (yalnizca users.manage): bu tenant'in pasif
#      kullanicilari ve removed/suspended uyelikleri de doner (gecmis
#      adlar cozulur); `is_active` = kullanici aktif VE uyelik aktif.
# =============================================================================

import uuid

import pytest
from sqlalchemy import text

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

LOOKUP = "/api/v1/auth/users/lookup"


def _tenant(db, slug):
    tid = uuid.uuid4()
    db.execute(text(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) VALUES "
        "(:id, :slug, :slug, 'active', 'tr-TR', 'Europe/Istanbul', "
        "'shared', 'shared-default', 1, now(), now())"
    ), {"id": tid, "slug": slug})
    db.commit()
    return tid


def _user(db, tenant_id, email, *, active=True, membership="active",
          name=None):
    from app.models.tenancy import TenantMembership
    from app.models.user import User

    u = User(id=uuid.uuid4(), email=email, full_name=name or email,
             hashed_password="x", is_admin=False, is_active=active)
    db.add(u)
    db.flush()
    if tenant_id is not None:
        db.add(TenantMembership(tenant_id=tenant_id, user_id=u.id,
                                status=membership))
    db.commit()
    return u


def _grant(db, tenant_id, user, *perms):
    from app.models.rbac import RbacRole, RbacUserRole

    role = RbacRole(tenant_id=tenant_id, code=f"r-{uuid.uuid4().hex[:8]}",
                    name="Test Role", permissions=sorted(perms))
    db.add(role)
    db.flush()
    db.add(RbacUserRole(user_id=user.id, role_id=role.id,
                        tenant_id=tenant_id))
    db.commit()


@pytest.fixture()
def world(pg_session):
    db = pg_session
    db.execute(text(
        "DELETE FROM tenants WHERE slug IN ('lk-acme', 'lk-globex')"
    ))
    db.commit()
    acme = _tenant(db, "lk-acme")
    globex = _tenant(db, "lk-globex")
    w = {
        "acme": acme,
        "globex": globex,
        "caller": _user(db, acme, "caller@acme.com"),
        "admin": _user(db, acme, "admin@acme.com"),
        "peer": _user(db, acme, "peer@acme.com"),
        "inactive": _user(db, acme, "old@acme.com", active=False),
        "removed": _user(db, acme, "gone@acme.com", membership="removed"),
        "outsider": _user(db, globex, "out@globex.com"),
        "orphan": _user(db, None, "nobody@nowhere.com"),
    }
    _grant(db, acme, w["admin"], Perm.USERS_MANAGE)
    yield w
    db.rollback()
    db.execute(text(
        "DELETE FROM tenants WHERE slug IN ('lk-acme', 'lk-globex')"
    ))
    db.commit()


@pytest.fixture()
def as_user(auth_http):
    from app.main import app

    def _set(user, tenant_id):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user.id), email=user.email, tenant_id=str(tenant_id),
        )
        return auth_http

    yield _set
    app.dependency_overrides.pop(get_current_user, None)


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return {row["id"] for row in resp.json()}


# -----------------------------------------------------------------------------
# 1) Tenant kapsami
# -----------------------------------------------------------------------------

def test_lookup_returns_only_active_members_of_current_tenant(as_user, world):
    w = world
    got = _ids(as_user(w["caller"], w["acme"]).get(LOOKUP))
    assert got == {str(w["caller"].id), str(w["admin"].id),
                   str(w["peer"].id)}
    # Baska tenant'in uyesi ve hic uyeligi olmayan kimlik YOK.
    assert str(w["outsider"].id) not in got
    assert str(w["orphan"].id) not in got


def test_lookup_ids_filter_cannot_reach_other_tenants(as_user, world):
    w = world
    client = as_user(w["caller"], w["acme"])
    r = client.get(LOOKUP, params=[
        ("ids", str(w["peer"].id)),
        ("ids", str(w["outsider"].id)),
        ("ids", str(w["orphan"].id)),
    ])
    assert _ids(r) == {str(w["peer"].id)}

    only_outsider = client.get(LOOKUP, params={"ids": str(w["outsider"].id)})
    assert only_outsider.json() == []


def test_lookup_is_symmetric_for_the_other_tenant(as_user, world):
    w = world
    got = _ids(as_user(w["outsider"], w["globex"]).get(LOOKUP))
    assert got == {str(w["outsider"].id)}


def test_include_inactive_without_users_manage_is_ignored(as_user, world):
    w = world
    got = _ids(as_user(w["caller"], w["acme"]).get(
        LOOKUP, params={"include_inactive": "true"}))
    assert str(w["inactive"].id) not in got
    assert str(w["removed"].id) not in got


def test_include_inactive_with_users_manage_resolves_history(as_user, world):
    w = world
    r = as_user(w["admin"], w["acme"]).get(
        LOOKUP, params={"include_inactive": "true"})
    got = _ids(r)
    assert got == {str(w["caller"].id), str(w["admin"].id),
                   str(w["peer"].id), str(w["inactive"].id),
                   str(w["removed"].id)}
    assert str(w["outsider"].id) not in got
    rows = {row["id"]: row for row in r.json()}
    assert rows[str(w["peer"].id)]["is_active"] is True
    assert rows[str(w["inactive"].id)]["is_active"] is False
    # Global olarak aktif ama bu tenant'tan cikarilmis -> burada pasif.
    assert rows[str(w["removed"].id)]["is_active"] is False

    # ids ile de gecmis ad cozulur; baska tenant yine erisilemez.
    r2 = as_user(w["admin"], w["acme"]).get(LOOKUP, params=[
        ("include_inactive", "true"),
        ("ids", str(w["removed"].id)),
        ("ids", str(w["outsider"].id)),
    ])
    assert _ids(r2) == {str(w["removed"].id)}


def test_lookup_with_malformed_tenant_fails_closed(auth_http, world):
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(world["caller"].id), email="caller@acme.com",
        tenant_id="not-a-uuid",
    )
    try:
        r = auth_http.get(LOOKUP)
        assert r.status_code == 200 and r.json() == []
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# -----------------------------------------------------------------------------
# 2) Saklanmis e-posta toleransi (hermes-dev 500 regresyonu)
# -----------------------------------------------------------------------------

BAD_EMAIL = "ada.lovelace@demo.duosis.invalid"


def test_users_list_tolerates_special_use_email(as_user, world, pg_session):
    w = world
    odd = _user(pg_session, w["acme"], BAD_EMAIL, name="Ada Lovelace")
    client = as_user(w["admin"], w["acme"])

    r = client.get("/api/v1/auth/users")
    assert r.status_code == 200, r.text
    emails = {row["email"] for row in r.json()["data"]}
    assert BAD_EMAIL in emails and "peer@acme.com" in emails

    one = client.get(f"/api/v1/auth/users/{odd.id}")
    assert one.status_code == 200 and one.json()["email"] == BAD_EMAIL

    assert BAD_EMAIL in {
        row["email"] for row in client.get(LOOKUP).json()
    }

    me = as_user(odd, w["acme"]).get("/api/v1/auth/users/me")
    assert me.status_code == 200 and me.json()["email"] == BAD_EMAIL


def test_input_schemas_stay_strict():
    from pydantic import ValidationError

    from app.schemas.user import UserCreate, UserUpdate

    with pytest.raises(ValidationError):
        UserCreate(email="not-an-email", password="secret123")
    with pytest.raises(ValidationError):
        UserUpdate(email=BAD_EMAIL)
    assert UserCreate(email="new@example.com", password="secret123")
