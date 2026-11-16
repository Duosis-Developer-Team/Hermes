# =============================================================================
# hermes-mcp OpenTelemetry izleri kilidi (hermes_mcp/tracing.py)
# =============================================================================
# * Kapali varsayilan; TracingMiddleware kapaliyken dokunmadan gecirir.
# * Arac cagrisi: `POST /mcp` sunucu span'i -> `mcp.tool <ad>` alt span'i
#   (oturum yoneticisinin gorevine baglam tasinir).
# * Sizinti: Bearer token, arac argumanlari ve sonucu span'a GIRMEZ.
# * Parite: shared/tracing.py ile ayni sabitler ve temizleme davranisi.
# * "Tek upstream" kurali genisletmesi: OTLP hedefi yalnizca env'den;
#   tracing.py URL kurmaz/literal hedef tasimaz. NetworkPolicy egress'i
#   core + DNS + drake-otel-gateway:4317 — baska hicbir sey.
# =============================================================================

import pathlib

import pytest
import yaml
from opentelemetry.propagate import get_global_textmap, set_global_textmap
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode

from hermes_mcp import tracing as mt

from .conftest import call_tool
from .test_stage5a_mcp import u1_token

REPO = pathlib.Path(__file__).resolve().parents[3]
GATEWAY = "http://drake-otel-gateway.drake-otel.svc:4317"


@pytest.fixture
def traced(mcp_http, monkeypatch):
    from hermes_mcp.main import app as mcp_app

    monkeypatch.delenv("OTEL_PROPAGATORS", raising=False)
    original_textmap = get_global_textmap()
    mt._state.update(provider=None, tracer=None, httpx=False, routes=None)
    exporter = InMemorySpanExporter()
    assert mt.setup_tracing(mcp_app, span_processor=SimpleSpanProcessor(exporter))
    yield exporter
    if mt._state["httpx"]:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().uninstrument()
    mt._state.update(provider=None, tracer=None, httpx=False, routes=None)
    set_global_textmap(original_textmap)


def _values(spans):
    out = []
    for s in spans:
        out.append(s.name)
        out.extend(str(v) for v in (s.attributes or {}).values())
        for e in s.events:
            out.extend(str(v) for v in (e.attributes or {}).values())
    return " ".join(out)


# --- Kapali varsayilan -------------------------------------------------------

def test_disabled_by_default_and_middleware_passes_through(mcp_http, monkeypatch):
    for k in mt.ENDPOINT_ENV_VARS:
        monkeypatch.delenv(k, raising=False)
    assert mt.tracing_enabled() is False
    assert mt._state["provider"] is None
    assert mcp_http.get("/health").status_code == 200


def test_tool_span_is_a_noop_when_disabled():
    assert mt._state["tracer"] is None
    with mt.tool_span("hermes_whoami", False) as span:
        assert span is None
    mt.mark_tool_error(None, {"error": {"code": "not_found"}})  # patlamaz


# --- Arac cagrisi izi ---------------------------------------------------------

def test_tool_call_is_a_child_of_the_mcp_request_span(traced, mcp_http, pg_session):
    token = u1_token(pg_session)
    resp = call_tool(mcp_http, token, "hermes_whoami")
    assert resp.status_code == 200

    spans = traced.get_finished_spans()
    server = [s for s in spans if s.kind == SpanKind.SERVER]
    tools = [s for s in spans if s.name == "mcp.tool hermes_whoami"]
    assert len(server) == 1 and server[0].name == "POST /mcp"
    assert len(tools) == 1
    tool = tools[0]
    assert tool.attributes["mcp.tool.name"] == "hermes_whoami"
    assert tool.attributes["mcp.tool.write"] is False
    # Baglam oturum yoneticisinin gorevine tasindi: TEK iz agaci.
    assert tool.context.trace_id == server[0].context.trace_id
    assert tool.parent is not None

    assert server[0].resource.attributes["service.name"] == "hermes-mcp"
    assert server[0].resource.attributes["service.namespace"] == "hermes"
    assert token not in _values(spans)
    assert "Bearer" not in _values(spans)


