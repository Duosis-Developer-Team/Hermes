# =============================================================================
# HERMES core - RBAC R2 enforcement testleri
# =============================================================================
# Uc kilit:
#   1. ROUTE-WALK ENVANTERI: admin yuzeyindeki her route izin beyan
#      etmek ZORUNDA ve beyan edilen izin bu dosyadaki envanterle
#      birebir ayni. Yeni admin ucu eklemek = envantere bilincli kayit
#      (LogiSlot'un "guard'siz endpoint sessizce acik" zaafinin onlemi;
#      3E surface-lock gelenegimizin RBAC hali).
#   2. Guard semantigi: izinli 2xx-yolu / izinsiz 403 / authz-kapali 503;
#      JWT is_admin claim'i HICBIR karari etkilemez.
#   3. Sentezlenmis public-API aktoru: ADMIN/GUARD izin cozumu hic
#      yapilmaz (user_permissions bos kume; tasks.admin API'ye devrolmaz).
#      RBAC cutover (2026-08-04) NOTU: task-modulu OPERASYONEL izinleri
#      (tasks.access/assign, issues.*) bagli kullanicinin ham-UUID'siyle
#      BILEREK cozulur — API, kullanicinin kendi yetkileriyle calisir;
#      bypass ayricaligi tasinmaz (asagida ayrica testli).
# =============================================================================

import uuid

import httpx
import pytest

from shared.auth import CurrentUser
from shared.permissions import ALL_PERMISSIONS, Perm

from app.services import authz_client

# WS3: CurrentUser artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"


# ── Sahte authz upstream ───────────────────────────────────────────────


