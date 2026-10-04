# =============================================================================
# Kayan oturum - yenileme cerezi (1 gun / "Oturumu acik tut" 30 gun)
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. Erisim token'i KISA kalir; JWT exp ve cerez max_age TEK kaynaktan
#      (shared ACCESS_TOKEN_EXPIRE_MINUTES) gelir.
#   2. Giris (parola + Microsoft) IKI cerez yazar; yenileme cerezinin omru
#      `remember`a gore 1 / 30 gundur, yolu auth API'siyle sinirlidir.
#   3. Yenileme her cagrida CANLI kontrol eder: kullanici aktif, uyelik
#      aktif (ve ayni uyelik), tenant kullanilabilir, session_version ayni.
#      Basarisizlikta 401 + iki cerez de silinir.
#   4. Yenileme token'i erisim token'i olarak, erisim token'i yenileme
#      token'i olarak GECEMEZ.
#   5. Logout iki cerezi de siler.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from unittest.mock import patch

import pytest
from sqlalchemy import text

PASSWORD = "dogru-parola-123"
REFRESH_PATH = "/api/v1/auth/session/refresh"
DAY = 24 * 60 * 60


# =============================================================================
# Fixture'lar
# =============================================================================

@pytest.fixture()
def signing(monkeypatch):
    """shared.auth'u gercek RSA anahtariyla imzalayacak sekilde baglar."""
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


def _seed_tenant(db, *, status="active"):
    from app.services.tenant_resolver import ResolvedTenant

    tid = uuid.uuid4()
    slug = f"acme-{tid.hex[:8]}"
    db.execute(text(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) VALUES "
        "(:id, :slug, 'Acme', :status, 'tr-TR', 'Europe/Istanbul', "
        "'shared', 'shared-default', 1, now(), now())"
    ), {"id": tid, "slug": slug, "status": status})
    db.commit()
    return ResolvedTenant(
        id=str(tid), slug=slug, display_name="Acme", status=status,
    )


def _seed_member(db, tenant, *, email=None, active=True,
                 membership_status="active"):
    from app.models.tenancy import TenantMembership
    from app.models.user import User
    from shared.auth import hash_password

    user = User(
        id=uuid.uuid4(),
        email=email or f"u-{uuid.uuid4().hex[:8]}@acme.com",
        full_name="Kayan Oturum",
        hashed_password=hash_password(PASSWORD),
        is_admin=False,
        is_active=active,
    )
    db.add(user)
    db.flush()
    membership = TenantMembership(
        tenant_id=uuid.UUID(tenant.id), user_id=user.id,
        status=membership_status,
    )
    db.add(membership)
    db.commit()
    return user, membership


@pytest.fixture()
def tenant(pg_session):
    return _seed_tenant(pg_session)


@pytest.fixture()
def http(pg_session, tenant, signing):
    """Auth API istemcisi; tenant cozumu host yerine fixture'dan gelir.

    Cerezler Secure isaretlidir (DEBUG kapali) - istemci jar'i http
    uzerinden onlari geri gondermez; testler Cookie basligini ACIKCA
    kurar, boylece hangi istekte hangi cerezin gittigi net olur.
    """
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app
    from app.routers import auth as auth_router

    holder = {"tenant": tenant}
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[auth_router.tenant_context] = (
        lambda: holder["tenant"]
    )
    client = TestClient(app, raise_server_exceptions=False)
    client.holder = holder
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(auth_router.tenant_context, None)


# =============================================================================
# Yardimcilar
# =============================================================================

def _set_cookies(response):
    """Set-Cookie basliklarini {ad: Morsel} olarak cozer."""
    out = {}
    for raw in response.headers.get_list("set-cookie"):
        jar = SimpleCookie()
        jar.load(raw)
        for name, morsel in jar.items():
            out[name] = morsel
    return out


def _cookie_header(**cookies):
    return {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items())}


def _login(http, user, *, remember=None):
    data = {"username": user.email, "password": PASSWORD}
    if remember is not None:
        data["remember"] = "true" if remember else "false"
    return http.post("/api/v1/auth/token", data=data)


def _refresh(http, refresh_token):
    from shared.auth import REFRESH_TOKEN_COOKIE_NAME

    return http.post(
        REFRESH_PATH,
        headers=_cookie_header(**{REFRESH_TOKEN_COOKIE_NAME: refresh_token}),
    )


def _claims(token):
    from jose import jwt

    return jwt.get_unverified_claims(token)


