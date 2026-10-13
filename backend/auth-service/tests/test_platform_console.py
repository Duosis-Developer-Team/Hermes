# =============================================================================
# Faz 2 — Super-admin konsolu arka ucu (docs/tenant-platform/00-plan.md §3)
# =============================================================================
#   1. Talep agi baglantisi kur/kapat DENETIM yazar; core'a GUNCEL adlar ve
#      aktor gider; core'un makine-okur hata kodu ekrana tasinir.
#   2. Tenant uyeleri: kimlik + uyelik + yonetici bayragi; is verisi YOK.
#   3. Duzenlemede iyimser kilit: eski surumle PATCH → 409.
#   4. Bilinmeyen plan kodu temiz 400 (FK hatasi degil).
# =============================================================================

from unittest.mock import patch

import pytest

from app.models.tenancy import PlatformAuditEvent, Tenant
from app.services import core_support_client as core_support
from app.services import tenant_provisioning as prov

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


@pytest.fixture()
def admin_client(platform_client, pg_session):
    user, _ = _admin(pg_session)
    platform_client.as_admin(user, ("platform.tenants.view", "platform.tenants.manage",
                                    "platform.audit.view"))
    with patch.object(prov, "_project_to_core", return_value=None):
        created = platform_client.post(f"{BASE}/tenants", json={
            "slug": "acme", "display_name": "Acme", "owner_email": "owner@acme.com",
        }).json()
    platform_client.tenant_id = created["tenant"]["id"]
    return platform_client


def _provider(admin_client):
    with patch.object(prov, "_project_to_core", return_value=None):
        return admin_client.post(f"{BASE}/tenants", json={
            "slug": "intertech", "display_name": "Intertech",
            "owner_email": "owner@intertech.com",
        }).json()["tenant"]["id"]


def test_network_link_toggle_is_audited(admin_client, pg_session):
    req = admin_client.tenant_id
    prov_id = _provider(admin_client)
    group = "11111111-1111-1111-1111-111111111111"
    with patch.object(core_support, "set_link",
                      return_value={"route_version": 2, "version": 1}) as call:
        r = admin_client.put(f"{BASE}/support/network/{req}/{prov_id}",
                             json={"group_id": group})
    assert r.status_code == 200, r.text
    kwargs = call.call_args.kwargs
    assert kwargs["requester_display_name"] == "Acme"
    assert kwargs["provider_display_name"] == "Intertech"
    assert kwargs["group_id"] == group and kwargs["actor_id"]
    with patch.object(core_support, "disable_link",
                      return_value={"is_active": False}):
        r = admin_client.delete(f"{BASE}/support/network/{req}/{prov_id}")
    assert r.status_code == 200, r.text
    events = {e.action: e for e in pg_session.query(PlatformAuditEvent).all()}
    assert "support.network.linked" in events
    assert "support.network.unlinked" in events
    assert str(events["support.network.linked"].target_tenant_id) == req


def test_network_core_error_code_reaches_console(admin_client):
    req = admin_client.tenant_id
    prov_id = _provider(admin_client)
    err = core_support.CoreSupportError(
        "The provider workspace must be active with the Tickets module enabled.",
        status_code=409, code="provider_unavailable",
    )
    with patch.object(core_support, "set_link", side_effect=err):
        r = admin_client.put(
            f"{BASE}/support/network/{req}/{prov_id}",
            json={"group_id": "11111111-1111-1111-1111-111111111111"},
        )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "provider_unavailable"


def test_network_unknown_tenant_is_404(admin_client):
    r = admin_client.put(
        f"{BASE}/support/network/{admin_client.tenant_id}/"
        "22222222-2222-2222-2222-222222222222",
        json={"group_id": "11111111-1111-1111-1111-111111111111"},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_tenant"


def test_members_list_is_identity_metadata_only(admin_client):
    body = admin_client.get(f"{BASE}/tenants/{admin_client.tenant_id}/members").json()
    assert len(body["members"]) == 1
    m = body["members"][0]
    assert m["email"] == "owner@acme.com" and m["is_admin"] is True and m["status"] == "active"
    assert set(m) == {"user_id", "email", "full_name", "status", "is_admin", "joined_at"}


def test_stale_version_patch_is_409(admin_client, pg_session):
    tid = admin_client.tenant_id
    version = pg_session.query(Tenant.version).filter(Tenant.slug == "acme").scalar()
    with patch.object(prov, "_project_to_core", return_value=None):
        ok = admin_client.patch(f"{BASE}/tenants/{tid}", json={
            "display_name": "Acme Corp", "expected_version": version})
        assert ok.status_code == 200, ok.text
        stale = admin_client.patch(f"{BASE}/tenants/{tid}", json={
            "display_name": "Acme Again", "expected_version": version})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "version_conflict"


def test_unknown_plan_is_clean_400(admin_client):
    with patch.object(prov, "_project_to_core", return_value=None):
        r = admin_client.patch(f"{BASE}/tenants/{admin_client.tenant_id}",
                               json={"plan_code": "nope"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "unknown_plan"
