# =============================================================================
# Microsoft Graph profil fotografi — senkron + okuma ucu
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. Fotograf SSO girisinde AYNI delegated token ile cekilir; once
#      96x96, yoksa varsayilan boy. 404 = fotograf yok -> kayit silinir.
#   2. Hicbir fotograf hatasi (zaman asimi, 5xx, boyut, tip) GIRISI
#      bozmaz; mevcut kayit da degismez.
#   3. Yalnizca image/jpeg|png, bayt imzasi basliga uymali, <= 200 KB.
#   4. Okuma ucu oturum ister; cagiranin tenant'inda aktif uye olmayan
#      kullanicinin fotografi = 404 (fotografi olmayanla AYNI yanit).
#   5. ETag + If-None-Match -> 304; Cache-Control private.
#   6. /users/lookup ve /auth/users/me `has_photo` + `photo_etag` tasir.
# =============================================================================

import asyncio
import hashlib
import logging
import uuid
from unittest.mock import patch

import pytest

from app.models.tenancy import Tenant, TenantMembership
from app.models.user import User
from app.models.user_photo import UserPhoto
from app.services import tenant_provisioning as prov
from app.services import user_photo_service as photos
from app.services.auth_service import AuthService
from app.services.tenant_resolver import ResolvedTenant

REDIRECT_URI = "http://localhost:5173/auth/callback"
JPEG = b"\xff\xd8\xff\xe0" + b"j" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 64
SECRET_TOKEN = "fake-access-token-SECRET"


@pytest.fixture(autouse=True)
def _clean(pg_session):
    from sqlalchemy import text as sa_text

    pg_session.execute(sa_text(
        "TRUNCATE tenants, tenant_provisioning_operations, plans, "
        "platform_audit_events CASCADE"
    ))
    pg_session.commit()
    yield


