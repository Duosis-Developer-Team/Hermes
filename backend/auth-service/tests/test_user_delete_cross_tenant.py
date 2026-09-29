# =============================================================================
# DELETE + PUT /users/{id} — baska tenant verisini ASLA bozmaz (2026-09-29)
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. Hedefin BASKA tenant'larda uyeligi varsa: yalnizca cagiranin
#      tenant'indaki uyelik 'removed' yapilir ve bu tenant'in rol atamalari
#      silinir. Global `users` satiri, diger uyelikler ve diger tenant'in
#      rolleri DOKUNULMADAN kalir; kullanici diger tenant'a giris yapabilir.
#   2. 'removed' uyelik, alan adi otomatik katilimiyla DIRILMEZ (giris 401,
#      500 degil).
#   3. Cagiranin tenant'i SON uyelikse eski davranis (hard delete) aynen.
#   4. Son-admin kilidi (409) iki yolda da gecerli.
# =============================================================================

import uuid

import pytest
from sqlalchemy import text

from shared.auth import hash_password
from shared.permissions import Perm

from .test_users_lookup_scope import _grant, _tenant, _user, as_user  # noqa: F401

USERS = "/api/v1/auth/users"
PASSWORD = "guvenli123"


@pytest.fixture()
def signing(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from shared import auth as shared_auth

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(shared_auth, "SIGNING_KEY", key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode())
    monkeypatch.setattr(shared_auth, "VERIFY_KEY", key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode())
    return shared_auth


def _admin_role(db, tenant_id):
    from app.models.rbac import RbacRole

    role = RbacRole(tenant_id=tenant_id, code="system-admin",
                    name="System Administrator", permissions=[],
                    is_system=True, is_active=True)
    db.add(role)
    db.commit()
    return role


def _assign(db, tenant_id, user, role):
    from app.models.rbac import RbacUserRole

    db.add(RbacUserRole(user_id=user.id, role_id=role.id,
                        tenant_id=tenant_id))
    db.commit()


def _login(db, tenant_id, email):
    from app.models.tenancy import Tenant
    from app.services.auth_service import AuthService
    from app.services.tenant_resolver import ResolvedTenant

    t = db.get(Tenant, tenant_id)
    return AuthService(db).authenticate(
        email=email, password=PASSWORD,
        tenant=ResolvedTenant(id=str(t.id), slug=t.slug,
                              display_name=t.display_name, status=t.status),
    )


@pytest.fixture()
def two(pg_session):
    """A ve B tenant'lari; B'de users.manage tasiyan (admin OLMAYAN)
    bir yonetici; B'de system-admin rolu."""
    from app.models.tenancy import TenantIdentityProvider, TenantMembership

    db = pg_session
    db.execute(text("DELETE FROM tenants WHERE slug IN ('del-a', 'del-b')"))
    db.commit()
    a = _tenant(db, "del-a")
    b = _tenant(db, "del-b")
    # B, multi.com alan adina otomatik katilima ACIK: removed uyelik
    # dirilmemeli.
    db.add(TenantIdentityProvider(
        tenant_id=b, provider="email-domain", is_active=True,
        auto_provision_mode="auto", allowed_email_domains=["multi.com"],
    ))
    db.commit()

    multi = _user(db, a, "m@multi.com")
    multi.hashed_password = hash_password(PASSWORD)
    db.add(TenantMembership(tenant_id=b, user_id=multi.id, status="active"))
    db.commit()

    manager = _user(db, b, "manager@b.com")
    _grant(db, b, manager, Perm.USERS_MANAGE)
    _grant(db, a, multi, Perm.REPORTS_VIEW)       # A'daki rol KALMALI
    _grant(db, b, multi, Perm.CUSTOMERS_MANAGE)   # B'deki rol GITMELI
    yield {"a": a, "b": b, "multi": multi, "manager": manager,
           "admin_role_b": _admin_role(db, b)}
    db.rollback()
    db.execute(text("DELETE FROM tenants WHERE slug IN ('del-a', 'del-b')"))
    db.commit()


def _membership(db, tenant_id, user_id):
    from app.models.tenancy import TenantMembership

    db.expire_all()
    return db.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant_id,
        TenantMembership.user_id == user_id,
    ).first()


def _role_rows(db, tenant_id, user_id):
    from app.models.rbac import RbacUserRole

    return db.query(RbacUserRole).filter(
        RbacUserRole.tenant_id == tenant_id,
        RbacUserRole.user_id == user_id,
    ).count()