def _assert_cleared(response):
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME

    cookies = _set_cookies(response)
    for name in (ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME):
        assert name in cookies, f"{name} silinmedi"
        assert cookies[name]["max-age"] == "0"
        assert cookies[name].value in ("", '""')


def _refresh_token_for(db, user, membership, tenant, *, remember=False,
                       expires_delta=None, **overrides):
    from shared.auth import create_refresh_token

    kwargs = dict(
        user_id=str(user.id), tenant_id=tenant.id,
        membership_id=str(membership.id), auth_method="local",
        session_version=int(user.session_version or 1), remember=remember,
        expires_delta=expires_delta or timedelta(days=1),
    )
    kwargs.update(overrides)
    return create_refresh_token(**kwargs)


# =============================================================================
# 1) Tek kaynak - erisim token'i omru == erisim cerezi max_age
# =============================================================================

def test_access_token_lifetime_and_cookie_share_one_source(
    http, pg_session, tenant,
):
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME, ACCESS_TOKEN_EXPIRE_MINUTES

    user, _ = _seed_member(pg_session, tenant)
    resp = _login(http, user)
    assert resp.status_code == 200, resp.text

    access = _set_cookies(resp)[ACCESS_TOKEN_COOKIE_NAME]
    assert access["max-age"] == str(ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    claims = _claims(access.value)
    assert claims["exp"] - claims["iat"] == ACCESS_TOKEN_EXPIRE_MINUTES * 60
    # Erisim token'i kisa kalir (30 gunluk erisim token'i YOK).
    assert ACCESS_TOKEN_EXPIRE_MINUTES <= 60


def test_auth_settings_no_longer_carry_a_second_lifetime():
    """Eski 1440 dk'lik ikinci deger geri gelmemeli (1 saat cikis hatasi)."""
    from app.config import Settings

    assert "JWT_EXPIRE_MINUTES" not in Settings.model_fields


# =============================================================================
# 2) Giris iki cerez yazar - remember 1 / 30 gun
# =============================================================================

@pytest.mark.parametrize("remember, days", [(None, 1), (False, 1), (True, 30)])
def test_password_login_sets_both_cookies(
    http, pg_session, tenant, remember, days,
):
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME

    user, membership = _seed_member(pg_session, tenant)
    resp = _login(http, user, remember=remember)
    assert resp.status_code == 200, resp.text
    # Token'lar govdede DONMEZ.
    assert "refresh_token" not in resp.text
    assert "access_token" not in resp.json()

    cookies = _set_cookies(resp)
    assert ACCESS_TOKEN_COOKIE_NAME in cookies
    refresh = cookies[REFRESH_TOKEN_COOKIE_NAME]
    assert refresh["max-age"] == str(days * DAY)
    assert refresh["path"] == "/api/v1/auth"
    assert refresh["httponly"] is True
    assert refresh["secure"] is True
    assert refresh["samesite"].lower() == "lax"

    claims = _claims(refresh.value)
    assert claims["typ"] == "refresh"
    assert claims["aud"] == "hermes-tenant-refresh"
    assert claims["sub"] == str(user.id)
    assert claims["tenant_id"] == tenant.id
    assert claims["membership_id"] == str(membership.id)
    assert claims["sv"] == 1
    assert claims["rmb"] is bool(remember)
    assert claims["jti"]
    assert claims["exp"] - claims["iat"] == days * DAY


def test_failed_login_sets_no_refresh_cookie(http, pg_session, tenant):
    from shared.auth import REFRESH_TOKEN_COOKIE_NAME

    user, _ = _seed_member(pg_session, tenant)
    resp = http.post("/api/v1/auth/token", data={
        "username": user.email, "password": "yanlis", "remember": "true",
    })
    assert resp.status_code == 401
    assert REFRESH_TOKEN_COOKIE_NAME not in _set_cookies(resp)


# =============================================================================
# 3) Yenileme - yeni cerezler, kayan sure
# =============================================================================

@pytest.mark.parametrize("remember, days", [(False, 1), (True, 30)])
def test_refresh_issues_new_cookies_and_slides_expiry(
    http, pg_session, tenant, remember, days, signing,
):
    from shared.auth import (
        ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME, TENANT_AUDIENCE,
    )

    user, membership = _seed_member(pg_session, tenant)
    # Suresinin bitmesine 1 saat kalmis bir yenileme token'i.
    old = _refresh_token_for(
        pg_session, user, membership, tenant, remember=remember,
        expires_delta=timedelta(hours=1),
    )
    resp = _refresh(http, old)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["user"]["id"] == str(user.id)
    assert body["tenant"]["id"] == tenant.id
    assert body["membership"]["id"] == str(membership.id)
    assert body["remember"] is remember

    cookies = _set_cookies(resp)
    new_refresh = cookies[REFRESH_TOKEN_COOKIE_NAME]
    assert new_refresh["max-age"] == str(days * DAY)
    assert new_refresh["path"] == "/api/v1/auth"
    new_claims = _claims(new_refresh.value)
    # Kayan: yeni exp, eskisinden ileride ve tam omur kadar.
    assert new_claims["exp"] > _claims(old)["exp"]
    assert new_claims["exp"] - new_claims["iat"] == days * DAY
    assert new_claims["rmb"] is remember
    assert new_claims["jti"] != _claims(old)["jti"]

    # Yeni erisim cerezi gecerli bir TENANT token'idir.
    access = cookies[ACCESS_TOKEN_COOKIE_NAME].value
    data = signing.verify_token(access, expected_audience=TENANT_AUDIENCE)
    assert data.user_id == str(user.id)
    assert data.tenant_id == tenant.id
    assert data.membership_id == str(membership.id)
    assert data.auth_method == "local"


def test_refresh_works_without_access_cookie_and_then_me_succeeds(
    http, pg_session, tenant,
):
    """Butun mesele bu: erisim cerezi dusmusken oturum geri gelir."""
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME

    user, _ = _seed_member(pg_session, tenant)
    login = _login(http, user, remember=True)
    refresh = _set_cookies(login)[REFRESH_TOKEN_COOKIE_NAME].value

    # Erisim cerezi yok -> /me 401.
    assert http.get("/api/v1/auth/users/me").status_code == 401

    resp = _refresh(http, refresh)
    assert resp.status_code == 200
    access = _set_cookies(resp)[ACCESS_TOKEN_COOKIE_NAME].value
    me = http.get(
        "/api/v1/auth/users/me",
        headers=_cookie_header(**{ACCESS_TOKEN_COOKIE_NAME: access}),
    )
    assert me.status_code == 200
    assert me.json()["id"] == str(user.id)


def test_refresh_preserves_microsoft_auth_method(http, pg_session, tenant):
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME

    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(
        pg_session, user, membership, tenant, auth_method="microsoft",
    )
    resp = _refresh(http, token)
    assert resp.status_code == 200
    access = _set_cookies(resp)[ACCESS_TOKEN_COOKIE_NAME].value
    assert _claims(access)["auth_method"] == "microsoft"


# =============================================================================
# 4) Yenileme reddi - 401 + iki cerez silinir
# =============================================================================

def test_refresh_without_cookie_is_401_and_clears(http):
    resp = http.post(REFRESH_PATH)
    assert resp.status_code == 401
    _assert_cleared(resp)


def test_refresh_rejected_for_inactive_user(http, pg_session, tenant):
    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(pg_session, user, membership, tenant)
    user.is_active = False
    pg_session.commit()

    resp = _refresh(http, token)
    assert resp.status_code == 401
    _assert_cleared(resp)


@pytest.mark.parametrize("new_status", ["suspended", "removed", "invited"])
def test_refresh_rejected_when_membership_not_active(
    http, pg_session, tenant, new_status,
):
    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(pg_session, user, membership, tenant)
    membership.status = new_status
    pg_session.commit()

    resp = _refresh(http, token)
    assert resp.status_code == 401
    _assert_cleared(resp)


def test_refresh_rejected_for_membership_in_other_tenant(
    http, pg_session, tenant,
):
    """Coklu tenant: B'deki aktif uyelik, A'nin oturumunu ayakta TUTMAZ."""
    from app.models.tenancy import TenantMembership

    other = _seed_tenant(pg_session)
    user, membership = _seed_member(pg_session, tenant)
    pg_session.add(TenantMembership(
        tenant_id=uuid.UUID(other.id), user_id=user.id, status="active",
    ))
    pg_session.commit()
    token = _refresh_token_for(pg_session, user, membership, tenant)
    membership.status = "removed"
    pg_session.commit()

    resp = _refresh(http, token)
    assert resp.status_code == 401


def test_refresh_rejected_when_membership_was_recreated(
    http, pg_session, tenant,
):
    """Uyelik silinip yeniden acildiysa ESKI oturum devam etmez."""
    from app.models.tenancy import TenantMembership

    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(pg_session, user, membership, tenant)
    pg_session.delete(membership)
    pg_session.commit()
    pg_session.add(TenantMembership(
        tenant_id=uuid.UUID(tenant.id), user_id=user.id, status="active",
    ))
    pg_session.commit()

    assert _refresh(http, token).status_code == 401


def test_refresh_rejected_when_tenant_suspended(http, pg_session, tenant):
    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(pg_session, user, membership, tenant)
    pg_session.execute(
        text("UPDATE tenants SET status = 'suspended' WHERE id = :id"),
        {"id": uuid.UUID(tenant.id)},
    )
    pg_session.commit()

    resp = _refresh(http, token)
    assert resp.status_code == 401
    _assert_cleared(resp)


def test_refresh_rejected_after_session_version_bump(
    http, pg_session, tenant,
):
    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(pg_session, user, membership, tenant)
    user.session_version = int(user.session_version or 1) + 1
    pg_session.commit()

    resp = _refresh(http, token)
    assert resp.status_code == 401
    _assert_cleared(resp)


def test_refresh_rejected_when_expired(http, pg_session, tenant):
    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(
        pg_session, user, membership, tenant,
        expires_delta=timedelta(seconds=-5),
    )
    resp = _refresh(http, token)
    assert resp.status_code == 401
    _assert_cleared(resp)


def test_refresh_rejects_forged_signature(http, pg_session, tenant):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwt

    user, membership = _seed_member(pg_session, tenant)
    real = _refresh_token_for(pg_session, user, membership, tenant)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode(
        _claims(real),
        other_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode(),
        algorithm="RS256",
    )
    assert _refresh(http, forged).status_code == 401


def test_access_token_cannot_be_used_as_refresh(http, pg_session, tenant):
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME

    user, _ = _seed_member(pg_session, tenant)
    access = _set_cookies(_login(http, user))[ACCESS_TOKEN_COOKIE_NAME].value

    resp = _refresh(http, access)
    assert resp.status_code == 401
    _assert_cleared(resp)


def test_support_session_refresh_token_is_rejected(http, pg_session, tenant):
    """Destek oturumlari yenileme almaz; uydurulsa bile gecmez."""
    user, membership = _seed_member(pg_session, tenant)
    token = _refresh_token_for(
        pg_session, user, membership, tenant, auth_method="support",
    )
    assert _refresh(http, token).status_code == 401


# =============================================================================
# 5) Yenileme token'i erisim token'i olarak GECEMEZ (paylasilan dogrulayici)
# =============================================================================

def test_refresh_token_is_rejected_by_access_verifier(
    http, pg_session, tenant, signing,
):
    from shared.auth import (
        ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME, TENANT_AUDIENCE,
    )
    from shared.exceptions import UnauthorizedError

    user, _ = _seed_member(pg_session, tenant)
    refresh = _set_cookies(_login(http, user))[REFRESH_TOKEN_COOKIE_NAME].value

    with pytest.raises(UnauthorizedError):
        signing.verify_token(refresh, expected_audience=TENANT_AUDIENCE)

    # Uctan uca: erisim cerezi yerine konursa da 401.
    me = http.get(
        "/api/v1/auth/users/me",
        headers=_cookie_header(**{ACCESS_TOKEN_COOKIE_NAME: refresh}),
    )
    assert me.status_code == 401
    me_bearer = http.get(
        "/api/v1/auth/users/me",
        headers={"Authorization": f"Bearer {refresh}"},
    )
    assert me_bearer.status_code == 401


def test_typ_refresh_is_rejected_even_with_tenant_audience(
    pg_session, tenant, signing,
):
    """Audience karissa bile `typ: refresh` erisim olarak kabul edilmez."""
    from jose import jwt

    from shared.auth import TENANT_AUDIENCE
    from shared.exceptions import UnauthorizedError

    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "typ": "refresh",
        "user_id": str(uuid.uuid4()),
        "email": "x@acme.com",
        "tenant_id": tenant.id,
        "iss": signing.JWT_ISSUER,
        "aud": TENANT_AUDIENCE,
        "iat": now, "nbf": now, "exp": now + timedelta(minutes=5),
    }, signing.SIGNING_KEY, algorithm="RS256")

    with pytest.raises(UnauthorizedError):
        signing.verify_token(token, expected_audience=TENANT_AUDIENCE)


