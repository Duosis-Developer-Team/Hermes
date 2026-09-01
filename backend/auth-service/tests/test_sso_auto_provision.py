# =============================================================================
# Microsoft SSO — alan adiyla otomatik hesap acma / tenant'a katilim
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. Hesap acma YALNIZCA Microsoft token'i + Graph profili alindiktan
#      SONRA olur. Sira bozulursa dogrulanmamis bir e-posta hesap acar.
#   2. Alan adi izin listesi TEK kapidir: liste disi bir e-posta ne
#      hesap acar ne uyelik alir; geriye KAYIT BIRAKMAZ.
#   3. Otomatik acilan hesap MEMBER'dir — admin yapilmaz, parolasizdir
#      (yerel girisle kullanilamaz).
#   4. Kimlik eslesmesi BUYUK/kucuk harf duyarsizdir: dizin farkli
#      yazimla donse bile ikinci hesap acilmaz.
# =============================================================================

from unittest.mock import patch

import pytest

from app.models.rbac import RbacRole, RbacUserRole
from app.models.tenancy import Tenant, TenantMembership
from app.models.user import AuthProvider, User
from app.services import tenant_provisioning as prov
from app.services.auth_service import AuthService
from app.services.tenant_resolver import ResolvedTenant

REDIRECT_URI = "http://localhost:5173/auth/callback"


@pytest.fixture(autouse=True)
def _clean_control_plane(pg_session):
    from sqlalchemy import text as sa_text

    pg_session.execute(sa_text(
        "TRUNCATE tenants, tenant_provisioning_operations, plans, "
        "platform_audit_events CASCADE"
    ))
    pg_session.commit()
    yield


@pytest.fixture()
def signing(monkeypatch):
    """Gercek RSA anahtariyla imzalama — token uretimi testte de calisir."""
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


@pytest.fixture()
def acme(pg_session):
    """Alan adi 'acme.com' ile otomatik katilima acik tenant."""
    with patch.object(prov, "_project_to_core", return_value=None):
        prov.provision_tenant(
            pg_session, slug="acme", display_name="Acme Industries",
            owner_email="owner@acme.com", email_domains="acme.com",
        )
    pg_session.commit()
    row = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    return ResolvedTenant(
        id=str(row.id), slug=row.slug, display_name=row.display_name,
        status=row.status,
    )


# -----------------------------------------------------------------------------
# Microsoft uclarinin sahtesi — kod exchange + Graph profili
# -----------------------------------------------------------------------------

class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeAsyncClient:
    """httpx.AsyncClient yerine gecer; profili sabit doner."""

    profile = {}
    token_status = 200
    graph_status = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        return _FakeResponse(
            type(self).token_status, {"access_token": "fake-access-token"}
        )

    async def get(self, url, headers=None):
        return _FakeResponse(type(self).graph_status, type(self).profile)


def _login(db, tenant, profile, **overrides):
    """SSO akisini sahte Microsoft yanitlariyla kosar."""
    import asyncio

    _FakeAsyncClient.profile = profile
    _FakeAsyncClient.token_status = overrides.get("token_status", 200)
    _FakeAsyncClient.graph_status = overrides.get("graph_status", 200)

    svc = AuthService(db)
    with patch("httpx.AsyncClient", _FakeAsyncClient):
        return asyncio.run(svc.authenticate_microsoft(
            "fake-code", REDIRECT_URI, tenant=tenant
        ))


# =============================================================================
# 1) Mutlu yol — dizinde dogrulanmis yeni kimlik hesap acar ve girer
# =============================================================================

def test_sso_creates_account_for_allowed_domain(pg_session, acme, signing):
    token = _login(pg_session, acme, {
        "mail": "abc@acme.com", "displayName": "Abc Kullanici",
    })

    assert token.user["email"] == "abc@acme.com"

    user = pg_session.query(User).filter(User.email == "abc@acme.com").one()
    assert user.is_active is True
    assert user.auth_provider == AuthProvider.MICROSOFT
    # Parolasiz: yerel giris yolundan kullanilamaz.
    assert user.hashed_password is None

    membership = pg_session.query(TenantMembership).filter(
        TenantMembership.user_id == user.id,
    ).one()
    assert membership.status == "active"

    # MEMBER olarak gelir — admin DEGIL.
    assert user.is_admin is False
    member_role = pg_session.query(RbacRole).filter(
        RbacRole.tenant_id == membership.tenant_id, RbacRole.code == "member",
    ).one()
    assert pg_session.query(RbacUserRole).filter(
        RbacUserRole.user_id == user.id,
        RbacUserRole.role_id == member_role.id,
    ).count() == 1

    admin_role = pg_session.query(RbacRole).filter(
        RbacRole.tenant_id == membership.tenant_id,
        RbacRole.code == "system-admin",
    ).one()
    assert pg_session.query(RbacUserRole).filter(
        RbacUserRole.user_id == user.id,
        RbacUserRole.role_id == admin_role.id,
    ).count() == 0


# =============================================================================
# 2) Izin listesi TEK kapi — disaridakiler kayit BIRAKMAZ
# =============================================================================

def test_sso_rejects_domain_outside_allowlist(pg_session, acme, signing):
    from shared.exceptions import UnauthorizedError

    with pytest.raises(UnauthorizedError):
        _login(pg_session, acme, {
            "mail": "biri@baska.com", "displayName": "Yabanci",
        })

    assert pg_session.query(User).filter(
        User.email == "biri@baska.com"
    ).count() == 0