@pytest.fixture()
def signing(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    from shared import auth as shared_auth

    monkeypatch.setattr(shared_auth, "SIGNING_KEY", private_pem)
    monkeypatch.setattr(shared_auth, "VERIFY_KEY", public_pem)
    return shared_auth


def _provision(db, slug, domain):
    with patch.object(prov, "_project_to_core", return_value=None):
        prov.provision_tenant(
            db, slug=slug, display_name=slug.title(),
            owner_email=f"owner@{domain}", email_domains=domain,
        )
    db.commit()
    row = db.query(Tenant).filter(Tenant.slug == slug).one()
    return ResolvedTenant(
        id=str(row.id), slug=row.slug, display_name=row.display_name,
        status=row.status,
    )


@pytest.fixture()
def acme(pg_session):
    return _provision(pg_session, "acme", "acme.com")


@pytest.fixture()
def globex(pg_session):
    return _provision(pg_session, "globex", "globex.com")


# -----------------------------------------------------------------------------
# Sahte Microsoft uclari
# -----------------------------------------------------------------------------

class _Resp:
    def __init__(self, status_code, content=b"", headers=None, payload=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}
        self._payload = payload
        self.text = "x"

    def json(self):
        return self._payload


class _FakeClient:
    """httpx.AsyncClient yerine gecer. Foto yanitlari URL'ye gore."""

    profile = {}
    photo_responses = {}     # url -> _Resp | "timeout" | "hang"
    calls = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        return _Resp(200, payload={"access_token": SECRET_TOKEN})

    async def get(self, url, headers=None):
        import httpx

        type(self).calls.append((url, headers))
        if url.endswith("/v1.0/me"):
            return _Resp(200, payload=type(self).profile)
        behaviour = type(self).photo_responses.get(url, _Resp(404))
        if behaviour == "timeout":
            raise httpx.ReadTimeout("timed out")
        if behaviour == "hang":
            await asyncio.sleep(30)
        return behaviour


SMALL = photos.GRAPH_PHOTO_URLS[0]
DEFAULT = photos.GRAPH_PHOTO_URLS[1]


def _img(content, ctype):
    return _Resp(200, content, {"content-type": ctype,
                                "content-length": str(len(content))})


def _login(db, tenant, email, photo_responses):
    _FakeClient.profile = {"mail": email, "displayName": "Foto Kisi"}
    _FakeClient.photo_responses = photo_responses
    _FakeClient.calls = []
    svc = AuthService(db)
    with patch("httpx.AsyncClient", _FakeClient):
        return asyncio.run(svc.authenticate_microsoft(
            "fake-code", REDIRECT_URI, tenant=tenant
        ))


def _photo_of(db, email):
    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    return user, db.get(UserPhoto, user.id)


# =============================================================================
# 1) Giris sirasinda senkron
# =============================================================================

def test_login_stores_small_photo_with_same_delegated_token(
    pg_session, acme, signing
):
    token = _login(pg_session, acme, "a@acme.com", {
        SMALL: _img(JPEG, "image/jpeg"),
    })
    assert token.user["email"] == "a@acme.com"

    _, photo = _photo_of(pg_session, "a@acme.com")
    assert photo is not None
    assert bytes(photo.data) == JPEG
    assert photo.content_type == "image/jpeg"
    assert photo.etag == hashlib.sha256(JPEG).hexdigest()
    assert photo.size_bytes == len(JPEG)

    photo_calls = [c for c in _FakeClient.calls if "photo" in c[0]]
    assert photo_calls[0][0] == SMALL
    assert photo_calls[0][1] == {"Authorization": f"Bearer {SECRET_TOKEN}"}


def test_login_falls_back_to_default_size(pg_session, acme, signing):
    _login(pg_session, acme, "b@acme.com", {
        SMALL: _Resp(404), DEFAULT: _img(PNG, "image/png"),
    })
    _, photo = _photo_of(pg_session, "b@acme.com")
    assert photo is not None and photo.content_type == "image/png"
    assert bytes(photo.data) == PNG


def test_graph_404_deletes_previous_photo(pg_session, acme, signing):
    _login(pg_session, acme, "c@acme.com", {SMALL: _img(JPEG, "image/jpeg")})
    assert _photo_of(pg_session, "c@acme.com")[1] is not None

    # Kullanici fotografini kaldirdi: iki uc da 404.
    token = _login(pg_session, acme, "c@acme.com", {})
    assert token.access_token
    assert _photo_of(pg_session, "c@acme.com")[1] is None


def test_new_photo_replaces_old(pg_session, acme, signing):
    _login(pg_session, acme, "d@acme.com", {SMALL: _img(JPEG, "image/jpeg")})
    _login(pg_session, acme, "d@acme.com", {SMALL: _img(PNG, "image/png")})
    _, photo = _photo_of(pg_session, "d@acme.com")
    assert photo.content_type == "image/png"
    assert photo.etag == hashlib.sha256(PNG).hexdigest()


@pytest.mark.parametrize("failure", [
    "timeout",
    _Resp(500),
    _Resp(403),
    # Boyut asimi (bildirilen ve gercek)
    _img(b"\xff\xd8\xff" + b"x" * (200 * 1024), "image/jpeg"),
    _Resp(200, b"\xff\xd8\xff" + b"x" * (200 * 1024),
          {"content-type": "image/jpeg"}),
    # Izinsiz tip
    _img(b"GIF89a" + b"g" * 10, "image/gif"),
    # Baslik jpeg diyor, baytlar degil
    _img(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/jpeg"),
    # Bos govde
    _img(b"", "image/png"),
])
def test_photo_failures_never_break_login_and_keep_existing(
    pg_session, acme, signing, caplog, failure
):
    _login(pg_session, acme, "e@acme.com", {SMALL: _img(JPEG, "image/jpeg")})

    caplog.set_level(logging.WARNING)
    token = _login(pg_session, acme, "e@acme.com", {
        SMALL: failure, DEFAULT: failure,
    })
    assert token.access_token and token.user["email"] == "e@acme.com"

    # Mevcut fotograf DEGISMEDI.
    _, photo = _photo_of(pg_session, "e@acme.com")
    assert photo is not None and bytes(photo.data) == JPEG

    warnings = [r.getMessage() for r in caplog.records
                if r.name == photos.__name__]
    assert warnings, "hata uyari olarak loglanmali"
    for msg in warnings:
        assert SECRET_TOKEN not in msg
        assert "e@acme.com" not in msg


def test_first_login_without_photo_still_succeeds(pg_session, acme, signing):
    token = _login(pg_session, acme, "f@acme.com", {SMALL: _Resp(500),
                                                    DEFAULT: "timeout"})
    assert token.access_token
    assert _photo_of(pg_session, "f@acme.com")[1] is None


def test_hanging_graph_is_cut_by_total_timeout(
    pg_session, acme, signing, monkeypatch
):
    import time

    monkeypatch.setattr(photos, "PHOTO_FETCH_TIMEOUT_SECONDS", 0.2)
    started = time.monotonic()
    token = _login(pg_session, acme, "g@acme.com", {SMALL: "hang"})
    assert token.access_token
    assert time.monotonic() - started < 5
    assert _photo_of(pg_session, "g@acme.com")[1] is None


def test_client_construction_failure_is_swallowed(pg_session, acme, signing):
    """Beklenmeyen istisna (orn. istemci kurulamadi) da girisi bozmaz."""
    result = asyncio.run(photos.fetch_graph_photo(""))
    assert result.status == photos.PHOTO_UNKNOWN

    with patch("httpx.AsyncClient", side_effect=RuntimeError("boom")):
        result = asyncio.run(photos.fetch_graph_photo("tok"))
    assert result.status == photos.PHOTO_UNKNOWN


def test_rejected_login_stores_no_photo(pg_session, acme, signing):
    from shared.exceptions import UnauthorizedError

    with pytest.raises(UnauthorizedError):
        _login(pg_session, acme, "x@disari.com",
               {SMALL: _img(JPEG, "image/jpeg")})
    assert pg_session.query(UserPhoto).count() == 0
    assert not [c for c in _FakeClient.calls if "photo" in c[0]]


# =============================================================================
# 2) Okuma ucu + lookup alanlari
# =============================================================================

def _member(db, tenant, email, status="active"):
    u = User(id=uuid.uuid4(), email=email, full_name=email,
             hashed_password="x", is_admin=False, is_active=True)
    db.add(u)
    db.flush()
    db.add(TenantMembership(tenant_id=uuid.UUID(tenant.id), user_id=u.id,
                            status=status))
    db.commit()
    return u


def _give_photo(db, user, content=JPEG, ctype="image/jpeg"):
    db.add(UserPhoto(user_id=user.id, content_type=ctype, data=content,
                     size_bytes=len(content),
                     etag=hashlib.sha256(content).hexdigest()))
    db.commit()


@pytest.fixture()
def as_user(auth_http):
    from shared.auth import CurrentUser, get_current_user
    from app.main import app

    def _set(user, tenant):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user.id), email=user.email, tenant_id=tenant.id,
        )
        return auth_http

    yield _set
    app.dependency_overrides.pop(get_current_user, None)