def test_multi_tenant_user_is_only_removed_from_callers_tenant(
    as_user, two, pg_session, signing
):
    from app.models.user import User
    from app.services.rbac_service import effective_permissions
    from shared.exceptions import UnauthorizedError

    w, db = two, pg_session
    m = w["multi"]
    assert _login(db, w["b"], "m@multi.com").access_token  # once B'ye girebiliyor

    client = as_user(w["manager"], w["b"])
    r = client.delete(f"{USERS}/{m.id}")
    assert r.status_code == 204, r.text

    # Global kimlik ve A uyeligi/rolleri DOKUNULMADI.
    db.expire_all()
    user = db.get(User, m.id)
    assert user is not None and user.is_active
    assert _membership(db, w["a"], m.id).status == "active"
    assert _role_rows(db, w["a"], m.id) == 1
    assert effective_permissions(db, m.id, tenant_id=w["a"]) == frozenset(
        {Perm.REPORTS_VIEW})
    # B: uyelik 'removed', rol atamalari yok, izin yok.
    assert _membership(db, w["b"], m.id).status == "removed"
    assert _role_rows(db, w["b"], m.id) == 0
    assert effective_permissions(db, m.id, tenant_id=w["b"]) == frozenset()

    # A'ya giris calisir; B'ye giris 401 (otomatik katilim diriltmez, 500 yok).
    assert _login(db, w["a"], "m@multi.com").access_token
    with pytest.raises(UnauthorizedError):
        _login(db, w["b"], "m@multi.com")
    assert _membership(db, w["b"], m.id).status == "removed"

    # B'nin varsayilan listesinden duser; gecmis ad cozumu calisir.
    listed = {u["id"] for u in client.get(USERS).json()["data"]}
    assert str(m.id) not in listed
    # Tekrar silmek idempotent (yine global satira dokunmaz).
    assert client.delete(f"{USERS}/{m.id}").status_code == 204
    db.expire_all()
    assert db.get(User, m.id) is not None
    assert _membership(db, w["a"], m.id).status == "active"


def test_single_tenant_user_keeps_old_hard_delete(as_user, two, pg_session):
    from app.models.user import User

    w, db = two, pg_session
    solo = _user(db, w["b"], "solo@b.com")
    r = as_user(w["manager"], w["b"]).delete(f"{USERS}/{solo.id}")
    assert r.status_code == 204, r.text
    db.expire_all()
    assert db.get(User, solo.id) is None


def test_last_admin_guard_on_membership_removal(as_user, two, pg_session):
    """B'nin TEK system-admini baska tenant'ta da uye olsa bile B'den
    cikarilamaz — B adminsiz kalirdi."""
    w, db = two, pg_session
    m = w["multi"]
    _assign(db, w["b"], m, w["admin_role_b"])

    r = as_user(w["manager"], w["b"]).delete(f"{USERS}/{m.id}")
    assert r.status_code == 409, r.text
    assert _membership(db, w["b"], m.id).status == "active"
    assert _role_rows(db, w["b"], m.id) == 2

    # Ikinci bir admin varsa cikarma serbest.
    other_admin = _user(db, w["b"], "admin2@b.com")
    _assign(db, w["b"], other_admin, w["admin_role_b"])
    r2 = as_user(w["manager"], w["b"]).delete(f"{USERS}/{m.id}")
    assert r2.status_code == 204, r2.text
    assert _membership(db, w["b"], m.id).status == "removed"


def test_last_admin_guard_on_hard_delete_still_enforced(
    as_user, two, pg_session
):
    from app.models.user import User

    w, db = two, pg_session
    solo_admin = _user(db, w["b"], "boss@b.com")
    _assign(db, w["b"], solo_admin, w["admin_role_b"])
    r = as_user(w["manager"], w["b"]).delete(f"{USERS}/{solo_admin.id}")
    assert r.status_code == 409, r.text
    db.expire_all()
    assert db.get(User, solo_admin.id) is not None


# =============================================================================
# PUT /users/{id} — cok tenant'li kullanicinin global satiri korunur
# =============================================================================
#   5. is_active -> yalnizca bu tenant'taki uyelik ('suspended'/'active');
#      global bayrak degismez; yanittaki is_active tenant gorunumudur.
#   6. e-posta/parola/ad DEGISIKLIGI -> 409; ayni degerin geri gonderilmesi
#      (form gidis-donusu) sorun degil. Tek tenant'li kullanici: eskisi gibi.
#   7. Son-admin kilidi pasiflestirmede de gecerli (409).

MULTI_409 = (
    "This user belongs to other workspaces; profile and credentials can "
    "only be changed by the user or a platform administrator."
)


