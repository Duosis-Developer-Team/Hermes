# =============================================================================
# WS9 — Platform Admin duzlemi kapilari
# =============================================================================
# WS9'un iki cikis kriteri:
#
#   1. Tenant yoneticisi platform API'sine ULASAMAZ.
#   2. Platform admini tenant is verisini SESSIZCE gezemez — erisim
#      ancak sureli, gerekceli, denetlenen bir destek izniyle olur.
#
# Ayrica destek izninin sinirlari (sure, mod, sahiplik, iptal) ve
# denetim kaydinin gizlilik sozlesmesi test edilir.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

BASE = "/api/platform/v1"


# =============================================================================
# Yardimcilar
# =============================================================================

def _seed_tenant(db, slug="acme"):
    tenant_id = uuid.uuid4()
    db.execute(text(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) VALUES "
        "(:id, :slug, :name, 'active', 'tr-TR', 'Europe/Istanbul', "
        "'shared', 'shared-default', 1, now(), now())"
    ), {"id": tenant_id, "slug": f"{slug}-{uuid.uuid4().hex[:8]}",
        "name": slug.title()})
    db.commit()
    return tenant_id


def _seed_user(db, *, email=None, password_hash="x"):
    from app.models.user import User

    user = User(
        id=uuid.uuid4(),
        email=email or f"u-{uuid.uuid4().hex[:8]}@x.com",
        full_name="Operator",
        hashed_password=password_hash,
        is_active=True,
        is_admin=False,
    )
    db.add(user)
    db.commit()
    return user


def _make_platform_admin(db, user, permissions=None):
    from app.models.tenancy import PlatformAdmin
    from shared.platform_permissions import ALL_PLATFORM_PERMISSIONS

    admin = PlatformAdmin(
        user_id=user.id,
        permissions=list(
            permissions if permissions is not None
            else ALL_PLATFORM_PERMISSIONS
        ),
        is_active=True,
    )
    db.add(admin)
    db.commit()
    return admin


@pytest.fixture()
def platform_http(pg_session):
    """Platform API istemcisi — kimlik override ile sentezlenir."""
    from app.database import get_db
    from app.main import app
    from shared.auth import PlatformPrincipal, get_platform_principal

    holder = {"principal": None}
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_platform_principal] = (
        lambda: holder["principal"]
    )
    client = TestClient(app, raise_server_exceptions=False)
    client.as_admin = lambda u: holder.__setitem__(
        "principal", PlatformPrincipal(id=str(u.id), email=u.email)
    )
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_platform_principal, None)


# =============================================================================
# 1) Tenant yoneticisi platform API'sine ULASAMAZ
# =============================================================================

def test_platform_api_rejects_unauthenticated(pg_session):
    """Oturumsuz istek 401 — platform yuzeyi acik degildir."""
    from app.database import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: pg_session
    try:
        http = TestClient(app, raise_server_exceptions=False)
        assert http.get(f"{BASE}/overview").status_code == 401
        assert http.get(f"{BASE}/tenants").status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_tenant_session_cookie_is_not_accepted_by_platform(pg_session):
    """TENANT oturum cerezi platform ucunda KIMLIK DEGILDIR.

    Tenant yoneticisi (system-admin) kendi cerezini platform API'sine
    gonderse bile 401 alir: iki duzlem farkli audience ve farkli cookie
    kullanir.
    """
    from app.database import get_db
    from app.main import app
    from shared.auth import ACCESS_TOKEN_COOKIE_NAME

    app.dependency_overrides[get_db] = lambda: pg_session
    try:
        http = TestClient(app, raise_server_exceptions=False)
        resp = http.get(
            f"{BASE}/overview",
            cookies={ACCESS_TOKEN_COOKIE_NAME: "tenant-session-value"},
        )
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_valid_user_without_platform_record_is_denied(
    platform_http, pg_session
):
    """Gecerli bir Hermes kullanicisi olmak platform operatoru YAPMAZ.

    Kimlik dogrulansa bile `platform_admins` kaydi yoksa izin kumesi
    bostur → 403.
    """
    user = _seed_user(pg_session)          # platform_admins kaydi YOK
    platform_http.as_admin(user)
    assert platform_http.get(f"{BASE}/overview").status_code == 403


def test_platform_permissions_are_granular(platform_http, pg_session):
    """Yalnizca `tenants.view` olan operator lifecycle CALISTIRAMAZ."""
    from shared.platform_permissions import PlatformPerm

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user, [PlatformPerm.TENANTS_VIEW])
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    assert platform_http.get(f"{BASE}/overview").status_code == 200
    resp = platform_http.post(
        f"{BASE}/tenants/{tenant_id}/suspend",
        json={"reason": "test", "confirm_slug": "x"},
    )
    assert resp.status_code == 403


def test_tenant_permission_codes_do_not_grant_platform_access(
    platform_http, pg_session
):
    """Tenant izin kodlari platform kaydinda HICBIR sey ifade etmez."""
    user = _seed_user(pg_session)
    # Tenant katalogundan kodlar — platform katalogunda gecersiz.
    _make_platform_admin(
        pg_session, user, ["users.manage", "roles.manage", "tasks.admin"]
    )
    platform_http.as_admin(user)
    assert platform_http.get(f"{BASE}/overview").status_code == 403


