# =============================================================================
# WS12 — Tenant provisioning (Platform Console'dan yeni tenant acma)
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. SEMA YARATILMAZ — mimari karar geregi tenant basina veritabani/
#      sema yok; izolasyon FORCE RLS ile. Provisioning KAYIT isidir.
#   2. Core projeksiyonu basarisizsa tenant AKTIF OLMAZ (fail-closed):
#      core tenant'i tanimadan is verisi calismaz, yari-acik bir tenant
#      gostermek yalan olurdu.
#   3. Alan adiyla otomatik katilim parolayi ATLAMAZ ve ADMIN YAPMAZ.
#   4. Tek seferlik parola YALNIZCA yeni kullanici yaratildiginda ve
#      YALNIZCA yanitta doner; hicbir yere yazilmaz.
# =============================================================================

from unittest.mock import patch

import pytest

from app.models.rbac import RbacRole, RbacUserRole
from app.models.tenancy import (
    Tenant, TenantIdentityProvider, TenantMembership,
    TenantProvisioningOperation, TenantSubscription,
)
from app.models.user import User
from app.services import tenant_provisioning as prov


@pytest.fixture(autouse=True)
def _clean_control_plane(pg_session):
    """Her test TEMIZ kontrol duzlemiyle baslar.

    Paylasilan `pg_session` yalnizca users/rbac_roles temizliyor; bu
    modul tenant KAYITLARI uretiyor, dolayisiyla onlari da toplamak
    zorunda. Paylasilan fixture'i degistirmek diger testleri etkilerdi.
    """
    from sqlalchemy import text as sa_text

    pg_session.execute(sa_text(
        "TRUNCATE tenants, tenant_provisioning_operations, plans, "
        "platform_audit_events CASCADE"
    ))
    pg_session.commit()
    yield


def _provision(db, **kw):
    params = dict(
        slug="acme", display_name="Acme Industries",
        owner_email="owner@acme.com", email_domains="acme.com",
    )
    params.update(kw)
    with patch.object(prov, "_project_to_core", return_value=None):
        result = prov.provision_tenant(db, **params)
    db.commit()
    return result


# =============================================================================
# 1) Mutlu yol — tenant KAYITLARLA hazir olur, DDL yok
# =============================================================================

def test_provisioning_creates_records_not_schema(pg_session):
    result = _provision(pg_session)

    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    assert tenant.status == "active"
    assert result["tenant"]["id"] == str(tenant.id)
    # Adres slug uzerinden: /?workspace=acme
    assert result["workspace_hint"] == "/?workspace=acme"

    # Sahip uye VE o tenant'in system-admin'i olmali.
    user = pg_session.query(User).filter(User.email == "owner@acme.com").one()
    membership = pg_session.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant.id,
        TenantMembership.user_id == user.id,
    ).one()
    assert membership.status == "active"

    admin_role = pg_session.query(RbacRole).filter(
        RbacRole.tenant_id == tenant.id, RbacRole.code == "system-admin",
    ).one()
    assert pg_session.query(RbacUserRole).filter(
        RbacUserRole.tenant_id == tenant.id,
        RbacUserRole.user_id == user.id,
        RbacUserRole.role_id == admin_role.id,
    ).count() == 1

    # Alan adi kaydi otomatik katilim icin hazir.
    idp = pg_session.query(TenantIdentityProvider).filter(
        TenantIdentityProvider.tenant_id == tenant.id
    ).one()
    assert idp.allowed_email_domains == ["acme.com"]
    assert idp.auto_provision_mode == "auto"


def test_new_owner_gets_one_time_password_once(pg_session):
    result = _provision(pg_session)
    password = result["one_time_password"]
    assert password and len(password) >= 16
    assert result["owner"]["created"] is True

    # Parola HICBIR kayitta saklanmaz — yalnizca hash tutulur.
    user = pg_session.query(User).filter(User.email == "owner@acme.com").one()
    assert password not in (user.hashed_password or "")

    # Saga kaydinda da SIZMAZ.
    op = pg_session.query(TenantProvisioningOperation).first()
    assert op is not None
    assert password not in (op.detail or "")
    assert password not in (op.request_fingerprint or "")


