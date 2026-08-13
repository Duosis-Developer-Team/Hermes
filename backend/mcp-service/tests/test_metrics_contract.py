# =============================================================================
# Drake metrik sozlesmesi — hermes-mcp tarafi (HERMES_METRICS.md)
# =============================================================================
# hermes_mcp `shared` paketini import EDEMEZ (yapisal kural, ayri test
# kilidi), bu yuzden sozlesme metrics.py'de bagimsiz uygulanir. Iki kopya
# arasindaki KAYMA en tehlikeli senaryo: adlar/etiketler sessizce ayrilir
# ve MCP serisi dashboard'a hic dusmez. Asagidaki parite testi bunu
# kalici olarak yasaklar.
# =============================================================================

import pytest
from starlette.testclient import TestClient

from hermes_mcp import metrics as mm
from hermes_mcp.main import app


def _count(status_class, environment=None):
    env = environment or mm.resolve_environment()
    return mm.REGISTRY.get_sample_value(
        "http_server_requests_total",
        {
            "project": "hermes",
            "environment": env,
            "service": "hermes-mcp",
            "status_class": status_class,
        },
    ) or 0.0


# --- Sozlesme -------------------------------------------------------------

def test_metric_names_and_labels_match_the_contract():
    assert mm.REQUESTS_METRIC == "http_server_requests_total"
    assert mm.DURATION_METRIC == "http_server_request_duration_seconds"
    assert set(mm.REQUESTS._labelnames) == {
        "project", "environment", "service", "status_class"
    }
    assert set(mm.DURATION._labelnames) == {
        "project", "environment", "service"
    }


def test_service_label_matches_the_kubernetes_workload_name():
    assert mm.SERVICE == "hermes-mcp"
    assert mm.PROJECT == "hermes"


def test_no_unbounded_labels():
    """MCP icin ozellikle onemli: arac adi / yol ETIKET DEGILDIR."""
    for metric in (mm.REQUESTS, mm.DURATION):
        assert not (set(metric._labelnames) & {
            "pod", "container", "instance", "route", "path", "method",
            "tool", "tool_name", "token", "client", "user", "request_id",
            "status_code",
        })


@pytest.mark.parametrize(
    "code,expected",
    [(200, "2xx"), (307, "3xx"), (401, "4xx"), (413, "4xx"), (503, "5xx")],
)
def test_status_class_is_the_class_not_the_code(code, expected):
    assert mm.status_class(code) == expected


def test_environment_is_the_catalog_key_not_the_namespace(monkeypatch):
    monkeypatch.setenv(mm.ENVIRONMENT_ENV_VAR, "dev")
    assert mm.resolve_environment() == "dev"
    monkeypatch.setenv(mm.ENVIRONMENT_ENV_VAR, "hermes-dev")
    assert mm.resolve_environment() == mm.UNKNOWN_ENVIRONMENT


def test_duration_buckets_are_seconds():
    assert mm.DURATION_BUCKETS[0] == 0.005
    assert mm.DURATION_BUCKETS[-1] == 10.0


# --- shared/metrics.py ile PARITE (kopya kaymasi yasak) -------------------

def test_contract_is_identical_to_the_shared_implementation():
    """Iki bagimsiz uygulama ayni sozlesmeyi tasimak ZORUNDA. (shared
    yalnizca TEST tarafinda import edilir; runtime import yasagi
    test_stage5a_mcp::test_runtime_imports_no_core_or_db ile kilitli.)"""
    from shared import metrics as sm

    assert mm.REQUESTS_METRIC == sm.REQUESTS_METRIC
    assert mm.DURATION_METRIC == sm.DURATION_METRIC
    assert set(mm.REQUESTS._labelnames) == set(sm.REQUESTS._labelnames)
    assert set(mm.DURATION._labelnames) == set(sm.DURATION._labelnames)
    assert mm.DURATION_BUCKETS == sm.DURATION_BUCKETS
    assert mm.STATUS_CLASSES == sm.STATUS_CLASSES
    assert mm.PROJECT == sm.PROJECT
    assert mm.ENVIRONMENT_ENV_VAR == sm.ENVIRONMENT_ENV_VAR
    assert mm.KNOWN_ENVIRONMENTS == sm.KNOWN_ENVIRONMENTS
    assert mm.DEFAULT_METRICS_PORT == sm.DEFAULT_METRICS_PORT
    for code in (100, 204, 302, 404, 500, 599):
        assert mm.status_class(code) == sm.status_class(code)


# --- Uygulamaya baglanma --------------------------------------------------

def test_app_is_instrumented():
    assert any(
        mw.cls is mm.PrometheusMiddleware for mw in app.user_middleware
    )


def test_public_discovery_request_is_counted_and_unchanged():
    """PRM dokumani auth GEREKTIRMEZ — DB olmadan calisir. Middleware
    yaniti degistirmemeli."""
    client = TestClient(app, raise_server_exceptions=False)
    before = _count("2xx")
    r = client.get("/.well-known/oauth-protected-resource")
    assert r.status_code == 200
    assert r.json()["authorization_servers"] == []
    assert _count("2xx") == before + 1


def test_unauthenticated_mcp_post_is_counted_as_4xx_with_challenge():
    """401 + WWW-Authenticate davranisi AYNEN korunur; olcum yalnizca
    sayar."""
    client = TestClient(app, raise_server_exceptions=False)
    before = _count("4xx")
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1,
                                  "method": "tools/list"})
    assert r.status_code == 401
    assert "WWW-Authenticate" in r.headers
    assert _count("4xx") == before + 1


def test_health_is_not_measured():
    client = TestClient(app, raise_server_exceptions=False)
    before = sum(_count(c) for c in mm.STATUS_CLASSES)
    assert client.get("/health").status_code == 200
    assert sum(_count(c) for c in mm.STATUS_CLASSES) == before