# =============================================================================
# 2) Platform admini tenant is verisini SESSIZCE gezemez
# =============================================================================

def test_platform_api_exposes_no_business_data(platform_http, pg_session):
    """Tenant detayi YALNIZCA metadata doner.

    Gorev, musteri, proje, zaman kaydi gibi hicbir is verisi bu
    duzlemden gorunmez — gorunseydi destek izni mekanizmasi anlamsiz
    olurdu.
    """
    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    body = platform_http.get(f"{BASE}/tenants/{tenant_id}").json()
    allowed = {
        "id", "slug", "display_name", "status", "plan_code",
        "active_members", "created_at", "activated_at", "version",
    }
    assert set(body.keys()) == allowed

    # Platform router'inda is verisi donduren bir yol OLMAMALI.
    from app.routers import platform_admin

    source = open(platform_admin.__file__, encoding="utf-8").read()
    for forbidden in ("Task", "WorkLog", "Customer", "Project"):
        assert f"models.task import {forbidden}" not in source
        assert f"import {forbidden}\n" not in source


def test_support_grant_requires_reason_and_bounded_duration(
    platform_http, pg_session
):
    """Gerekce ZORUNLU, sure 1-30 dakika ile SINIRLI."""
    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    # Gerekcesiz
    resp = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "", "duration_minutes": 10,
    })
    assert resp.status_code == 422

    # Cok uzun
    resp = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "SUP-1 inceleme",
        "duration_minutes": 120,
    })
    assert resp.status_code == 422


def test_read_write_support_requires_extra_permission(
    platform_http, pg_session
):
    """Salt-okunur VARSAYILANDIR; yazma AYRI izin ister."""
    from shared.platform_permissions import PlatformPerm

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user, [
        PlatformPerm.TENANTS_VIEW, PlatformPerm.SUPPORT_ACCESS_CREATE,
    ])
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    resp = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "mode": "read_write",
        "reason": "SUP-2 duzeltme", "duration_minutes": 10,
    })
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "support_write_forbidden"

    # Salt-okunur ayni operatorle CALISIR.
    resp = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "mode": "read_only",
        "reason": "SUP-2 inceleme", "duration_minutes": 10,
    })
    assert resp.status_code == 200