def test_existing_user_as_owner_gets_no_password(pg_session):
    pg_session.add(User(
        email="known@acme.com", full_name="Known",
        hashed_password="already-set", is_active=True,
    ))
    pg_session.commit()

    result = _provision(pg_session, owner_email="known@acme.com")
    assert result["one_time_password"] is None
    assert result["owner"]["created"] is False


# =============================================================================
# 2) Dogrulama
# =============================================================================

@pytest.mark.parametrize("bad", ["", "acme_x", "-acme", "a" * 64, "ac me"])
def test_invalid_slug_rejected(pg_session, bad):
    with pytest.raises(prov.ProvisioningError):
        _provision(pg_session, slug=bad)


def test_slug_is_normalized_not_rejected(pg_session):
    """Buyuk harf REDDEDILMEZ, kucultulur — operatore gereksiz surtunme
    cikarmanin anlami yok; adres yine tek bicimlidir."""
    result = _provision(pg_session, slug="ACME")
    assert result["tenant"]["slug"] == "acme"


@pytest.mark.parametrize("reserved", ["admin", "api", "platform-admin"])
def test_reserved_slug_rejected(pg_session, reserved):
    """Kendi altyapimizin adlari tenant slug'i olamaz — `/?workspace=`
    ile adreslendigi icin karisiklik ve kimlik avi riski dogurur."""
    with pytest.raises(prov.ProvisioningError):
        _provision(pg_session, slug=reserved)


def test_duplicate_slug_rejected(pg_session):
    _provision(pg_session)
    with pytest.raises(prov.ProvisioningError):
        _provision(pg_session, owner_email="other@acme.com")


def test_invalid_email_domain_rejected(pg_session):
    with pytest.raises(prov.ProvisioningError):
        _provision(pg_session, email_domains="not-a-domain")


def test_domains_are_normalized(pg_session):
    assert prov.normalize_domains("@Acme.COM, foo.co.uk ") == [
        "acme.com", "foo.co.uk"
    ]
    assert prov.normalize_domains("") == []


# =============================================================================
# 3) FAIL-CLOSED — core projeksiyonu basarisizsa tenant ACILMAZ
# =============================================================================

def test_core_projection_failure_leaves_tenant_inactive(pg_session):
    """En kritik davranis.

    core_db tenant'i tanimadan is verisi CALISMAZ. Projeksiyon
    basarisizken tenant'i 'active' gostermek, calismayan bir
    organizasyonu calisiyor gibi sunmak olurdu.
    """
    boom = prov.ProvisioningError("core down", step="core_projection")
    with patch.object(prov, "_project_to_core", side_effect=boom):
        with pytest.raises(prov.ProvisioningError):
            prov.provision_tenant(
                pg_session, slug="acme", display_name="Acme",
                owner_email="owner@acme.com",
            )
    pg_session.commit()

    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").first()
    assert tenant is not None
    assert tenant.status != "active"        # ACILMADI

    op = pg_session.query(TenantProvisioningOperation).first()
    assert op.status == "failed"
    assert op.failure_class == "core_projection"


def test_projection_requires_s2s_credential(pg_session, monkeypatch):
    """S2S credential yoksa projeksiyon SESSIZCE gecilmez."""
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("HERMES_S2S_TOKEN_CURRENT", "")
    try:
        tenant = Tenant(slug="x", display_name="X", status="provisioning",
                        version=1)
        with pytest.raises(prov.ProvisioningError) as err:
            prov._project_to_core(tenant)
        assert err.value.step == "core_projection"
    finally:
        get_settings.cache_clear()


# =============================================================================
# 4) Alan adiyla otomatik katilim
# =============================================================================

