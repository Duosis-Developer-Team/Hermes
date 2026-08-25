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
        "TRUNCATE tenants, tenant_provisioning_operations, plans CASCADE"
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
