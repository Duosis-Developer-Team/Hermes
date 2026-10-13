# =============================================================================
# Tenant modulleri (docs/tenant-platform/00-plan.md §2) — auth tarafi
# =============================================================================
# Kilitlenen sozlesmeler:
#   1. Yeni tenant varsayilan TUM katalogla acilir; secim verilirse o yazilir;
#      gecersiz secim (bilinmeyen / bagimlilik) tenant ACMAZ.
#   2. Core projeksiyonu modul listesini TASIR.
#   3. Efektif izinler ACIK modullerle kesisir: system-admin bile kapali
#      modulun iznini alamaz; cekirdek izinler kalir.
#   4. Platform PATCH modulleri degistirir, gecersiz secim 400; ozet modulleri
#      gosterir.
#   5. /users/me tenant.modules dondurur.
# =============================================================================

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.models.tenancy import Tenant
from app.models.user import User
from app.services import tenant_provisioning as prov
from app.services.rbac_service import effective_permissions
from shared.modules import ALL_MODULES
from shared.permissions import Perm

from tests.test_tenant_provisioning import BASE, _admin, platform_client  # noqa: F401


@pytest.fixture(autouse=True)
def _clean(pg_session):
    from sqlalchemy import text as sa_text

    pg_session.execute(sa_text(
        "TRUNCATE tenants, tenant_provisioning_operations, plans, "
        "platform_audit_events CASCADE"
    ))
    pg_session.commit()
    yield


def _provision(db, **kw):
    params = dict(slug="acme", display_name="Acme", owner_email="owner@acme.com")
    params.update(kw)
    with patch.object(prov, "_project_to_core", return_value=None):
        result = prov.provision_tenant(db, **params)
    db.commit()
    return result


def test_new_tenant_defaults_to_full_catalog(pg_session):
    result = _provision(pg_session)
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    assert tenant.enabled_modules == list(ALL_MODULES)
    assert result["tenant"]["modules"] == list(ALL_MODULES)


def test_selected_modules_are_stored_in_catalog_order(pg_session):
    _provision(pg_session, modules=["tickets", "time_entry"])
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    assert tenant.enabled_modules == ["time_entry", "tickets"]


@pytest.mark.parametrize("bad", [["payroll"], ["reports"]])
def test_invalid_selection_does_not_open_tenant(pg_session, bad):
    with pytest.raises(prov.ProvisioningError):
        _provision(pg_session, modules=bad)
    assert pg_session.query(Tenant).filter(Tenant.slug == "acme").count() == 0


def test_projection_carries_modules(pg_session, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "HERMES_S2S_TOKEN_CURRENT", "s2s-" + "t" * 40)
    tenant = Tenant(slug="x", display_name="X", status="active", version=3,
                    enabled_modules=["tickets"])
    fake = MagicMock(return_value=MagicMock(status_code=200))
    with patch.object(prov.httpx, "post", fake):
        prov._project_to_core(tenant)
    body = fake.call_args.kwargs["json"]
    assert body["enabled_modules"] == ["tickets"]
    assert body["source_version"] == 3


def test_effective_permissions_follow_modules(pg_session):
    _provision(pg_session, modules=["tickets"])
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    owner = pg_session.query(User).filter(User.email == "owner@acme.com").one()
    perms = effective_permissions(pg_session, owner.id, tenant_id=tenant.id)
    # system-admin: talep izinleri + cekirdek; kapali modullerin izni YOK.
    assert Perm.TICKETS_ADMIN in perms and Perm.USERS_MANAGE in perms
    for denied in (Perm.TASKS_ACCESS, Perm.REPORTS_VIEW, Perm.WORKLOGS_ADMIN,
                   Perm.MEETINGS_ADMIN, Perm.API_MANAGE):
        assert denied not in perms, denied
    # Modul acilinca izin geri gelir (rol degismeden).
    tenant.enabled_modules = list(ALL_MODULES)
    pg_session.commit()
    assert Perm.TASKS_ACCESS in effective_permissions(pg_session, owner.id, tenant_id=tenant.id)


def test_platform_patch_changes_modules(platform_client, pg_session):
    user, perms = _admin(pg_session)
    platform_client.as_admin(user, perms)
    with patch.object(prov, "_project_to_core", return_value=None):
        created = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme", "owner_email": "o@acme.com",
            "modules": ["tickets"],
        }).json()
        tid = created["tenant"]["id"]
        assert created["tenant"]["modules"] == ["tickets"]

        r = platform_client.patch(f"{BASE}/tenants/{tid}",
                                  json={"modules": ["work", "tickets"]})
        assert r.status_code == 200, r.text
        assert r.json()["changed"]["modules"] == ["work", "tickets"]

        bad = platform_client.patch(f"{BASE}/tenants/{tid}", json={"modules": ["reports"]})
        assert bad.status_code == 400
        assert bad.json()["detail"]["code"] == "invalid_modules"

    detail = platform_client.get(f"{BASE}/tenants/{tid}").json()
    summary = detail.get("tenant", detail)
    assert summary["modules"] == ["work", "tickets"]


def test_users_me_returns_tenant_modules(pg_session):
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app
    from shared.auth import CurrentUser, get_current_user

    _provision(pg_session, modules=["tickets", "meetings"])
    tenant = pg_session.query(Tenant).filter(Tenant.slug == "acme").one()
    owner = pg_session.query(User).filter(User.email == "owner@acme.com").one()
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(owner.id), email=owner.email, full_name="O", is_admin=False,
        tenant_id=str(tenant.id), membership_id=str(uuid.uuid4()),
    )
    try:
        body = TestClient(app).get("/api/v1/auth/users/me").json()
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
    assert body["tenant"]["modules"] == ["meetings", "tickets"]