def test_auto_join_grants_membership_but_not_admin(pg_session):
    from app.services import membership_service

    _provision(pg_session)
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()

    newcomer = User(email="ali@acme.com", full_name="Ali",
                    hashed_password="x", is_active=True)
    pg_session.add(newcomer)
    pg_session.commit()

    membership = membership_service.maybe_auto_join(
        pg_session, tenant=tenant, user=newcomer
    )
    assert membership is not None
    assert membership.status == "active"

    # ADMIN YAPILMAZ: bir alan adina sahip olmak yoneticilik vermez.
    admin_role = pg_session.query(RbacRole).filter(
        RbacRole.tenant_id == tenant.id, RbacRole.code == "system-admin",
    ).one()
    assert pg_session.query(RbacUserRole).filter(
        RbacUserRole.user_id == newcomer.id,
        RbacUserRole.role_id == admin_role.id,
    ).count() == 0


def test_auto_join_ignores_other_domains(pg_session):
    from app.services import membership_service

    _provision(pg_session)
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()

    outsider = User(email="ali@baska.com", full_name="Ali",
                    hashed_password="x", is_active=True)
    pg_session.add(outsider)
    pg_session.commit()

    assert membership_service.maybe_auto_join(
        pg_session, tenant=tenant, user=outsider
    ) is None


def test_auto_join_disabled_when_no_domains(pg_session):
    from app.services import membership_service

    _provision(pg_session, email_domains=None)
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()

    user = User(email="ali@acme.com", full_name="Ali",
                hashed_password="x", is_active=True)
    pg_session.add(user)
    pg_session.commit()

    assert membership_service.maybe_auto_join(
        pg_session, tenant=tenant, user=user
    ) is None


def test_auto_join_does_not_bypass_password(pg_session):
    """Otomatik katilim GIRIS degildir.

    `authenticate` once parolayi dogrular; uyelik dali ancak ondan sonra
    calisir. Kod duzeyinde bu siranin korundugunu kilitliyoruz.
    """
    import inspect

    from app.services.auth_service import AuthService

    src = inspect.getsource(AuthService.authenticate)
    pwd_at = src.index("verify_password")
    join_at = src.index("maybe_auto_join")
    assert pwd_at < join_at, "otomatik katilim parola kontrolunden ONCE gelemez"


# =============================================================================
# 5) Abonelik
# =============================================================================

def test_plan_is_assigned_when_given(pg_session):
    from app.models.tenancy import Plan

    pg_session.add(Plan(code="pro", display_name="Pro", is_active=True))
    pg_session.commit()

    _provision(pg_session, plan_code="pro")
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    sub = pg_session.query(TenantSubscription).filter(
        TenantSubscription.tenant_id == tenant.id
    ).one()
    assert sub.plan_code == "pro" and sub.status == "active"


# =============================================================================
# 6) UC seviyesi — router yolu GERCEKTEN kosulur
# =============================================================================
# Bu blok bir uretim hatasindan dogdu: servis testleri yesildi ama uc
# canlida 500 verdi, cunku router `principal.user_id` okuyordu ve
# `PlatformPrincipal`da oyle bir alan YOK (`.id` var). Servisi dogrudan
# cagiran testler router'in kendisini hic kosmuyordu.

@pytest.fixture()
def platform_client(pg_session):
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app
    from shared.auth import PlatformPrincipal, get_platform_principal

    holder = {"principal": None}
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_platform_principal] = (
        lambda: holder["principal"]
    )
    client = TestClient(app, raise_server_exceptions=False)
    client.as_admin = lambda u, perms: holder.__setitem__(
        "principal",
        PlatformPrincipal(id=str(u.id), email=u.email, permissions=perms),
    )
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_platform_principal, None)


def _admin(pg_session):
    from app.models.tenancy import PlatformAdmin

    perms = ("platform.tenants.view", "platform.tenants.manage")
    user = User(email="pa@hermes.dev", full_name="PA",
                hashed_password="x", is_active=True)
    pg_session.add(user)
    pg_session.flush()
    pg_session.add(PlatformAdmin(user_id=user.id, permissions=list(perms),
                                 is_active=True))
    pg_session.commit()
    return user, perms


BASE = "/api/platform/v1"