def test_tool_arguments_and_errors_do_not_leak(traced, mcp_http, pg_session):
    token = u1_token(pg_session)
    secret_arg = "GIZLI-ARG-90210"
    resp = call_tool(mcp_http, token, "hermes_get_task", {"task_code": secret_arg})
    assert resp.status_code == 200
    body = resp.json()["result"]
    assert body.get("isError") is True  # boyle bir is yok

    spans = traced.get_finished_spans()
    tool = [s for s in spans if s.name == "mcp.tool hermes_get_task"][0]
    assert tool.status.status_code == StatusCode.ERROR
    # Yalnizca kapali katalogdaki KOD yazilir, mesaj degil.
    assert tool.attributes.get("error.type")
    values = _values(spans)
    assert secret_arg not in values
    assert token not in values


# --- Parite (shared/tracing.py) -----------------------------------------------

def test_constants_match_the_shared_implementation():
    from shared import tracing as st

    assert mt.ENDPOINT_ENV_VARS == st.ENDPOINT_ENV_VARS
    assert mt.EXCLUDED_URLS == st.EXCLUDED_URLS
    assert mt.PROPAGATORS_ENV_VAR == st.PROPAGATORS_ENV_VAR
    assert mt._FULL_URL_KEYS == st._FULL_URL_KEYS
    assert mt._TARGET_KEYS == st._TARGET_KEYS
    assert mt._QUERY_KEYS == st._QUERY_KEYS
    assert mt.SHUTDOWN_TIMEOUT_SECONDS == st.SHUTDOWN_TIMEOUT_SECONDS


@pytest.mark.parametrize("url", [
    "https://user:pw@core-service:8001/api/public/v1/tasks?token=x#frag",
    "http://core-test/api/public/v1/me",
    "not a url",
    "",
])
def test_url_stripping_matches_the_shared_implementation(url):
    from shared import tracing as st

    assert mt.strip_url(url) == st.strip_url(url)
    assert mt.strip_target(url) == st.strip_target(url)


def test_otel_pins_match_the_other_services():
    def pins(path):
        return {
            line.strip() for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip().startswith("opentelemetry-")
            and "sqlalchemy" not in line
        }

    mcp = pins(REPO / "backend" / "mcp-service" / "requirements.txt")
    core = pins(REPO / "backend" / "core-service" / "requirements.txt")
    assert mcp and mcp == core


# --- Tek upstream kurali (genisletilmis) --------------------------------------

def test_tracing_module_builds_no_urls_and_has_no_literal_target():
    src = (REPO / "backend" / "mcp-service" / "hermes_mcp" / "tracing.py").read_text(
        encoding="utf-8"
    )
    code = "\n".join(line.split("#")[0] for line in src.splitlines())
    assert "http://" not in code and "https://" not in code
    assert "OTLPSpanExporter()" in code  # hedef YALNIZCA env'den
    for banned in ("httpx.", "urllib.request", "socket.", "requests."):
        assert banned not in code


def test_network_policy_egress_is_core_dns_and_telemetry_only():
    doc = yaml.safe_load((REPO / "k8s" / "09-mcp-networkpolicy.yaml").read_text())
    ports = sorted(
        (p["port"], p["protocol"]) for rule in doc["spec"]["egress"] for p in rule["ports"]
    )
    assert ports == [(53, "TCP"), (53, "UDP"), (4317, "TCP"), (8001, "TCP")]
    telemetry = [r for r in doc["spec"]["egress"] if r["ports"][0]["port"] == 4317][0]
    peer = telemetry["to"][0]
    assert peer["namespaceSelector"]["matchLabels"] == {
        "kubernetes.io/metadata.name": "drake-otel"
    }
    assert peer["podSelector"]["matchLabels"] == {
        "app.kubernetes.io/name": "drake-otel-gateway"
    }


# --- Manifestler ----------------------------------------------------------------

@pytest.mark.parametrize("d", ["k8s", "k8s/test"])
def test_manifests_wire_traces_like_the_other_services(d):
    for doc in yaml.safe_load_all((REPO / d / "09-mcp-service.yaml").read_text()):
        if doc and doc.get("kind") == "Deployment":
            c = doc["spec"]["template"]["spec"]["containers"][0]
            env = {e["name"]: e for e in c.get("env", [])}
            break
    else:
        raise AssertionError("hermes-mcp Deployment yok")
    assert env["OTEL_EXPORTER_OTLP_ENDPOINT"]["value"] == GATEWAY
    assert "OTEL_PROPAGATORS" not in env
    attrs = env["OTEL_RESOURCE_ATTRIBUTES"]["value"]
    assert "k8s.deployment.name=hermes-mcp" in attrs
    names = list(env)
    assert names.index("OTEL_RESOURCE_ATTRIBUTES") > names.index("K8S_NODE_NAME")