PHOTO_URL = "/api/v1/auth/users/{}/photo"


def test_photo_endpoint_requires_session(auth_http, pg_session, acme):
    u = _member(pg_session, acme, "p@acme.com")
    _give_photo(pg_session, u)
    r = auth_http.get(PHOTO_URL.format(u.id))
    assert r.status_code == 401


def test_photo_endpoint_serves_same_tenant_member(
    as_user, pg_session, acme
):
    caller = _member(pg_session, acme, "caller@acme.com")
    target = _member(pg_session, acme, "target@acme.com")
    _give_photo(pg_session, target)

    client = as_user(caller, acme)
    r = client.get(PHOTO_URL.format(target.id))
    assert r.status_code == 200
    assert r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    etag = r.headers["etag"]
    assert etag == f'"{hashlib.sha256(JPEG).hexdigest()}"'
    assert r.headers["cache-control"] == "private, max-age=86400"

    r2 = client.get(PHOTO_URL.format(target.id),
                    headers={"If-None-Match": etag})
    assert r2.status_code == 304
    assert r2.content == b""
    assert r2.headers["etag"] == etag

    r3 = client.get(PHOTO_URL.format(target.id),
                    headers={"If-None-Match": f'W/{etag}, "other"'})
    assert r3.status_code == 304

    r4 = client.get(PHOTO_URL.format(target.id),
                    headers={"If-None-Match": '"stale"'})
    assert r4.status_code == 200


