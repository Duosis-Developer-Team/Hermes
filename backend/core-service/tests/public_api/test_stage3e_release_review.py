# =============================================================================
# HERMES - Stage 3E: release-candidate review sweep
# =============================================================================
# Amac: Public API v1 yuzeyini SOZLESME olarak kilitlemek. Bu testler
# kirilirsa ya bilincli bir API karari verilmistir (envanteri guncelle)
# ya da istenmeyen bir yuzey degisikligi olmustur (regresyon).
#
# Kapsam: endpoint envanteri, auth zorunlulugu, scope dokumantasyonu,
# hata zarfi tutarliligi, internal sema sizintisi, pagination/sort/
# idempotency dokumantasyon tutarliligi, kesif endpoint'leri.
# =============================================================================

import json as _json
import re
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.public_api.errors import ERROR_DOCS, ERROR_STATUS
from app.public_api.scopes import SCOPES

from .test_stage3a_tasks_read import make_api_client

BASE = "/api/public"

# ── Yuzey envanteri: Public API v1'in TAMAMI ────────────────────────────
# Yeni endpoint eklemek/kaldirmak bilincli API kararidir; bu kume onunla
# birlikte guncellenir.
SURFACE = {
    ("/v1/health", "get"),
    ("/v1/capabilities", "get"),
    ("/v1/me", "get"),
    ("/v1/tasks", "get"),
    ("/v1/tasks", "post"),
    ("/v1/tasks/{task_code}", "get"),
    ("/v1/tasks/{task_code}", "patch"),
    ("/v1/tasks/{task_code}/activity", "get"),
    ("/v1/tasks/{task_code}/comments", "get"),
    ("/v1/tasks/{task_code}/comments", "post"),
    ("/v1/tasks/{task_code}/complete", "post"),
    ("/v1/tasks/{task_code}/status", "post"),
    ("/v1/customers", "get"),
    ("/v1/customers/{customer_id}", "get"),
    ("/v1/projects", "get"),
    ("/v1/projects/{project_id}", "get"),
    ("/v1/work-logs", "get"),
    ("/v1/work-logs", "post"),
    ("/v1/work-logs/{log_id}", "get"),
    ("/v1/meetings", "get"),
    ("/v1/meetings/{meeting_id}", "get"),
}

# Kimlik dogrulamasiz erisilebilen kesif endpoint'leri.
PUBLIC_DISCOVERY = {("/v1/health", "get"), ("/v1/capabilities", "get")}
# Auth isteyen ama scope istemeyen endpoint'ler.
NO_SCOPE_REQUIRED = {("/v1/me", "get")}
# Katalogda olup v1'de bilerek endpoint'i olmayan scope'lar.
RESERVED_SCOPES = {"users:read", "groups:read"}

_PATH_PARAM_SAMPLES = {
    "task_code": "TASK-1",
    "customer_id": str(uuid.uuid4()),
    "project_id": str(uuid.uuid4()),
    "meeting_id": str(uuid.uuid4()),
    "log_id": "1",
}

# HTTP metodlari disindaki OpenAPI path-item anahtarlari.
_NON_METHOD_KEYS = {"parameters", "summary", "description", "servers"}


@pytest.fixture()
def public_http(pg_session):
    from app.main import app

    public_app = next(
        r.app for r in app.routes if getattr(r, "path", "") == "/api/public"
    )
    public_app.dependency_overrides[get_db] = lambda: pg_session
    http = TestClient(app, raise_server_exceptions=False)
    yield http
    public_app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def spec(public_http):
    r = public_http.get(f"{BASE}/v1/openapi.json")
    assert r.status_code == 200
    return r.json()


def _operations(spec):
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method in _NON_METHOD_KEYS or not isinstance(op, dict):
                continue
            yield path, method, op


def _concrete(path_template: str) -> str:
    out = path_template
    for name, sample in _PATH_PARAM_SAMPLES.items():
        out = out.replace("{%s}" % name, sample)
    assert "{" not in out, f"unmapped path param in {path_template}"
    return out


