"""
=============================================================================
Tenant modulleri (docs/tenant-platform/00-plan.md §2)
=============================================================================
Kilitlenen sozlesmeler:
  1. Katalog: bilinmeyen kod ve eksik bagimlilik reddedilir; secim katalog
     sirasinda; izin filtresi yalniz KAPALI modullerin izinlerini dusurur.
  2. Projeksiyon: auth'tan gelen modul listesi tenant_registry'ye yazilir;
     liste GELMEZSE (eski auth) mevcut deger korunur; gecersiz liste 422.
  3. Kapi: modulu kapali tenant'ta o modulun router'i 404; cekirdek
     (musteri, proje, proje turu) acik kalir.
  4. Ana sayfa: is modulu kapaliysa (yonetici atlamasi dahil) is verisi yok;
     toplanti + is kapaliysa haftalik uc 404.
  5. Gercek okuma: tenant_registry varsayilani TUM katalog (migration).
=============================================================================
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from shared.auth import CurrentUser, get_current_user
from shared.modules import (
    ALL_MODULES, ModuleSelectionError, filter_permissions, normalize,
)
from shared.permissions import Perm
from app import module_gate
from app.database import get_db
from app.main import app
from app.tenant_db import get_tenant_db

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
USER = uuid.UUID("00000000-0000-4000-8000-0000000040a1")
CORE = "/api/v1/core"


# =============================================================================
# 1) Katalog — DB yok
# =============================================================================

def test_normalize_orders_and_validates():
    assert normalize(["tickets", "time_entry", "tickets"]) == ["time_entry", "tickets"]
    assert normalize([]) == []
    with pytest.raises(ModuleSelectionError):
        normalize(["payroll"])
    # Raporlar zaman girisi verisinden uretilir.
    with pytest.raises(ModuleSelectionError):
        normalize(["reports"])
    assert normalize(["reports", "time_entry"]) == ["time_entry", "reports"]


def test_filter_permissions_drops_only_disabled_module_permissions():
    perms = {Perm.TASKS_ACCESS, Perm.TICKETS_ACCESS, Perm.USERS_MANAGE, Perm.REPORTS_VIEW}
    out = filter_permissions(perms, ["tickets"])
    assert out == {Perm.TICKETS_ACCESS, Perm.USERS_MANAGE}   # cekirdek izin kalir
    assert filter_permissions(perms, ALL_MODULES) == perms


# =============================================================================
# 2) Kapi + ana sayfa — HTTP
# =============================================================================

@pytest.fixture()
def http(pg_session, authz_grants):
    authz_grants[str(USER)] = [Perm.TASKS_ACCESS, Perm.TICKETS_ACCESS]
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_tenant_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(USER), email="m@x.com", full_name="M", is_admin=True,
        tenant_id=TEST_TENANT_ID,
    )
    yield TestClient(app, raise_server_exceptions=False)
    for dep in (get_db, get_tenant_db, get_current_user):
        app.dependency_overrides.pop(dep, None)


GATED = ("/work-logs/my-logs", "/meetings", "/capacity/week", "/work-types",
         "/views", "/dashboard", "/admin/api-clients")


def test_gated_paths_exist_when_modules_enabled(http):
    # Kontrol: ayni yollar moduller ACIKKEN 404 degil (yanlis yol testi
    # yanlislikla gecirmesin).
    for path in GATED:
        assert http.get(CORE + path).status_code != 404, path


def test_disabled_module_routers_are_404_core_stays_open(http, tenant_modules):
    tenant_modules[TEST_TENANT_ID] = ["tickets"]
    for path in GATED:
        r = http.get(CORE + path)
        assert r.status_code == 404, (path, r.status_code, r.text)
    for path in ("/customers", "/projects", "/project-types"):
        assert http.get(CORE + path).status_code == 200, path


def test_enabled_module_is_reachable(http, tenant_modules):
    tenant_modules[TEST_TENANT_ID] = ["time_entry"]
    assert http.get(CORE + "/work-types").status_code == 200
    assert http.get(CORE + "/meetings").status_code == 404


def test_home_respects_modules_even_for_admin(http, tenant_modules):
    # Is yonetimi kapali: yonetici (is_admin) olsa bile is verisi yok.
    tenant_modules[TEST_TENANT_ID] = ["meetings"]
    assert http.get(CORE + "/home/my-work").status_code == 403
    week = http.get(CORE + "/home/week")
    assert week.status_code == 200
    assert all(d["items"] == [] for d in week.json()["days"])
    assert http.get(CORE + "/home/team").json()["eligible"] is False
    # Toplanti da is de kapali: haftalik uc yok.
    tenant_modules[TEST_TENANT_ID] = ["tickets"]
    assert http.get(CORE + "/home/week").status_code == 404


# =============================================================================
# 3) Projeksiyon + gercek okuma — S2S
# =============================================================================

S2S = "s2s-test-" + "m" * 40


@pytest.fixture()
def s2s(pg_session, monkeypatch):
    from app.routers import internal_tenants

    monkeypatch.setattr(internal_tenants.get_settings(), "HERMES_S2S_TOKEN_CURRENT", S2S)
    app.dependency_overrides[get_db] = lambda: pg_session
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_db, None)


def _project(client, tenant_id, version, modules="__omit__"):
    body = {"tenant_id": tenant_id, "slug": f"mod-{tenant_id[-4:]}", "status": "active",
            "source_version": version}
    if modules != "__omit__":
        body["enabled_modules"] = modules
    return client.post("/internal/tenants/projection", json=body,
                       headers={"Authorization": f"Bearer {S2S}"})


def test_projection_writes_keeps_and_validates_modules(s2s, pg_session):
    tid = str(uuid.uuid4())
    read = lambda: set(module_gate.read_tenant_modules(pg_session, tid))  # noqa: E731

    # Yeni satir, liste yok → TUM katalog (varsayilan).
    assert _project(s2s, tid, 1).status_code == 200
    assert read() == set(ALL_MODULES)

    assert _project(s2s, tid, 2, ["tickets"]).json()["applied"] is True
    assert read() == {"tickets"}

    # Eski auth surumu listeyi gondermez: mevcut deger KORUNUR.
    assert _project(s2s, tid, 3).json()["applied"] is True
    assert read() == {"tickets"}

    # Gecersiz secim (bagimlilik) reddedilir, deger degismez.
    assert _project(s2s, tid, 4, ["reports"]).status_code == 422
    assert read() == {"tickets"}


def test_registry_default_is_full_catalog(pg_session):
    row = pg_session.execute(sa_text(
        "SELECT enabled_modules FROM tenant_registry WHERE tenant_id = CAST(:t AS uuid)"
    ), {"t": TEST_TENANT_ID}).scalar()
    assert set(row) == set(ALL_MODULES)
    assert module_gate.read_tenant_modules(pg_session, "not-a-uuid") == frozenset()