def test_photo_endpoint_cross_tenant_is_404(as_user, pg_session, acme, globex):
    caller = _member(pg_session, acme, "caller@acme.com")
    outsider = _member(pg_session, globex, "out@globex.com")
    _give_photo(pg_session, outsider)

    client = as_user(caller, acme)
    missing = client.get(PHOTO_URL.format(uuid.uuid4()))
    r = client.get(PHOTO_URL.format(outsider.id))
    assert r.status_code == 404
    # Gorunmeyen kullanici, var olmayanla AYNI yaniti alir.
    assert r.json() == missing.json()


def test_photo_endpoint_inactive_membership_is_404(as_user, pg_session, acme):
    caller = _member(pg_session, acme, "caller@acme.com")
    gone = _member(pg_session, acme, "gone@acme.com", status="removed")
    _give_photo(pg_session, gone)
    assert as_user(caller, acme).get(
        PHOTO_URL.format(gone.id)).status_code == 404


def test_photo_endpoint_no_photo_is_404_and_self_is_visible(
    as_user, pg_session, acme
):
    caller = _member(pg_session, acme, "caller@acme.com")
    client = as_user(caller, acme)
    assert client.get(PHOTO_URL.format(caller.id)).status_code == 404
    _give_photo(pg_session, caller, PNG, "image/png")
    r = client.get(PHOTO_URL.format(caller.id))
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_lookup_and_me_include_photo_fields(
    as_user, pg_session, acme, globex
):
    caller = _member(pg_session, acme, "caller@acme.com")
    with_photo = _member(pg_session, acme, "with@acme.com")
    without = _member(pg_session, acme, "without@acme.com")
    outsider = _member(pg_session, globex, "out@globex.com")
    _give_photo(pg_session, with_photo)
    _give_photo(pg_session, outsider)

    client = as_user(caller, acme)
    r = client.get("/api/v1/auth/users/lookup")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}

    row = rows[str(with_photo.id)]
    assert row["has_photo"] is True
    assert row["photo_etag"] == hashlib.sha256(JPEG).hexdigest()
    # Mevcut alanlar degismedi.
    for key in ("id", "full_name", "email", "role", "is_admin", "is_active"):
        assert key in row

    assert rows[str(without.id)]["has_photo"] is False
    assert rows[str(without.id)]["photo_etag"] is None
    # Baska tenant'in fotografi lookup'ta da GORUNMEZ (uc 404 verirdi).
    if str(outsider.id) in rows:
        assert rows[str(outsider.id)]["has_photo"] is False

    me = client.get("/api/v1/auth/users/me")
    assert me.status_code == 200
    assert me.json()["has_photo"] is False
    assert me.json()["photo_etag"] is None
    _give_photo(pg_session, caller)
    me = client.get("/api/v1/auth/users/me").json()
    assert me["has_photo"] is True
    assert me["photo_etag"] == hashlib.sha256(JPEG).hexdigest()


def test_user_delete_cascades_photo(pg_session, acme):
    u = _member(pg_session, acme, "del@acme.com")
    _give_photo(pg_session, u)
    pg_session.delete(u)
    pg_session.commit()
    assert pg_session.query(UserPhoto).count() == 0