# =============================================================================
# 6) Logout iki cerezi de siler
# =============================================================================

def test_logout_clears_both_cookies(http):
    from shared.auth import REFRESH_TOKEN_COOKIE_NAME

    resp = http.post("/api/v1/auth/logout")
    assert resp.status_code == 200
    _assert_cleared(resp)
    assert _set_cookies(resp)[REFRESH_TOKEN_COOKIE_NAME]["path"] == "/api/v1/auth"


# =============================================================================
# 7) Microsoft girisi - remember bayragi
# =============================================================================

class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)
        self.content = b""
        self.headers = {}

    def json(self):
        return self._payload


class _FakeAsyncClient:
    profile = {}

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        return _FakeResponse(200, {"access_token": "fake-access-token"})

    async def get(self, url, headers=None, **kw):
        if "photo" in url:
            return _FakeResponse(404, {})
        return _FakeResponse(200, type(self).profile)


@pytest.mark.parametrize("remember, days", [(None, 1), (False, 1), (True, 30)])
def test_microsoft_login_honours_remember(
    http, pg_session, tenant, remember, days,
):
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME

    user, _ = _seed_member(pg_session, tenant)
    _FakeAsyncClient.profile = {"mail": user.email, "displayName": "K O"}
    body = {"code": "fake-code",
            "redirect_uri": "http://localhost:5173/auth/callback"}
    if remember is not None:
        body["remember"] = remember

    with patch("httpx.AsyncClient", _FakeAsyncClient):
        resp = http.post("/api/v1/auth/microsoft", json=body)
    assert resp.status_code == 200, resp.text

    cookies = _set_cookies(resp)
    assert ACCESS_TOKEN_COOKIE_NAME in cookies
    refresh = cookies[REFRESH_TOKEN_COOKIE_NAME]
    assert refresh["max-age"] == str(days * DAY)
    claims = _claims(refresh.value)
    assert claims["rmb"] is bool(remember)
    assert claims["auth_method"] == "microsoft"

    # Microsoft oturumu da yenilenebilir.
    again = _refresh(http, refresh.value)
    assert again.status_code == 200
    assert _set_cookies(again)[REFRESH_TOKEN_COOKIE_NAME]["max-age"] == str(days * DAY)