def test_support_session_token_is_tenant_scoped_and_marked(
    platform_http, pg_session, monkeypatch
):
    """Destek oturumu TENANT audience'li ve isaretlidir.

    Yani RLS onu da baglar: "her seyi goren" bir token degil, BELIRLI
    bir tenant'a acilan sureli bir penceredir. `support_grant_id` ve
    `support_mode` her istekte denetlenebilir olsun diye token'da tasinir.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from shared import auth as shared_auth

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(shared_auth, "SIGNING_KEY", key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode())
    monkeypatch.setattr(shared_auth, "VERIFY_KEY", key.public_key(
    ).public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode())

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    created = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "SUP-3 inceleme",
        "duration_minutes": 5,
    }).json()["grant"]

    resp = platform_http.post(
        f"{BASE}/support-grants/{created['id']}/exchange"
    )
    assert resp.status_code == 200
    session = resp.json()["support_session"]

    data = shared_auth.verify_token(
        session["token"], expected_audience=shared_auth.TENANT_AUDIENCE
    )
    assert data.tenant_id == str(tenant_id)
    assert data.support_grant_id == created["id"]
    assert data.support_mode == "read_only"
    assert data.auth_method == "support"
    # Destek oturumu bir UYELIK tasimaz: operator o organizasyonun
    # uyesi degildir ve oyleymis gibi gorunmemelidir.
    assert data.membership_id is None

    # Ve bu token PLATFORM ucunda gecersizdir.
    from shared.exceptions import UnauthorizedError

    with pytest.raises(UnauthorizedError):
        shared_auth.verify_token(
            session["token"],
            expected_audience=shared_auth.PLATFORM_AUDIENCE,
        )


def test_revoked_grant_cannot_be_exchanged(platform_http, pg_session):
    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    grant = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "SUP-4", "duration_minutes": 5,
    }).json()["grant"]

    assert platform_http.post(
        f"{BASE}/support-grants/{grant['id']}/revoke"
    ).status_code == 200

    resp = platform_http.post(
        f"{BASE}/support-grants/{grant['id']}/exchange"
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "support_grant_expired"


def test_expired_grant_cannot_be_exchanged(platform_http, pg_session):
    from app.models.tenancy import SupportAccessGrant

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    grant = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "SUP-5", "duration_minutes": 5,
    }).json()["grant"]

    # DIKKAT: `chk_support_grants_expiry` (expires_at > created_at) hala
    # gecerli olmali — izni "gecmise" tasirken ikisini BIRLIKTE kaydiriyoruz.
    # Kisit, suresi bastan gecmis bir izin YAZILMASINI da engelliyor;
    # bu testin amaci suresi DOLMUS bir izni reddetmek.
    row = pg_session.query(SupportAccessGrant).filter(
        SupportAccessGrant.id == uuid.UUID(grant["id"])
    ).first()
    now = datetime.now(timezone.utc)
    row.created_at = now - timedelta(minutes=10)
    row.expires_at = now - timedelta(minutes=1)
    pg_session.commit()

    assert platform_http.post(
        f"{BASE}/support-grants/{grant['id']}/exchange"
    ).status_code == 404


def test_grant_belongs_to_the_operator_who_created_it(
    platform_http, pg_session
):
    """Baska bir operatorun izni KULLANILAMAZ."""
    creator = _seed_user(pg_session)
    other = _seed_user(pg_session)
    _make_platform_admin(pg_session, creator)
    _make_platform_admin(pg_session, other)
    tenant_id = _seed_tenant(pg_session)

    platform_http.as_admin(creator)
    grant = platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "SUP-6", "duration_minutes": 5,
    }).json()["grant"]

    platform_http.as_admin(other)
    assert platform_http.post(
        f"{BASE}/support-grants/{grant['id']}/exchange"
    ).status_code == 404


# =============================================================================
# 3) Yasam dongusu ve denetim
# =============================================================================

def test_suspend_requires_typed_confirmation(platform_http, pg_session):
    from app.models.tenancy import Tenant

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)
    slug = pg_session.query(Tenant).filter(Tenant.id == tenant_id).first().slug

    # Yanlis yazim → 422
    resp = platform_http.post(f"{BASE}/tenants/{tenant_id}/suspend", json={
        "reason": "odeme yok", "confirm_slug": "yanlis",
    })
    assert resp.status_code == 422

    # Dogru yazim → askiya alinir
    resp = platform_http.post(f"{BASE}/tenants/{tenant_id}/suspend", json={
        "reason": "odeme yok", "confirm_slug": slug,
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "suspended"


def test_invalid_transition_is_rejected(platform_http, pg_session):
    """Durum makinesi disina cikilamaz: aktif tenant 'reactivate'
    edilemez (zaten aktif)."""
    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)

    resp = platform_http.post(f"{BASE}/tenants/{tenant_id}/reactivate",
                              json={"reason": "gereksiz"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "invalid_transition"


def test_optimistic_lock_prevents_silent_overwrite(
    platform_http, pg_session
):
    """Iki operator ayni anda islem yaparsa ikincisi 409 alir."""
    from app.models.tenancy import Tenant

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)
    tenant = pg_session.query(Tenant).filter(Tenant.id == tenant_id).first()

    resp = platform_http.post(f"{BASE}/tenants/{tenant_id}/suspend", json={
        "reason": "eski surumle", "confirm_slug": tenant.slug,
        "expected_version": (tenant.version or 1) + 5,   # bayat surum
    })
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "version_conflict"


def test_lifecycle_and_support_actions_are_audited(
    platform_http, pg_session
):
    from app.models.tenancy import PlatformAuditEvent, Tenant

    user = _seed_user(pg_session)
    _make_platform_admin(pg_session, user)
    platform_http.as_admin(user)
    tenant_id = _seed_tenant(pg_session)
    slug = pg_session.query(Tenant).filter(Tenant.id == tenant_id).first().slug

    platform_http.post(f"{BASE}/tenants/{tenant_id}/suspend", json={
        "reason": "SUP-7 gerekce", "confirm_slug": slug,
    })
    platform_http.post(f"{BASE}/support-grants", json={
        "tenant_id": str(tenant_id), "reason": "SUP-7 inceleme",
        "duration_minutes": 5,
    })

    actions = [
        e.action for e in pg_session.query(PlatformAuditEvent)
        .filter(PlatformAuditEvent.target_tenant_id == tenant_id).all()
    ]
    assert "tenant.suspended" in actions
    assert "support_access.created" in actions


def test_audit_never_stores_secrets(pg_session):
    """Denetim kaydinda sifre/token/istek govdesi BULUNMAZ."""
    from app.models.tenancy import PlatformAuditEvent
    from app.services.platform_service import record_audit

    user = _seed_user(pg_session)
    record_audit(
        pg_session, action="platform.test", actor_user_id=user.id,
        metadata={"from": "active", "to": "suspended"},
    )
    pg_session.commit()

    event = (
        pg_session.query(PlatformAuditEvent)
        .filter(PlatformAuditEvent.action == "platform.test").first()
    )
    payload = str(event.metadata_json)
    for forbidden in ("password", "token", "hashed", "secret"):
        assert forbidden not in payload.lower()


def test_bootstrap_script_contains_no_credential():
    """Bootstrap betigi hicbir sifre TASIMAZ (pack 06 §8)."""
    from app.scripts import bootstrap_platform_admin as boot

    source = open(boot.__file__, encoding="utf-8").read()
    # Sifre yalnizca ortamdan gelir veya uretilir; sabit deger YOK.
    assert "HERMES_BOOTSTRAP_ADMIN_PASSWORD" in source
    assert "secrets.token_urlsafe" in source
    for forbidden in ("password = \"", "password='", "Passw0rd", "admin123"):
        assert forbidden not in source
