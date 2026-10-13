"""
Public API + tenant modulleri (docs/tenant-platform/00-plan.md §2.3):
  - Gelistirici platformu KAPALI tenant'ta token calismaz (403
    resource_access_denied — donmus katalogdaki kod).
  - Kapali modulun scope'u efektif degildir (kayitli olsa bile).
"""
from tests.public_api.test_stage2b_auth import (  # noqa: F401 — fixture
    TEST_TENANT_ID, get_me, harness, make_client, make_token,
)


def test_developer_module_off_rejects_token(harness, tenant_modules):
    setter, http, _ = harness
    client = make_client()
    token, plaintext = make_token(client)
    setter(token, client)
    tenant_modules[TEST_TENANT_ID] = ["tickets"]
    r = get_me(http, plaintext)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "resource_access_denied"


def test_disabled_module_scopes_are_not_effective(harness, tenant_modules):
    setter, http, _ = harness
    client = make_client(scopes=["tasks:read", "work-logs:read", "customers:read"])
    token, plaintext = make_token(client)
    setter(token, client)
    tenant_modules[TEST_TENANT_ID] = ["developer", "time_entry"]
    r = get_me(http, plaintext)
    assert r.status_code == 200, r.text
    assert sorted(r.json()["scopes"]) == ["customers:read", "work-logs:read"]