def test_create_tenant_endpoint_works(platform_client, pg_session):
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)

    with patch.object(prov, "_project_to_core", return_value=None):
        resp = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme Industries",
            "owner_email": "owner@acme.com", "email_domains": "acme.com",
        })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["tenant"]["slug"] == "acme"
    assert body["workspace_hint"] == "/?workspace=acme"
    assert body["one_time_password"]      # yeni kullanici -> parola doner

    assert pg_session.query(Tenant).filter(Tenant.slug == "acme").count() == 1


def test_create_tenant_records_the_acting_admin(platform_client, pg_session):
    """Denetim kaydi GERCEK aktoru tasimali.

    `principal.id` kullanici kimligidir (token'a `user_id` yazilir).
    Yanlis alan okunursa uc 500 verir — canlida boyle oldu.
    """
    from app.models.tenancy import PlatformAuditEvent

    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)

    with patch.object(prov, "_project_to_core", return_value=None):
        platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme",
            "owner_email": "owner@acme.com",
        })

    event = pg_session.query(PlatformAuditEvent).filter(
        PlatformAuditEvent.action == "platform.tenant.provision"
    ).one()
    assert event.result == "success"
    assert str(event.actor_user_id) == str(user.id)


def test_update_tenant_endpoint_changes_plan_and_domains(platform_client,
                                                         pg_session):
    from app.models.tenancy import Plan

    pg_session.add(Plan(code="pro", display_name="Pro", is_active=True))
    pg_session.commit()
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)

    with patch.object(prov, "_project_to_core", return_value=None):
        created = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme",
            "owner_email": "owner@acme.com",
        }).json()
        resp = platform_client.patch(
            f"{BASE}/tenants/{created['tenant']['id']}",
            json={"display_name": "Acme Corp", "plan_code": "pro",
                  "email_domains": "acme.com"},
        )
    assert resp.status_code == 200, resp.text
    changed = resp.json()["changed"]
    assert changed["plan_code"] == "pro"
    assert changed["email_domains"] == ["acme.com"]

    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    pg_session.refresh(tenant)
    assert tenant.display_name == "Acme Corp"


def test_create_tenant_rejects_bad_input_with_400(platform_client, pg_session):
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)

    resp = platform_client.post(f"{BASE}/tenants", json={
        "slug": "admin", "display_name": "X",
        "owner_email": "x@y.com",
    })
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "provisioning_failed"


def test_plans_endpoint_lists_active_plans(platform_client, pg_session):
    from app.models.tenancy import Plan

    pg_session.add(Plan(code="pro", display_name="Pro", is_active=True))
    pg_session.add(Plan(code="old", display_name="Old", is_active=False))
    pg_session.commit()
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)

    plans = platform_client.get(f"{BASE}/plans").json()["plans"]
    codes = {p["code"] for p in plans}
    assert "pro" in codes and "old" not in codes


# =============================================================================
# 7) Workspace adresleme — acik slug HOST'U EZER
# =============================================================================
# Canli bir hatadan dogdu: cozucu once host'u deniyor, slug'a yalnizca
# host COZULEMEZSE bakiyordu. Dev tek IP uzerinden servis edildigi ve o
# IP her zaman ilk tenant'a cozuldugu icin `?workspace=acme` HIC
# degerlendirilmiyordu — kullanici sessizce YANLIS organizasyona
# dusuyordu.

def _mk_tenant(db, slug, hostname=None):
    from app.models.tenancy import Tenant, TenantDomain

    t = Tenant(slug=slug, display_name=slug.title(), status="active",
               placement_key="shared-default", version=1)
    db.add(t)
    db.flush()
    if hostname:
        db.add(TenantDomain(tenant_id=t.id, hostname=hostname, kind="legacy",
                            verification_status="verified", is_primary=True))
    db.commit()
    return t


def test_explicit_workspace_slug_wins_over_host(pg_session, monkeypatch):
    from app.services.tenant_resolver import resolve_request_tenant

    _mk_tenant(pg_session, "duosis", hostname="10.0.0.1")
    _mk_tenant(pg_session, "acme")
    monkeypatch.setenv("HERMES_ALLOW_WORKSPACE_PATH", "true")

    # Host duosis'e cozulur; slug ACIKCA acme der -> acme kazanmali.
    resolved = resolve_request_tenant(
        pg_session, hostname="10.0.0.1", workspace_slug="acme"
    )
    assert resolved.slug == "acme", (
        "acik slug host'a yenildi — kullanici YANLIS organizasyona duser"
    )