# =============================================================================
# 8) Organizasyon degistirme yenileme cerezini TASIR
# =============================================================================

def test_switch_tenant_moves_refresh_cookie_and_keeps_remember(
    http, pg_session, tenant,
):
    from app.models.tenancy import TenantMembership
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME

    other = _seed_tenant(pg_session)
    user, _ = _seed_member(pg_session, tenant)
    other_m = TenantMembership(
        tenant_id=uuid.UUID(other.id), user_id=user.id, status="active",
    )
    pg_session.add(other_m)
    pg_session.commit()

    login = _set_cookies(_login(http, user, remember=True))
    resp = http.post(
        "/api/v1/auth/switch-tenant",
        json={"tenant_id": other.id},
        headers=_cookie_header(**{
            ACCESS_TOKEN_COOKIE_NAME: login[ACCESS_TOKEN_COOKIE_NAME].value,
            REFRESH_TOKEN_COOKIE_NAME: login[REFRESH_TOKEN_COOKIE_NAME].value,
        }),
    )
    assert resp.status_code == 200, resp.text
    moved = _set_cookies(resp)[REFRESH_TOKEN_COOKIE_NAME]
    claims = _claims(moved.value)
    assert claims["tenant_id"] == other.id
    assert claims["membership_id"] == str(other_m.id)
    assert claims["rmb"] is True
    assert moved["max-age"] == str(30 * DAY)


# =============================================================================
# 9) session_version artisi - parola degisimi / pasiflestirme
# =============================================================================

def test_admin_password_change_and_deactivation_bump_session_version(
    pg_session, tenant,
):
    from app.schemas.user import UserUpdate
    from app.services.user_service import UserService

    user, _ = _seed_member(pg_session, tenant)
    before = int(user.session_version or 1)

    UserService(pg_session).update(
        user.id, UserUpdate(password="Yeni-parola-12345"), tenant_id=tenant.id,
    )
    pg_session.refresh(user)
    assert user.session_version == before + 1

    UserService(pg_session).update(
        user.id, UserUpdate(is_active=False), tenant_id=tenant.id,
    )
    pg_session.refresh(user)
    assert user.session_version == before + 2