def test_sso_rejects_lookalike_subdomain(pg_session, acme, signing):
    """'x.acme.com' ve 'evil-acme.com' izinli DEGILDIR (tam eslesme)."""
    from shared.exceptions import UnauthorizedError

    for email in ("biri@x.acme.com", "biri@evil-acme.com"):
        with pytest.raises(UnauthorizedError):
            _login(pg_session, acme, {"mail": email, "displayName": "X"})
        assert pg_session.query(User).filter(User.email == email).count() == 0


def test_sso_rejects_guest_ext_upn(pg_session, acme, signing):
    """B2B misafir hesabi (UPN'de #EXT#) otomatik hesap ACMAZ."""
    from shared.exceptions import UnauthorizedError

    with pytest.raises(UnauthorizedError):
        _login(pg_session, acme, {
            "userPrincipalName": "disari_gmail.com#EXT#@acme.onmicrosoft.com",
            "displayName": "Misafir",
        })

    assert pg_session.query(User).count() == 1  # yalnizca tenant sahibi


def test_sso_does_not_provision_when_domains_absent(pg_session, signing):
    """Alan adi tanimlanmamis tenant'ta otomatik hesap ACILMAZ."""
    from shared.exceptions import UnauthorizedError

    with patch.object(prov, "_project_to_core", return_value=None):
        prov.provision_tenant(
            pg_session, slug="kapali", display_name="Kapali",
            owner_email="owner@kapali.com", email_domains=None,
        )
    pg_session.commit()
    row = pg_session.query(Tenant).filter(Tenant.slug == "kapali").one()
    tenant = ResolvedTenant(
        id=str(row.id), slug=row.slug, display_name=row.display_name,
        status=row.status,
    )

    with pytest.raises(UnauthorizedError):
        _login(pg_session, tenant, {
            "mail": "yeni@kapali.com", "displayName": "Yeni",
        })
    assert pg_session.query(User).filter(
        User.email == "yeni@kapali.com"
    ).count() == 0


# =============================================================================
# 3) Mevcut hesaba giris — ikinci kayit ACILMAZ
# =============================================================================

def test_sso_matches_existing_identity_case_insensitively(
    pg_session, acme, signing
):
    from uuid import UUID

    existing = User(
        email="mevcut@acme.com", full_name="Mevcut Kullanici",
        hashed_password="x", is_active=True,
    )
    pg_session.add(existing)
    pg_session.flush()
    pg_session.add(TenantMembership(
        tenant_id=UUID(acme.id), user_id=existing.id, status="active",
    ))
    pg_session.commit()
    existing_id = existing.id

    # Entra farkli yazimla donuyor.
    token = _login(pg_session, acme, {
        "mail": "Mevcut@ACME.com", "displayName": "Mevcut Kullanici",
    })

    assert token.user["id"] == str(existing_id)
    assert pg_session.query(User).filter(
        User.email.ilike("mevcut@acme.com")
    ).count() == 1


def test_sso_grants_membership_to_existing_identity(pg_session, acme, signing):
    """Kimlik var ama uyelik yoksa: alan adi kuraliyla uye yapilir."""
    orphan = User(
        email="uyeliksiz@acme.com", full_name="Uyeliksiz",
        hashed_password="x", is_active=True,
    )
    pg_session.add(orphan)
    pg_session.commit()

    _login(pg_session, acme, {
        "mail": "uyeliksiz@acme.com", "displayName": "Uyeliksiz",
    })

    assert pg_session.query(TenantMembership).filter(
        TenantMembership.user_id == orphan.id,
        TenantMembership.status == "active",
    ).count() == 1


def test_sso_refuses_inactive_account(pg_session, acme, signing):
    """Pasife alinmis hesap SSO ile geri dirilmez."""
    from shared.exceptions import UnauthorizedError

    disabled = User(
        email="ayrilan@acme.com", full_name="Ayrilan",
        hashed_password="x", is_active=False,
    )
    pg_session.add(disabled)
    pg_session.commit()

    with pytest.raises(UnauthorizedError):
        _login(pg_session, acme, {
            "mail": "ayrilan@acme.com", "displayName": "Ayrilan",
        })


# =============================================================================
# 4) Sira kilidi — hesap acma dogrulamadan SONRA gelir
# =============================================================================

def test_provisioning_happens_after_directory_verification():
    """Kod duzeyinde sira: Graph profili → hesap acma.

    Ters cevrilirse dogrulanmamis bir e-posta hesap acabilir; bu testin
    tek isi o sirayi kilitlemektir.
    """
    import inspect

    src = inspect.getsource(AuthService.authenticate_microsoft)
    graph_at = src.index("graph_resp")
    create_at = src.index("maybe_auto_create_user")
    join_at = src.index("maybe_auto_join")
    assert graph_at < create_at, "hesap acma Graph dogrulamasindan ONCE gelemez"
    assert graph_at < join_at, "uyelik acma Graph dogrulamasindan ONCE gelemez"


def test_failed_token_exchange_creates_nothing(pg_session, acme, signing):
    from shared.exceptions import UnauthorizedError

    with pytest.raises(UnauthorizedError):
        _login(
            pg_session, acme,
            {"mail": "abc@acme.com", "displayName": "Abc"},
            token_status=400,
        )
    assert pg_session.query(User).filter(
        User.email == "abc@acme.com"
    ).count() == 0