# ── 1. Yuzey envanteri ──────────────────────────────────────────────────


def test_surface_inventory_is_locked(spec):
    """Spec'teki path+method kumesi SURFACE ile birebir ayni olmali.
    DELETE/PUT hicbir kaynakta yok."""
    actual = {(p, m) for p, m, _ in _operations(spec)}
    assert actual == SURFACE
    assert not any(m in ("delete", "put") for _, m in actual)


# ── 2. Auth zorunlulugu (token'siz süpürme) ─────────────────────────────


def test_every_endpoint_requires_auth_except_discovery(public_http, spec):
    """Kesif endpoint'leri haric HER operasyon token'siz 401 zarfi doner;
    zarf anahtarlari birebir {code, message, request_id}."""
    for path, method, _ in _operations(spec):
        if (path, method) in PUBLIC_DISCOVERY:
            continue
        url = f"{BASE}{_concrete(path)}"
        kwargs = {"json": {}} if method in ("post", "patch") else {}
        r = getattr(public_http, method)(url, **kwargs)
        assert r.status_code == 401, (path, method, r.status_code)
        body = r.json()
        assert set(body.keys()) == {"error"}, (path, method)
        assert set(body["error"].keys()) == {
            "code",
            "message",
            "request_id",
        }, (path, method)
        assert body["error"]["code"] == "invalid_token"
        assert r.headers.get("X-Request-ID")


# ── 3. Scope dokumantasyonu tutarliligi ─────────────────────────────────


def test_every_operation_documents_scopes(spec):
    """Veri endpoint'lerinin tamami x-required-scopes tasir ve katalogda
    olan scope'lari kullanir; discovery/me bilerek haric."""
    for path, method, op in _operations(spec):
        if (path, method) in PUBLIC_DISCOVERY | NO_SCOPE_REQUIRED:
            assert "x-required-scopes" not in op, (path, method)
            continue
        required = op.get("x-required-scopes")
        assert required, f"{method.upper()} {path} has no scope docs"
        assert set(required) <= set(SCOPES), (path, method, required)
        # security + "Required scopes" aciklamasi islenmis olmali.
        assert op.get("security") == [{"ApiToken": []}]
        assert "Required scopes" in op.get("description", "")


def test_scope_catalog_fully_used_or_reserved(spec):
    """Kataloktaki her scope ya bir endpoint'te kullanilir ya da acikca
    'Reserved' olarak dokumante edilir (olu scope kalmaz)."""
    used = set()
    for _, _, op in _operations(spec):
        used |= set(op.get("x-required-scopes", []))
    assert used == set(SCOPES) - RESERVED_SCOPES
    for s in RESERVED_SCOPES:
        assert SCOPES[s].startswith("Reserved"), s


# ── 4. Hata zarfi / kod katalogu tutarliligi ───────────────────────────


def test_error_docs_catalog_complete():
    assert set(ERROR_DOCS.keys()) == set(ERROR_STATUS.keys())


def test_error_envelope_consistent_across_status_codes(
    public_http, pg_session
):
    """401 / 404 / 405 / 422 zarflari ayni sekli tasir."""
    h = make_api_client(
        pg_session, "sweep-3e", [("global", None)], scopes=["tasks:read"]
    )
    cases = [
        public_http.get(f"{BASE}/v1/tasks"),  # 401 token yok
        public_http.get(f"{BASE}/v1/tasks/TASK-999999", headers=h),  # 404
        public_http.delete(f"{BASE}/v1/tasks", headers=h),  # 405
        public_http.get(f"{BASE}/v1/tasks?sort=nonsense", headers=h),  # 422
        public_http.get(f"{BASE}/v1/does-not-exist", headers=h),  # 404 route
        public_http.get(f"{BASE}/v2/tasks", headers=h),  # 404 surum yok
    ]
    expected_status = [401, 404, 405, 422, 404, 404]
    for r, want in zip(cases, expected_status):
        assert r.status_code == want, (r.request.url, r.status_code)
        body = r.json()
        assert set(body.keys()) == {"error"}, r.request.url
        assert set(body["error"].keys()) == {"code", "message", "request_id"}
        assert body["error"]["code"] in ERROR_STATUS, r.request.url