def test_host_used_when_no_slug_given(pg_session, monkeypatch):
    from app.services.tenant_resolver import resolve_request_tenant

    _mk_tenant(pg_session, "duosis", hostname="10.0.0.1")
    monkeypatch.setenv("HERMES_ALLOW_WORKSPACE_PATH", "true")

    resolved = resolve_request_tenant(pg_session, hostname="10.0.0.1")
    assert resolved.slug == "duosis"


def test_slug_ignored_when_feature_disabled(pg_session, monkeypatch):
    """PRODUCTION davranisi: bayrak kapaliyken host TEK otoritedir."""
    from app.services.tenant_resolver import resolve_request_tenant

    _mk_tenant(pg_session, "duosis", hostname="10.0.0.1")
    _mk_tenant(pg_session, "acme")
    monkeypatch.setenv("HERMES_ALLOW_WORKSPACE_PATH", "false")

    resolved = resolve_request_tenant(
        pg_session, hostname="10.0.0.1", workspace_slug="acme"
    )
    assert resolved.slug == "duosis"


def test_unknown_slug_fails_closed_not_silently_to_host(pg_session, monkeypatch):
    """Yanlis slug HOST'A GERI DUSMEZ.

    Sessizce host'a dusmek, kullaniciyi istemedigi bir organizasyona
    sokmak demektir — hicbir yere dusmemek dogrudur.
    """
    from app.services.tenant_resolver import (
        WorkspaceNotFound, resolve_request_tenant,
    )

    _mk_tenant(pg_session, "duosis", hostname="10.0.0.1")
    monkeypatch.setenv("HERMES_ALLOW_WORKSPACE_PATH", "true")

    with pytest.raises(WorkspaceNotFound):
        resolve_request_tenant(
            pg_session, hostname="10.0.0.1", workspace_slug="yok-boyle"
        )


# =============================================================================
# 8) Duzenleme / olusturma PARITESI
# =============================================================================

def test_update_can_add_admin_to_existing_tenant(platform_client, pg_session):
    """Olusturmada yapilabilen her sey duzenlemede de yapilabilmeli."""
    from app.models.rbac import RbacRole, RbacUserRole

    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)
    with patch.object(prov, "_project_to_core", return_value=None):
        created = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme",
            "owner_email": "owner@acme.com",
        }).json()
        resp = platform_client.patch(
            f"{BASE}/tenants/{created['tenant']['id']}",
            json={"owner_email": "ikinci@acme.com"},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["changed"]["owner_email"] == "ikinci@acme.com"
    assert body["one_time_password"]        # yeni kullanici -> parola

    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    new_user = pg_session.query(User).filter(
        User.email == "ikinci@acme.com").one()
    assert pg_session.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant.id,
        TenantMembership.user_id == new_user.id,
        TenantMembership.status == "active",
    ).count() == 1
    admin_role = pg_session.query(RbacRole).filter(
        RbacRole.tenant_id == tenant.id, RbacRole.code == "system-admin").one()
    assert pg_session.query(RbacUserRole).filter(
        RbacUserRole.user_id == new_user.id,
        RbacUserRole.role_id == admin_role.id).count() == 1


def test_adding_existing_user_never_resets_their_password(platform_client,
                                                          pg_session):
    """Var olan kullanicinin parolasi SIFIRLANMAZ.

    Baskasinin oturumunu sessizce dusurmek kabul edilemez.
    """
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)
    existing = User(email="var@acme.com", full_name="Var",
                    hashed_password="ORIJINAL-HASH", is_active=True)
    pg_session.add(existing)
    pg_session.commit()

    with patch.object(prov, "_project_to_core", return_value=None):
        created = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme",
            "owner_email": "owner@acme.com"}).json()
        body = platform_client.patch(
            f"{BASE}/tenants/{created['tenant']['id']}",
            json={"owner_email": "var@acme.com"}).json()

    assert body["one_time_password"] is None
    pg_session.refresh(existing)
    assert existing.hashed_password == "ORIJINAL-HASH"