def test_archive_in_b_keeps_user_active_in_a_and_unarchive_restores(
    as_user, two, pg_session, signing
):
    from app.models.user import User
    from shared.exceptions import UnauthorizedError

    w, db = two, pg_session
    m = w["multi"]
    client = as_user(w["manager"], w["b"])

    r = client.put(f"{USERS}/{m.id}", json={"is_active": False})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False

    db.expire_all()
    assert db.get(User, m.id).is_active is True          # global dokunulmadi
    assert _membership(db, w["a"], m.id).status == "active"
    assert _membership(db, w["b"], m.id).status == "suspended"
    assert _role_rows(db, w["b"], m.id) == 1              # roller korunur

    assert _login(db, w["a"], "m@multi.com").access_token
    with pytest.raises(UnauthorizedError):
        _login(db, w["b"], "m@multi.com")

    # B'nin admin ekrani onu PASIF gorur (liste + detay).
    assert str(m.id) not in {u["id"] for u in client.get(USERS).json()["data"]}
    rows = {u["id"]: u for u in client.get(
        USERS, params={"include_inactive": "true"}).json()["data"]}
    assert rows[str(m.id)]["is_active"] is False
    assert client.get(f"{USERS}/{m.id}").json()["is_active"] is False

    back = client.put(f"{USERS}/{m.id}", json={"is_active": True})
    assert back.status_code == 200, back.text
    assert back.json()["is_active"] is True
    assert _membership(db, w["b"], m.id).status == "active"
    assert _login(db, w["b"], "m@multi.com").access_token


@pytest.mark.parametrize("payload", [
    {"email": "new@multi.com"},
    {"password": "baskasifre1"},
    {"full_name": "Yeni Ad"},
])
def test_profile_change_on_multi_tenant_user_is_409(
    as_user, two, pg_session, payload
):
    from app.models.user import User

    w, db = two, pg_session
    m = w["multi"]
    r = as_user(w["manager"], w["b"]).put(f"{USERS}/{m.id}", json=payload)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == MULTI_409
    db.expire_all()
    u = db.get(User, m.id)
    assert u.email == "m@multi.com" and u.full_name == "m@multi.com"


def test_form_round_trip_on_multi_tenant_user_is_ok(as_user, two):
    """Duzenleme formu ayni e-posta/adi geri gonderir — 409 OLMAMALI."""
    w = two
    m = w["multi"]
    r = as_user(w["manager"], w["b"]).put(f"{USERS}/{m.id}", json={
        "email": "M@multi.com", "full_name": "m@multi.com",
        "is_active": True,
    })
    assert r.status_code == 200, r.text


def test_single_tenant_user_profile_and_archive_unchanged(
    as_user, two, pg_session
):
    from app.models.user import User
    from shared.auth import verify_password

    w, db = two, pg_session
    solo = _user(db, w["b"], "solo@b.com")
    client = as_user(w["manager"], w["b"])
    r = client.put(f"{USERS}/{solo.id}", json={
        "email": "solo2@b.com", "full_name": "Solo", "password": "yenisifre1",
    })
    assert r.status_code == 200, r.text
    db.expire_all()
    u = db.get(User, solo.id)
    assert u.email == "solo2@b.com" and u.full_name == "Solo"
    assert verify_password("yenisifre1", u.hashed_password)

    off = client.put(f"{USERS}/{solo.id}", json={"is_active": False})
    assert off.status_code == 200 and off.json()["is_active"] is False
    db.expire_all()
    assert db.get(User, solo.id).is_active is False       # eski davranis
    assert _membership(db, w["b"], solo.id).status == "active"


def test_last_admin_guard_on_deactivation(as_user, two, pg_session):
    w, db = two, pg_session
    m = w["multi"]
    _assign(db, w["b"], m, w["admin_role_b"])
    client = as_user(w["manager"], w["b"])
    r = client.put(f"{USERS}/{m.id}", json={"is_active": False})
    assert r.status_code == 409, r.text
    assert _membership(db, w["b"], m.id).status == "active"

    solo_admin = _user(db, w["b"], "boss@b.com")
    _assign(db, w["b"], solo_admin, w["admin_role_b"])
    # Iki admin var: biri pasiflestirilebilir ...
    assert client.put(f"{USERS}/{m.id}",
                      json={"is_active": False}).status_code == 200
    # ... ama uyeligi askida olan admin SAYILMAZ: kalan tek aktif admin
    # pasiflestirilemez.
    r2 = client.put(f"{USERS}/{solo_admin.id}", json={"is_active": False})
    assert r2.status_code == 409, r2.text
