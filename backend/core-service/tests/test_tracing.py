# =============================================================================
# OpenTelemetry izleri kilidi (shared/tracing.py)
# =============================================================================
# Kilitlenenler:
#   * Kapali varsayilan: OTLP hedefi yoksa hicbir sey yapilmaz.
#   * Datadog ile cakismama: yayilim B3; gelen W3C `traceparent` (ddtrace'in
#     yazdigi) ebeveyn olarak KULLANILMAZ, giden istege `traceparent`
#     YAZILMAZ.
#   * Sizinti: sorgu dizesi, basliklar ve SQL parametre degerleri span'a
#     girmez.
#   * Kimlik: service.name metrik sozlesmesindeki adla ayni; k8s.* env'den.
#   * Kurulum hatasi servisi DUSURMEZ.
#   * Manifestler: hedef Drake gateway'i, k8s ozellikleri Downward API'den.
# =============================================================================

import pathlib

import httpx
import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.propagate import get_global_textmap, set_global_textmap
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind

from shared import tracing as t

REPO = pathlib.Path(__file__).resolve().parents[3]
GATEWAY = "http://drake-otel-gateway.drake-otel.svc:4317"
SECRET = "cok-gizli-deger-42"


@pytest.fixture
def traced(monkeypatch):
    """Bellek ici disa aktarimla temiz bir izleme kurulumu; sonra geri alir."""
    for k in ("OTEL_PROPAGATORS", "OTEL_RESOURCE_ATTRIBUTES", "OTEL_SERVICE_NAME"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HERMES_ENVIRONMENT", "test")
    original_textmap = get_global_textmap()
    t._state.update(provider=None, httpx=False, engines=set())
    exporter = InMemorySpanExporter()

    def _setup(app, service="core-service", engine=None):
        return t.setup_tracing(
            app, service=service, engine=engine,
            span_processor=SimpleSpanProcessor(exporter),
        )

    yield _setup, exporter

    if t._state["httpx"]:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().uninstrument()
    if t._state["engines"]:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        SQLAlchemyInstrumentor().uninstrument()
    t._state.update(provider=None, httpx=False, engines=set())
    set_global_textmap(original_textmap)


def _app():
    app = FastAPI()

    @app.get("/items/{item_id}")
    def item(item_id: int):
        return {"id": item_id}

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/ready")
    def ready():
        return {"ok": True}

    return app


def _server_spans(exporter):
    return [s for s in exporter.get_finished_spans() if s.kind == SpanKind.SERVER]


def _all_values(spans):
    out = []
    for s in spans:
        out.append(s.name)
        out.extend(str(v) for v in (s.attributes or {}).values())
        for e in s.events:
            out.extend(str(v) for v in (e.attributes or {}).values())
    return out


# --- Kapali varsayilan -----------------------------------------------------

def test_disabled_without_an_otlp_endpoint(monkeypatch):
    for k in t.ENDPOINT_ENV_VARS:
        monkeypatch.delenv(k, raising=False)
    assert t.tracing_enabled() is False
    app = _app()
    assert t.setup_tracing(app, service="core-service") is None
    # Uygulamaya hicbir middleware eklenmedi.
    assert app.user_middleware == []


@pytest.mark.parametrize("var", t.ENDPOINT_ENV_VARS)
def test_enabled_by_either_endpoint_variable(monkeypatch, var):
    for k in t.ENDPOINT_ENV_VARS:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv(var, GATEWAY)
    assert t.tracing_enabled() is True


@pytest.mark.parametrize("var,value", [
    ("OTEL_SDK_DISABLED", "true"),
    ("OTEL_TRACES_EXPORTER", "none"),
])
def test_explicit_off_switches_win(monkeypatch, var, value):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", GATEWAY)
    monkeypatch.setenv(var, value)
    assert t.tracing_enabled() is False


# --- Istek izleri ve sizinti -------------------------------------------------

def test_request_is_traced_without_query_string_or_headers(traced):
    setup, exporter = traced
    app = _app()
    assert setup(app) is not None

    res = TestClient(app).get(
        f"/items/7?token={SECRET}&workspace=acme-gizli",
        headers={"Authorization": f"Bearer {SECRET}", "Cookie": f"s={SECRET}"},
    )
    assert res.status_code == 200 and res.json() == {"id": 7}

    spans = _server_spans(exporter)
    assert len(spans) == 1
    values = " ".join(_all_values(exporter.get_finished_spans()))
    assert SECRET not in values
    assert "acme-gizli" not in values
    assert "Bearer" not in values
    # Yol (sorgusuz) kalir: iz hala anlamli.
    assert spans[0].attributes.get("http.route") == "/items/{item_id}"


def test_body_chunk_spans_are_not_emitted(traced):
    setup, exporter = traced
    app = _app()
    setup(app)
    TestClient(app).get("/items/1")
    kinds = {s.kind for s in exporter.get_finished_spans()}
    assert kinds == {SpanKind.SERVER}


@pytest.mark.parametrize("path", ["/health", "/ready"])
def test_probe_endpoints_are_not_traced(traced, path):
    setup, exporter = traced
    app = _app()
    setup(app)
    assert TestClient(app).get(path).status_code == 200
    assert _server_spans(exporter) == []


def test_strip_url_drops_query_fragment_and_credentials():
    assert (
        t.strip_url(f"https://user:{SECRET}@core-service:8001/api/x?token={SECRET}#f")
        == "https://core-service:8001/api/x"
    )
    assert t.strip_target(f"/api/x?token={SECRET}") == "/api/x"


# --- Kimlik --------------------------------------------------------------

def test_resource_identity_matches_the_metrics_contract(traced, monkeypatch):
    setup, exporter = traced
    monkeypatch.setenv(
        "OTEL_RESOURCE_ATTRIBUTES",
        "k8s.namespace.name=hermes-test,k8s.pod.name=core-abc,service.name=yanlis",
    )
    app = _app()
    setup(app)
    TestClient(app).get("/items/1")
    res = _server_spans(exporter)[0].resource.attributes
    assert res["service.name"] == "core-service"  # env'deki yanlis ad ezilir
    assert res["service.namespace"] == "hermes"
    assert res["deployment.environment.name"] == "test"  # katalog anahtari
    assert res["k8s.namespace.name"] == "hermes-test"
    assert res["k8s.pod.name"] == "core-abc"


# --- Datadog ile cakismama (yayilim) ----------------------------------------

def test_incoming_b3_header_continues_the_trace(traced):
    setup, exporter = traced
    app = _app()
    setup(app)
    trace_id = "80f198ee56343ba864fe8b2a57d3eff7"
    TestClient(app).get(
        "/items/1", headers={"b3": f"{trace_id}-e457b5a2e4d86bd1-1"}
    )
    span = _server_spans(exporter)[0]
    assert format(span.context.trace_id, "032x") == trace_id


def test_incoming_w3c_traceparent_from_datadog_is_ignored(traced):
    """ddtrace W3C basligini yazar; onu ebeveyn alirsak Drake'teki iz
    Datadog'un izine baglanir ve kopuk/yanlis agaclar olusur."""
    setup, exporter = traced
    app = _app()
    setup(app)
    dd_trace_id = "4bf92f3577b34da6a3ce929d0e0e4736"
    TestClient(app).get(
        "/items/1",
        headers={"traceparent": f"00-{dd_trace_id}-00f067aa0ba902b7-01"},
    )
    span = _server_spans(exporter)[0]
    assert format(span.context.trace_id, "032x") != dd_trace_id
    assert span.parent is None


def test_outgoing_httpx_call_carries_b3_and_not_traceparent(traced):
    """Gercek HTTPTransport (enstrumantasyon onu sarar) + yerel sunucu."""
    import http.server
    import threading

    setup, exporter = traced
    setup(_app())
    seen = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            seen.update({k.lower(): v for k, v in self.headers.items()})
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    try:
        with httpx.Client() as client:
            client.get(
                f"http://127.0.0.1:{server.server_port}/internal/x?token={SECRET}"
            )
    finally:
        server.server_close()

    assert "b3" in seen
    assert "traceparent" not in seen  # Datadog'un basligina dokunmayiz
    clients = [s for s in exporter.get_finished_spans() if s.kind == SpanKind.CLIENT]
    assert clients, "httpx cagrisi izlenmedi"
    assert SECRET not in " ".join(_all_values(clients))


def test_explicit_propagator_choice_is_respected(traced, monkeypatch):
    """Datadog birakilinca W3C'ye gecis env ile yapilir; kod B3'u zorlamaz."""
    setup, _ = traced
    monkeypatch.setenv("OTEL_PROPAGATORS", "tracecontext")
    before = get_global_textmap()
    setup(_app())
    assert get_global_textmap() is before


# --- SQL ------------------------------------------------------------------

def test_sql_is_traced_without_parameter_values_and_unmodified(traced):
    from sqlalchemy import create_engine, event, text

    setup, exporter = traced
    engine = create_engine("sqlite://")
    executed = []
    event.listen(
        engine, "before_cursor_execute",
        lambda conn, cur, stmt, params, ctx, many: executed.append(stmt),
    )
    setup(_app(), engine=engine)

    with engine.connect() as conn:
        assert conn.execute(text("SELECT :v"), {"v": SECRET}).scalar() == SECRET

    db_spans = [s for s in exporter.get_finished_spans() if s.kind == SpanKind.CLIENT]
    assert db_spans, "SQL izlenmedi"
    assert SECRET not in " ".join(_all_values(db_spans))
    # Commenter kapali: calisan SQL'e yorum EKLENMEDI.
    assert all("/*" not in s for s in executed)


# --- Hata yalitimi -----------------------------------------------------------

def test_setup_failure_never_breaks_the_service(traced, monkeypatch):
    setup, _ = traced

    def boom(*a, **k):
        raise RuntimeError("kurulum patladi")

    monkeypatch.setattr(t, "_install_propagator", boom)
    app = _app()
    assert setup(app) is None
    assert TestClient(app).get("/items/3").json() == {"id": 3}


def test_setup_is_idempotent_per_app(traced):
    setup, exporter = traced
    app = _app()
    setup(app)
    setup(app)
    TestClient(app).get("/items/1")
    assert len(_server_spans(exporter)) == 1


def test_mounted_sub_app_routes_are_named_by_template(traced):
    """/api/public gibi mount edilmis alt-uygulamalarda da sablon adi."""
    setup, exporter = traced
    sub = FastAPI()

    @sub.get("/v1/tasks/{task_id}")
    def task(task_id: str):
        return {"id": task_id}

    app = _app()
    app.mount("/api/public", sub)
    setup(app)
    TestClient(app).get("/api/public/v1/tasks/abc-123")
    span = _server_spans(exporter)[0]
    assert span.name == "GET /api/public/v1/tasks/{task_id}"
    assert "abc-123" not in span.name


def test_unknown_path_has_bounded_span_name(traced):
    setup, exporter = traced
    app = _app()
    setup(app)
    TestClient(app).get("/yok/ki/boyle-bir-yol-123")
    assert _server_spans(exporter)[0].name == "GET"


def test_shutdown_is_time_bounded(traced, monkeypatch):
    import time

    class SlowProvider:
        def shutdown(self):
            time.sleep(5)

    monkeypatch.setitem(t._state, "provider", SlowProvider())
    started = time.monotonic()
    t.shutdown_tracing(timeout=0.2)
    assert time.monotonic() - started < 1.0
    monkeypatch.setitem(t._state, "provider", None)


# --- Servis baglantisi --------------------------------------------------------

@pytest.mark.parametrize("svc,engine", [
    ("core-service", "_db_engine"),
    ("auth-service", "_db_engine"),
    ("reporting-service", "None"),
])
def test_services_wire_tracing_with_the_contract_name(svc, engine):
    src = (REPO / "backend" / svc / "app" / "main.py").read_text(encoding="utf-8")
    assert f'setup_tracing(app, service="{svc}", engine={engine})' in src
    assert "shutdown_tracing()" in src


# --- Manifestler -------------------------------------------------------------

def _container_env(path, name):
    for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")):
        if not doc or doc.get("kind") != "Deployment":
            continue
        for c in doc["spec"]["template"]["spec"]["containers"]:
            if c["name"] == name:
                return {e["name"]: e for e in c.get("env", [])}
    raise AssertionError(f"{path}: {name} container'i yok")


MANIFESTS = [
    (d, f, n)
    for d in ("k8s", "k8s/test")
    for f, n in (
        ("03-backend-core.yaml", "core-service"),
        ("03-backend-auth.yaml", "auth-service"),
        ("03-backend-reporting.yaml", "reporting-service"),
    )
]


@pytest.mark.parametrize("d,f,name", MANIFESTS)
def test_manifests_point_traces_at_the_drake_gateway(d, f, name):
    env = _container_env(REPO / d / f, name)
    assert env["OTEL_EXPORTER_OTLP_ENDPOINT"]["value"] == GATEWAY
    # B3 kodun varsayilani; manifest W3C'ye zorlamamali (Datadog cakismasi).
    assert "OTEL_PROPAGATORS" not in env


@pytest.mark.parametrize("d,f,name", MANIFESTS)
def test_manifests_give_k8s_identity_via_downward_api(d, f, name):
    env = _container_env(REPO / d / f, name)
    assert env["K8S_POD_NAME"]["valueFrom"]["fieldRef"]["fieldPath"] == "metadata.name"
    assert env["K8S_NAMESPACE_NAME"]["valueFrom"]["fieldRef"]["fieldPath"] == "metadata.namespace"
    assert env["K8S_NODE_NAME"]["valueFrom"]["fieldRef"]["fieldPath"] == "spec.nodeName"
    attrs = env["OTEL_RESOURCE_ATTRIBUTES"]["value"]
    for part in (
        "k8s.namespace.name=$(K8S_NAMESPACE_NAME)",
        "k8s.pod.name=$(K8S_POD_NAME)",
        "k8s.node.name=$(K8S_NODE_NAME)",
        f"k8s.deployment.name={name}",
    ):
        assert part in attrs
    # $(VAR) yalnizca ONCE tanimlanmis env'e acilir.
    names = list(env)
    assert names.index("OTEL_RESOURCE_ATTRIBUTES") > names.index("K8S_NODE_NAME")