def test_adding_same_admin_twice_is_idempotent(platform_client, pg_session):
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)
    with patch.object(prov, "_project_to_core", return_value=None):
        created = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme",
            "owner_email": "owner@acme.com"}).json()
        tid = created["tenant"]["id"]
        platform_client.patch(f"{BASE}/tenants/{tid}",
                              json={"owner_email": "ayni@acme.com"})
        platform_client.patch(f"{BASE}/tenants/{tid}",
                              json={"owner_email": "ayni@acme.com"})

    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    u = pg_session.query(User).filter(User.email == "ayni@acme.com").one()
    assert pg_session.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant.id,
        TenantMembership.user_id == u.id).count() == 1


# =============================================================================
# 9) Kullanici olusturma UYELIK yaratmali (canli bug)
# =============================================================================
# Cutover'dan sonra bir kimligin organizasyona erisimi YALNIZCA aktif
# uyelik satiriyla var. Olusturma uyelik yaratmayinca kullanici olusuyor,
# listede gorunuyor, ama giris "E-posta veya sifre hatali" ile
# reddediliyor ve rol atamasi "User not found" donuyor.

def test_created_user_gets_active_membership(pg_session):
    from app.models.tenancy import TenantMembership
    from app.schemas.user import UserCreate
    from app.services.user_service import UserService

    tenant = _mk_tenant(pg_session, "duosis", hostname="10.0.0.9")
    svc = UserService(pg_session)
    user = svc.create(
        UserCreate(email="yeni@duosis.com", full_name="Yeni",
                   password="guvenli123"),
        tenant_id=tenant.id,
    )
    m = pg_session.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant.id,
        TenantMembership.user_id == user.id,
    ).one()
    assert m.status == "active"


@pytest.fixture()
def signing(monkeypatch):
    """Gercek RS256 anahtar cifti — token uretimi icin gerekli."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from shared import auth as shared_auth

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
    monkeypatch.setattr(shared_auth, "SIGNING_KEY", private_pem)
    monkeypatch.setattr(shared_auth, "VERIFY_KEY", public_pem)
    return shared_auth


def test_created_user_can_actually_log_in(pg_session, signing):
    """ASIL kanit: olusturulan kullanici GIRIS YAPABILMELI.

    Uyelik satirini kontrol etmek yeterli degil — kullaniciyi ilgilendiren
    sey giris yapabilmesi. Bu test uyelik ile kimlik dogrulamayi BIRLIKTE
    kilitler.
    """
    from app.schemas.user import UserCreate
    from app.services.auth_service import AuthService
    from app.services.tenant_resolver import ResolvedTenant
    from app.services.user_service import UserService

    tenant = _mk_tenant(pg_session, "duosis", hostname="10.0.0.9")
    UserService(pg_session).create(
        UserCreate(email="giris@duosis.com", full_name="Giris",
                   password="guvenli123"),
        tenant_id=tenant.id,
    )
    resolved = ResolvedTenant(
        id=tenant.id, slug=tenant.slug, display_name=tenant.display_name,
        status=tenant.status,
    )
    token = AuthService(pg_session).authenticate(
        email="giris@duosis.com", password="guvenli123", tenant=resolved,
    )
    assert token.access_token
    assert token.user["email"] == "giris@duosis.com"


def test_created_user_can_receive_roles(pg_session):
    """Rol atamasi 'User not found' DONMEMELI."""
    from app.schemas.user import UserCreate
    from app.services import membership_service
    from app.services.user_service import UserService

    tenant = _mk_tenant(pg_session, "duosis", hostname="10.0.0.9")
    user = UserService(pg_session).create(
        UserCreate(email="rol@duosis.com", full_name="Rol",
                   password="guvenli123"),
        tenant_id=tenant.id,
    )
    # set_user_roles bu kontrolu yapip 404 uretiyordu.
    assert membership_service.get_active_membership(
        pg_session, tenant_id=tenant.id, user_id=user.id
    ) is not None
