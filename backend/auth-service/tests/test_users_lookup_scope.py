# =============================================================================
# /users ciktilari: saklanmis e-posta toleransi + /users/lookup tenant kapsami
# =============================================================================
# Kilitlenen sozlesmeler (2026-09-29; 4. madde ayni gun eklendi):
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
#   4. Tenant yonetim yuzeyi (GET /users, /users/options, GET/PUT/DELETE
#      /users/{id}, /rbac/roles*, /rbac/users/{id}/roles) yalnizca cagiranin
#      tenant'inin uyelerini/rollerini gorur; digerleri 404.
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


# -----------------------------------------------------------------------------
# 3) Tenant yonetim yuzeyi: /users, /users/options, /users/{id}, /rbac/*
# -----------------------------------------------------------------------------
# Kural: tenant admini yalnizca mevcut tenant'inda uyeligi olan
# kullanicilari gorur/etkiler; roller tenant'a aittir (rbac_roles.tenant_id).
# Baska tenant'in kaydi = var olmayan kayit (404, ayni yanit).

USERS = "/api/v1/auth/users"
ROLES = "/api/v1/auth/rbac/roles"


def test_users_list_is_tenant_scoped(as_user, world):
    w = world
    client = as_user(w["admin"], w["acme"])

    r = client.get(USERS)
    assert r.status_code == 200, r.text
    got = {row["id"] for row in r.json()["data"]}
    assert got == {str(w["caller"].id), str(w["admin"].id),
                   str(w["peer"].id)}
    assert r.json()["total"] == 3

    r_all = client.get(USERS, params={"include_inactive": "true"})
    got_all = {row["id"] for row in r_all.json()["data"]}
    assert got_all == got | {str(w["inactive"].id), str(w["removed"].id)}
    assert r_all.json()["total"] == 5
    assert str(w["outsider"].id) not in got_all
    assert str(w["orphan"].id) not in got_all


def test_user_options_is_tenant_scoped(as_user, world):
    w = world
    r = as_user(w["admin"], w["acme"]).get(f"{USERS}/options")
    assert r.status_code == 200, r.text
    assert {row["id"] for row in r.json()} == {
        str(w["caller"].id), str(w["admin"].id), str(w["peer"].id)
    }


def test_other_tenant_user_detail_update_delete_are_404(
    as_user, world, pg_session
):
    from app.models.user import User

    w = world
    client = as_user(w["admin"], w["acme"])
    ghost = uuid.uuid4()
    missing = client.get(f"{USERS}/{ghost}")
    assert missing.status_code == 404

    for target in (w["outsider"], w["orphan"]):
        g = client.get(f"{USERS}/{target.id}")
        assert g.status_code == 404
        # Mesaj istenen id'yi yansitir; onun disinda var olmayanla AYNI.
        assert g.json()["detail"].replace(str(target.id), "X") == \
            missing.json()["detail"].replace(str(ghost), "X")
        assert client.put(f"{USERS}/{target.id}",
                          json={"full_name": "Hacked"}).status_code == 404
        assert client.delete(f"{USERS}/{target.id}").status_code == 404

    pg_session.expire_all()
    out = pg_session.get(User, w["outsider"].id)
    assert out is not None and out.full_name == "out@globex.com"
    assert pg_session.get(User, w["orphan"].id) is not None


def test_own_tenant_user_detail_and_update_still_work(as_user, world):
    w = world
    client = as_user(w["admin"], w["acme"])
    # Pasif ve cikarilmis uyeler de bu tenant'in kaydidir: yonetilebilir.
    for target in (w["peer"], w["inactive"], w["removed"]):
        assert client.get(f"{USERS}/{target.id}").status_code == 200
    r = client.put(f"{USERS}/{w['peer'].id}", json={"full_name": "Peer X"})
    assert r.status_code == 200 and r.json()["full_name"] == "Peer X"


def test_roles_are_tenant_scoped(as_user, world, pg_session):
    from app.models.rbac import RbacRole

    w = world
    _grant(pg_session, w["acme"], w["admin"], Perm.ROLES_MANAGE,
           Perm.USERS_MANAGE)
    foreign = RbacRole(tenant_id=w["globex"], code="globex-only",
                       name="Globex Only", permissions=[])
    pg_session.add(foreign)
    pg_session.commit()

    client = as_user(w["admin"], w["acme"])
    listed = client.get(ROLES, params={"include_inactive": "true"})
    assert listed.status_code == 200, listed.text
    codes = {r["code"] for r in listed.json()["roles"]}
    assert "globex-only" not in codes
    assert codes  # acme'nin kendi test rolleri
    ids = {r["id"] for r in listed.json()["roles"]}
    assert all(
        pg_session.get(RbacRole, uuid.UUID(i)).tenant_id == w["acme"]
        for i in ids
    )

    assert client.get(f"{ROLES}/{foreign.id}").status_code == 404
    assert client.patch(f"{ROLES}/{foreign.id}",
                        json={"name": "Pwned"}).status_code == 404
    assert client.delete(f"{ROLES}/{foreign.id}").status_code == 404
    pg_session.expire_all()
    still = pg_session.get(RbacRole, foreign.id)
    assert still.name == "Globex Only" and still.is_active


def test_user_roles_endpoint_scoped_and_no_longer_500(as_user, world):
    w = world
    client = as_user(w["admin"], w["acme"])
    own = client.get(f"/api/v1/auth/rbac/users/{w['peer'].id}/roles")
    assert own.status_code == 200, own.text
    assert own.json()["user_id"] == str(w["peer"].id)
    other = client.get(f"/api/v1/auth/rbac/users/{w['outsider'].id}/roles")
    assert other.status_code == 404