# ── 5. Internal sizinti kontrolleri ─────────────────────────────────────

_FORBIDDEN_SPEC_MARKERS = [
    "task_number",
    "type_number",
    "event_data",
    "body_preview",
    "billable_duration",
    "assignment_batch",
    "issue_key_manual",
    "token_hash",
    "/api/v1/core",
]

_ALLOWED_SCHEMA_NAME = re.compile(
    r"^(Public.*|Page.*|PageMeta|ErrorEnvelope|HTTPValidationError|"
    r"ValidationError)$"
)


def test_no_internal_markers_in_spec(spec):
    text = _json.dumps(spec)
    for marker in _FORBIDDEN_SPEC_MARKERS:
        assert marker not in text, marker


def test_component_schema_names_are_public_only(spec):
    for name in spec.get("components", {}).get("schemas", {}):
        assert _ALLOWED_SCHEMA_NAME.match(name), name


def test_internal_openapi_not_exposed(public_http):
    """Ana (internal) uygulamanin OpenAPI'si DEBUG disinda kapali kalir;
    public spec ayri URL'dedir."""
    assert public_http.get("/openapi.json").status_code == 404
    assert public_http.get("/docs").status_code == 404


# ── 6. Dokumantasyon tutarliligi ────────────────────────────────────────


def test_description_documents_key_sections(spec):
    desc = spec["info"]["description"]
    for section in (
        "## Writes",
        "## Idempotency",
        "## Rate limiting",
        "## Scopes",
        "## Error codes",
    ):
        assert section in desc, section
    assert "idempotency_request_in_progress" in desc
    # E-posta paritesi iddia edilmez (onayli sinirlama).
    assert "not yet enabled" in desc


def test_error_envelope_schema_in_components(spec):
    env = spec["components"]["schemas"]["ErrorEnvelope"]
    codes = env["properties"]["error"]["properties"]["code"]["enum"]
    assert set(codes) == set(ERROR_STATUS.keys())


def test_all_posts_document_idempotency_header(spec):
    for path, method, op in _operations(spec):
        if method != "post":
            continue
        names = [p.get("name") for p in op.get("parameters", [])]
        assert "Idempotency-Key" in names, path


def test_list_endpoints_document_page_envelope(spec):
    """Tum liste endpoint'leri tipli Page semasi doner; sort parametreleri
    enum olarak dokumante edilir."""
    list_paths = [
        "/v1/tasks",
        "/v1/customers",
        "/v1/projects",
        "/v1/work-logs",
        "/v1/meetings",
        "/v1/tasks/{task_code}/activity",
        "/v1/tasks/{task_code}/comments",
    ]
    for path in list_paths:
        op = spec["paths"][path]["get"]
        ref = op["responses"]["200"]["content"]["application/json"][
            "schema"
        ]["$ref"]
        assert ref.startswith("#/components/schemas/Page_"), path
        for p in op.get("parameters", []):
            if p.get("name") == "sort":
                assert "enum" in _json.dumps(p), path


def test_capabilities_matches_code_catalogs(public_http):
    caps = public_http.get(f"{BASE}/v1/capabilities").json()
    assert caps["scopes"] == SCOPES
    assert caps["api_version"] == "v1"
    assert caps["versions"] == ["v1"]
    assert caps["authentication"]["token_prefixes"] == [
        "hms_dev_",
        "hms_live_",
    ]
    writes = caps["writes"]
    assert writes["client_types"] == ["user"]
    assert (
        writes["idempotency"]["in_progress_error_code"]
        == "idempotency_request_in_progress"
    )