@pytest.fixture()
def fake_authz(monkeypatch):
    """authz_client'a sahte auth-service enjekte eder. grants dict'i:
    user_id(str) -> izin listesi. Kayitli olmayan kullanici bos alir."""
    grants: dict = {}
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        import json as _json

        if (request.url.host == "auth-service"
                and request.url.path == "/internal/authz/resolve"
                and request.method == "POST"):
            ids = _json.loads(request.content)["user_ids"]
            return httpx.Response(200, json={
                "users": [
                    {"id": i, "permissions": grants.get(i, [])}
                    for i in ids
                ]
            })
        return httpx.Response(404, json={"detail": "Not Found"})

    authz_client.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    authz_client.clear_cache()
    monkeypatch.setattr(
        authz_client.get_settings(), "AUTH_SERVICE_URL",
        "http://auth-service/api/v1",
    )
    monkeypatch.setattr(
        authz_client.get_settings(), "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )
    yield grants
    authz_client.set_client_factory(lambda: httpx.Client(timeout=5))
    authz_client.clear_cache()


def _user(perms=None, *, is_admin_claim=False, fake_authz=None):
    u = CurrentUser(
        id=str(uuid.uuid4()), email="t@x.com", is_admin=is_admin_claim,
        tenant_id=TEST_TENANT_ID,
    )
    if fake_authz is not None and perms is not None:
        fake_authz[u.id] = list(perms)
    return u


# ── 1. Route-walk envanteri ────────────────────────────────────────────

# Internal app'in RBAC-korumali yuzeyi: (METHOD, path) -> izin demeti.
# Bu envanter BILINCLI olarak elle tutulur — degisiklik = API karari.
EXPECTED_GUARDS = {
    # task_admin.py — tasks.permissions.manage (18)
    # RBAC cutover: asagidaki 7 legacy access/assign ucu 410 Gone doner
    # ama GUARD'lari korunur (yetkisiz cagiran 403/503 almaya devam eder).
    ("GET", "/api/v1/core/admin/task-permissions/users"),
    ("PUT", "/api/v1/core/admin/task-permissions/users/{user_id}"),
    ("GET", "/api/v1/core/admin/task-permissions/effective"),
    ("POST", "/api/v1/core/admin/task-permissions/rbac-backfill"),
    ("GET", "/api/v1/core/admin/task-assignment-relations"),
    ("POST", "/api/v1/core/admin/task-assignment-relations"),
    ("DELETE", "/api/v1/core/admin/task-assignment-relations/{relation_id}"),
    ("GET", "/api/v1/core/admin/task-assignment-group-relations"),
    ("POST", "/api/v1/core/admin/task-assignment-group-relations"),
    ("DELETE",
     "/api/v1/core/admin/task-assignment-group-relations/{relation_id}"),
    ("POST", "/api/v1/core/admin/tasks/sub-projects"),
    ("PUT", "/api/v1/core/admin/tasks/sub-projects/{sub_project_id}"),
    ("DELETE", "/api/v1/core/admin/tasks/sub-projects/{sub_project_id}"),
    ("GET", "/api/v1/core/admin/task-permissions/groups"),
    ("PUT", "/api/v1/core/admin/task-permissions/groups/{group_id}"),
    ("GET",
     "/api/v1/core/admin/task-permissions/groups/{group_id}/member-overrides"),
    ("PUT",
     "/api/v1/core/admin/task-permissions/groups/{group_id}/member-overrides/{user_id}"),
    ("GET", "/api/v1/core/admin/notification-settings"),
    ("PUT", "/api/v1/core/admin/notification-settings/{task_type}"),
}


def test_admin_surface_declares_permissions():
    """/admin altindaki HER route ya require_permissions tasir ya da bu
    testte bilerek listelenmis bir istisnadir (istisna: YOK). Ayrica
    task_admin envanteri path bazinda birebir dogrulanir."""
    from app.main import app

    admin_routes = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if "/admin" not in path or not hasattr(route, "dependant"):
            continue
        declared = _declared_permissions(route)
        admin_routes.append((path, sorted(route.methods), declared))
        assert declared, (
            f"GUARD YOK: {route.methods} {path} — /admin yuzeyinde izin "
            "beyani zorunlu (require_permissions ile)."
        )

    # task_admin yuzeyi birebir: her biri tasks.permissions.manage.
    seen = {
        (m, path)
        for path, methods, declared in admin_routes
        for m in methods
        if m != "HEAD" and declared == (Perm.TASK_PERMISSIONS_MANAGE,)
    }
    missing = EXPECTED_GUARDS - seen
    assert not missing, f"Envanterde olup guard'i farkli/yok: {missing}"


def _declared_permissions(route):
    """Route'un dependency agacindan _rbac_permissions niteligini soker."""
    for dep in route.dependant.dependencies:
        call = getattr(dep, "call", None)
        marked = getattr(call, "_rbac_permissions", None)
        if marked:
            return tuple(marked)
    # Parametre-dependency'leri (Depends(...) imza icinde) icin de gez.
    stack = list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        call = getattr(d, "call", None)
        marked = getattr(call, "_rbac_permissions", None)
        if marked:
            return tuple(marked)
        stack.extend(d.dependencies)
    return ()


def test_every_guarded_route_uses_catalog_permissions():
    """Beyan edilen her izin katalogda olmali (yazim hatasi = kirmizi)."""
    from app.main import app

    for route in app.routes:
        if not hasattr(route, "dependant"):
            continue
        declared = _declared_permissions(route)
        for code in declared:
            assert code in ALL_PERMISSIONS, (
                f"{route.path}: katalog disi izin '{code}'"
            )


# ── 2. Guard semantigi ─────────────────────────────────────────────────


def test_admin_claim_is_ignored_by_core_guards(fake_authz):
    """is_admin=True CLAIM'i tasiyan ama izni olmayan kullanici 403 —
    JWT claim'i core'da karar mercii DEGIL."""
    from app.authz import require_permissions
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient
    from shared.auth import get_current_user

    app = FastAPI()

    @app.get("/probe", dependencies=[
        Depends(require_permissions(Perm.CUSTOMERS_MANAGE))
    ])
    def probe():
        return {"ok": True}

    claim_admin = _user(perms=[], is_admin_claim=True,
                        fake_authz=fake_authz)
    app.dependency_overrides[get_current_user] = lambda: claim_admin
    c = TestClient(app, raise_server_exceptions=False)
    assert c.get("/probe").status_code == 403

    granted = _user(perms=[Perm.CUSTOMERS_MANAGE], fake_authz=fake_authz)
    app.dependency_overrides[get_current_user] = lambda: granted
    assert c.get("/probe").status_code == 200


def test_authz_unavailable_guard_returns_503(monkeypatch):
    from app.authz import require_permissions
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient
    from shared.auth import get_current_user

    def boom(request):
        raise httpx.ConnectError("down")

    authz_client.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(boom))
    )
    authz_client.clear_cache()
    monkeypatch.setattr(
        authz_client.get_settings(), "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )

    app = FastAPI()

    @app.get("/probe", dependencies=[
        Depends(require_permissions(Perm.CUSTOMERS_MANAGE))
    ])
    def probe():
        return {"ok": True}

    app.dependency_overrides[get_current_user] = lambda: _user()
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/probe")
    assert r.status_code == 503
    authz_client.set_client_factory(lambda: httpx.Client(timeout=5))
    authz_client.clear_cache()


def test_user_has_fails_closed_on_authz_outage(monkeypatch):
    """Gorunurluk yolu: authz kesintisinde user_has False doner —
    kullanici admin-genisletmesi olmadan calisir, yetki ACILMAZ."""
    from app.authz import user_has

    def boom(request):
        raise httpx.ConnectError("down")

    authz_client.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(boom))
    )
    authz_client.clear_cache()
    monkeypatch.setattr(
        authz_client.get_settings(), "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )
    assert user_has(_user(), Perm.TASKS_ADMIN) is False
    authz_client.set_client_factory(lambda: httpx.Client(timeout=5))
    authz_client.clear_cache()


def test_is_task_admin_now_permission_based(fake_authz):
    from app.services.task_service import is_task_admin

    with_perm = _user(perms=[Perm.TASKS_ADMIN], fake_authz=fake_authz)
    claim_only = _user(perms=[], is_admin_claim=True,
                       fake_authz=fake_authz)
    assert is_task_admin(with_perm) is True
    assert is_task_admin(claim_only) is False


def test_permissions_are_cached_for_ttl(fake_authz):
    """60 sn icinde ayni kullanici icin TEK upstream cagri."""
    from app.authz import user_has

    u = _user(perms=[Perm.REPORTS_VIEW], fake_authz=fake_authz)
    assert user_has(u, Perm.REPORTS_VIEW)
    assert user_has(u, Perm.REPORTS_VIEW)
    assert user_has(u, Perm.REPORTS_VIEW)
    # fake_authz fixture'inin calls listesine erisim: handler closure'u
    # grants uzerinden takip edilemez; cagri sayisini cache'in ikinci
    # cozumu tetiklememesiyle dogrulariz.
    from app.services.authz_client import _cache

    # WS3: cache anahtari (tenant_id, user_id) — ayni kimligin A'daki
    # izinleri B'de servis edilemez.
    assert (u.tenant_id, u.id) in _cache
    assert u.id not in _cache


# ── 3. Sentezlenmis public-API aktoru ──────────────────────────────────


def test_public_api_actor_never_resolves_rbac(fake_authz):
    """actor_of'un urettigi CurrentUser: bagli kullaniciya TUM izinler
    verilmis olsa bile RBAC cozumu yapilmaz, her kontrol False."""
    from app.authz import user_has, user_permissions

    bound_user_id = str(uuid.uuid4())
    fake_authz[bound_user_id] = list(ALL_PERMISSIONS)  # gercek kullanici ALL

    synthesized = CurrentUser(
        id=bound_user_id,
        email="api-client-x@hermes.internal",
        is_admin=False,
        allow_rbac_resolution=False,
    tenant_id=TEST_TENANT_ID)
    assert user_permissions(synthesized) == frozenset()
    assert user_has(synthesized, Perm.TASKS_ADMIN) is False


def test_actor_of_sets_resolution_off():
    """writes.actor_of yapisal kilit: alan False olmak ZORUNDA."""
    import inspect

    from app.public_api import writes

    src = inspect.getsource(writes.actor_of)
    assert "allow_rbac_resolution=False" in src


def test_is_task_admin_false_for_synthesized_actor(fake_authz):
    from app.services.task_service import is_task_admin

    bound = str(uuid.uuid4())
    fake_authz[bound] = list(ALL_PERMISSIONS)
    synthesized = CurrentUser(
        id=bound, email="api-client-y@hermes.internal",
        is_admin=False, allow_rbac_resolution=False,
    tenant_id=TEST_TENANT_ID)
    assert is_task_admin(synthesized) is False


def test_synthesized_actor_uses_bound_users_operational_perms(fake_authz):
    """RBAC cutover: bagli kullanicinin tasks.access/assign izinleri
    public aktorde GECERLIDIR (ham-UUID cozumu) — ama tasks.admin
    ayricaligi (is_task_admin) devrolmaz. Boylece API token'i
    kullanicinin kendi yetki kapsamini asamaz."""
    from app.services.task_service import can_access, can_assign, is_task_admin

    bound = str(uuid.uuid4())
    fake_authz[bound] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN,
                        Perm.TASKS_ADMIN]
    synthesized = CurrentUser(
        id=bound, email="api-client-z@hermes.internal",
        is_admin=False, allow_rbac_resolution=False,
    tenant_id=TEST_TENANT_ID)
    # Operasyonel yetenekler bagli kullanicidan gelir…
    assert can_access(None, synthesized, "task") is True
    assert can_assign(None, synthesized, "task") is True
    # …ama admin bypass'i TASINMAZ.
    assert is_task_admin(synthesized) is False
    # Yalniz-admin kullanicinin token'i operasyonel yetki DE almaz.
    only_admin = str(uuid.uuid4())
    fake_authz[only_admin] = [Perm.TASKS_ADMIN]
    actor2 = CurrentUser(
        id=only_admin, email="api-client-q@hermes.internal",
        is_admin=False, allow_rbac_resolution=False,
    tenant_id=TEST_TENANT_ID)
    assert can_access(None, actor2, "task") is False
    assert can_assign(None, actor2, "task") is False
