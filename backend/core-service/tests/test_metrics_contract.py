# =============================================================================
# Drake metrik SOZLESMESI kilidi (HERMES_METRICS.md)
# =============================================================================
# Bu sozlesmenin basarisizlik bicimi sessizdir: yanlis bir etiket adiyla
# metrik TOPLANIR ama hicbir ekranda gorunmez ve haftalar sonra fark
# edilir. Bu yuzden ad/etiket/deger/birim burada BIREBIR kilitlenir; ek
# olarak middleware'in istek yolundaki davranisi (yanit bozulmaz,
# istisna yutulmaz, olcum hatasi istegi kirmaz) test edilir.
#
# k8s tarafi da buradan kilitlenir: scrape annotation'lari POD sablonunda
# olmali (Service'te ETKISIZ) ve environment degeri KATALOG ANAHTARI
# olmali ('dev' — 'hermes-dev' DEGIL).
# =============================================================================

import pathlib
import re
import urllib.request

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import generate_latest

from shared import metrics as m

REPO = pathlib.Path(__file__).resolve().parents[3]

# Sozlesmedeki iki metrik ve etiketleri (HERMES_METRICS.md "The contract")
COUNTER_LABELS = {"project", "environment", "service", "status_class"}
HISTOGRAM_LABELS = {"project", "environment", "service"}

# Drake katalogunun reddettigi / sinirsiz kardinalite ureten etiketler.
FORBIDDEN_LABELS = {
    "pod", "container", "instance", "route", "path", "method", "endpoint",
    "tenant", "customer", "user", "user_id", "email", "request_id",
    "status", "status_code",
}


def _labels(metric):
    return set(metric._labelnames)


# --- Metrik adlari, etiketler, birim -------------------------------------

def test_metric_names_match_the_contract():
    assert m.REQUESTS_METRIC == "http_server_requests_total"
    assert m.DURATION_METRIC == "http_server_request_duration_seconds"


def test_label_sets_match_the_contract():
    assert _labels(m.REQUESTS) == COUNTER_LABELS
    # status_class YALNIZCA sayacta olmali.
    assert _labels(m.DURATION) == HISTOGRAM_LABELS


def test_no_forbidden_labels():
    for metric in (m.REQUESTS, m.DURATION):
        assert not (_labels(metric) & FORBIDDEN_LABELS)


def test_project_label_is_constant_hermes():
    assert m.PROJECT == "hermes"


def test_duration_buckets_are_seconds_not_milliseconds():
    # ms olsaydi bucket'lar 5, 10, 25... gibi olurdu. En kucuk bucket
    # 5 ms = 0.005 s ve en buyuk sinir 10 s.
    assert m.DURATION_BUCKETS[0] == 0.005
    assert m.DURATION_BUCKETS[-1] == 10.0
    assert all(b <= 10.0 for b in m.DURATION_BUCKETS)


# --- status_class: SINIF, kod degil --------------------------------------

@pytest.mark.parametrize(
    "code,expected",
    [
        (200, "2xx"), (201, "2xx"), (204, "2xx"), (299, "2xx"),
        (301, "3xx"), (304, "3xx"), (399, "3xx"),
        (400, "4xx"), (401, "4xx"), (404, "4xx"), (429, "4xx"), (499, "4xx"),
        (500, "5xx"), (502, "5xx"), (503, "5xx"), (599, "5xx"),
        # Sinir disi/gecici degerler de kapali kumeden bir deger uretmeli.
        (100, "2xx"), (103, "2xx"), (999, "5xx"),
    ],
)
def test_status_class_is_the_class_not_the_code(code, expected):
    assert m.status_class(code) == expected


def test_status_class_output_set_is_closed():
    produced = {m.status_class(c) for c in range(100, 600)}
    assert produced <= set(m.STATUS_CLASSES)


# --- environment: katalog anahtari, namespace DEGIL -----------------------

def test_environment_comes_from_env_var(monkeypatch):
    monkeypatch.setenv(m.ENVIRONMENT_ENV_VAR, "dev")
    assert m.resolve_environment() == "dev"
    monkeypatch.setenv(m.ENVIRONMENT_ENV_VAR, "test")
    assert m.resolve_environment() == "test"


def test_namespace_value_is_rejected(monkeypatch):
    """'hermes-dev' en olasi hata: sessizce kabul edilirse sorgu bos
    doner ama seri VARDIR. Katalog anahtari olmayan deger 'unknown'
    olur — teshis edilebilir, yaniltici degil."""
    for wrong in ("hermes-dev", "hermes-test", "production", "", "  "):
        monkeypatch.setenv(m.ENVIRONMENT_ENV_VAR, wrong)
        assert m.resolve_environment() == m.UNKNOWN_ENVIRONMENT


def test_missing_env_var_is_unknown(monkeypatch):
    monkeypatch.delenv(m.ENVIRONMENT_ENV_VAR, raising=False)
    assert m.resolve_environment() == m.UNKNOWN_ENVIRONMENT


# --- Middleware davranisi (istek yolunda) --------------------------------

def _app(service="svc-under-test", environment="dev", **kw):
    """Izole bir FastAPI uygulamasi — gercek middleware ile."""
    app = FastAPI()

    @app.get("/ok")
    def ok():
        return {"ok": True}

    @app.get("/missing")
    def missing():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="nope")

    @app.get("/boom")
    def boom():
        raise RuntimeError("patlama")

    @app.get("/health")
    def health():
        return {"status": "healthy"}

    app.add_middleware(
        m.PrometheusMiddleware, service=service, environment=environment, **kw
    )
    return app


def _count(service, status_class, environment="dev"):
    return m.REGISTRY.get_sample_value(
        "http_server_requests_total",
        {
            "project": "hermes",
            "environment": environment,
            "service": service,
            "status_class": status_class,
        },
    ) or 0.0


def _hist_count(service, environment="dev"):
    return m.REGISTRY.get_sample_value(
        "http_server_request_duration_seconds_count",
        {"project": "hermes", "environment": environment, "service": service},
    ) or 0.0


def test_success_is_counted_as_2xx_and_response_is_untouched():
    svc = "svc-success"
    client = TestClient(_app(svc), raise_server_exceptions=False)
    before = _count(svc, "2xx")
    r = client.get("/ok")
    assert r.status_code == 200
    assert r.json() == {"ok": True}          # yanit govdesi bozulmaz
    assert _count(svc, "2xx") == before + 1


def test_client_error_is_counted_as_4xx():
    svc = "svc-4xx"
    client = TestClient(_app(svc), raise_server_exceptions=False)
    before = _count(svc, "4xx")
    assert client.get("/missing").status_code == 404
    assert _count(svc, "4xx") == before + 1
    assert _count(svc, "5xx") == 0.0          # hata orani kirletilmez


def test_unhandled_exception_is_counted_as_5xx_and_still_propagates():
    """Middleware istisnayi YUTMAZ: 500 yanitini disaridaki
    ServerErrorMiddleware uretir, biz yalnizca sayariz."""
    svc = "svc-5xx"
    client = TestClient(_app(svc), raise_server_exceptions=False)
    before = _count(svc, "5xx")
    assert client.get("/boom").status_code == 500
    assert _count(svc, "5xx") == before + 1


def test_health_probe_traffic_is_not_measured():
    """kubelet probe trafigi request rate'i sisirir ve hizli /health
    yanitlari p95'i asagi ceker — bilerek disarida."""
    svc = "svc-health"
    client = TestClient(_app(svc), raise_server_exceptions=False)
    before_all = sum(_count(svc, c) for c in m.STATUS_CLASSES)
    for _ in range(5):
        assert client.get("/health").status_code == 200
    assert sum(_count(svc, c) for c in m.STATUS_CLASSES) == before_all


def test_duration_is_observed_in_seconds():
    svc = "svc-duration"
    client = TestClient(_app(svc), raise_server_exceptions=False)
    client.get("/ok")
    total = m.REGISTRY.get_sample_value(
        "http_server_request_duration_seconds_sum",
        {"project": "hermes", "environment": "dev", "service": svc},
    )
    assert _hist_count(svc) == 1.0
    # Saniye cinsinden: yerel bir istek asla 10 sn surmez. (ms olsaydi
    # tipik deger 1-50 araliginda cikardi.)
    assert 0.0 <= total < 10.0


def test_observation_failure_never_breaks_the_request(monkeypatch):
    """Metrik kaydi ugruna canli istek dusurulemez."""
    svc = "svc-broken-metrics"
    client = TestClient(_app(svc), raise_server_exceptions=False)

    def explode(*a, **kw):
        raise RuntimeError("registry bozuk")

    monkeypatch.setattr(m.REQUESTS, "labels", explode)
    r = client.get("/ok")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_non_http_scope_passes_through_untouched():
    """lifespan/websocket kapsamlari olculmez ve engellenmez."""
    seen = {}

    async def inner(scope, receive, send):
        seen["type"] = scope["type"]

    mw = m.PrometheusMiddleware(inner, service="svc-scope", environment="dev")

    import asyncio

    async def _noop(*a, **kw):
        return None

    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        mw({"type": "lifespan"}, _noop, _noop)
    )
    assert seen["type"] == "lifespan"


def test_preinit_creates_zero_series_so_queries_return_zero():
    """Hic 5xx olmayan bir ortamda hata orani sorgusu 'veri yok' yerine
    0 dondurmeli — aksi halde enstrumantasyon calismiyor sanilir."""
    svc = "svc-preinit"
    m.preinit_series(svc, "dev")
    for cls in m.STATUS_CLASSES:
        assert _count(svc, cls) == 0.0
    assert _hist_count(svc) == 0.0


# --- Exposition ciktisi (Prometheus'un gordugu metin) --------------------

def test_exposition_contains_exact_series_names():
    svc = "svc-exposition"
    client = TestClient(_app(svc), raise_server_exceptions=False)
    client.get("/ok")
    text = generate_latest(m.REGISTRY).decode()
    assert re.search(
        r'^http_server_requests_total\{[^}]*service="svc-exposition"[^}]*\} ',
        text, re.M,
    )
    assert re.search(
        r"^http_server_request_duration_seconds_bucket\{[^}]*le=", text, re.M
    )
    assert 'status_class="2xx"' in text
    assert 'project="hermes"' in text
    # Yasak etiket exposition'a hicbir sekilde sizmamali.
    for bad in ("pod=", "route=", "path=", "instance=", "method="):
        assert bad not in text


def test_metrics_server_serves_the_exposition_on_its_own_port():
    """/metrics ayri portta yayinlanir; uygulama portuna dokunmaz."""
    port = m.start_metrics_server(port=0)   # ephemeral port
    assert port
    with urllib.request.urlopen(
        f"http://127.0.0.1:{port}/metrics", timeout=5
    ) as resp:
        assert resp.status == 200
        body = resp.read().decode()
    assert "http_server_requests_total" in body
    assert "http_server_request_duration_seconds_bucket" in body
    # Ikinci cagri ayni sunucuyu doner (mukerrer baglama yok).
    assert m.start_metrics_server(port=0) == port


# --- core-service uygulamasi gercekten enstrumante mi? -------------------

def test_core_app_declares_the_contract_service_label():
    from app.main import app as core_app

    installed = [
        mw for mw in core_app.user_middleware
        if mw.cls is m.PrometheusMiddleware
    ]
    assert len(installed) == 1, "core-service enstrumante degil (ya da iki kez)"
    assert installed[0].kwargs["service"] == "core-service"


# --- k8s manifest kilidi -------------------------------------------------
# Uygulama dogru metrigi yaysa bile scrape annotation'i POD sablonunda
# degilse hicbir sey toplanmaz. Namespace <-> environment esleme hatasi
# da (hermes-dev -> 'dev') burada yakalanir.

DEPLOYMENT_FILES = {
    "dev": (
        "k8s/03-backend-auth.yaml",
        "k8s/03-backend-core.yaml",
        "k8s/03-backend-reporting.yaml",
        "k8s/09-mcp-service.yaml",
    ),
    "test": (
        "k8s/test/03-backend-auth.yaml",
        "k8s/test/03-backend-core.yaml",
        "k8s/test/03-backend-reporting.yaml",
        "k8s/test/09-mcp-service.yaml",
    ),
}

EXPECTED_NAMESPACE = {"dev": "hermes-dev", "test": "hermes-test"}
METRICS_PORT = "9090"


def _docs(rel):
    return [d for d in yaml.safe_load_all((REPO / rel).read_text()) if d]


def _deployments(env):
    for rel in DEPLOYMENT_FILES[env]:
        for doc in _docs(rel):
            if doc.get("kind") == "Deployment":
                yield rel, doc


@pytest.mark.parametrize("env", ["dev", "test"])
def test_scrape_annotations_are_on_the_pod_template(env):
    found = 0
    for rel, dep in _deployments(env):
        ann = (
            dep["spec"]["template"]["metadata"].get("annotations") or {}
        )
        assert ann.get("prometheus.io/scrape") == "true", rel
        assert ann.get("prometheus.io/port") == METRICS_PORT, rel
        assert ann.get("prometheus.io/path") == "/metrics", rel
        found += 1
    assert found == 4, f"{env}: 4 deployment beklendi, {found} bulundu"


@pytest.mark.parametrize("env", ["dev", "test"])
def test_scrape_annotations_are_not_on_services(env):
    """Service uzerindeki annotation aynen 'hicbir sey yayilmiyor' gibi
    gorunur — bu hataya dusulmedigini kalici olarak dogrula."""
    for rel in DEPLOYMENT_FILES[env]:
        for doc in _docs(rel):
            if doc.get("kind") == "Service":
                ann = doc["metadata"].get("annotations") or {}
                assert "prometheus.io/scrape" not in ann, rel


@pytest.mark.parametrize("env", ["dev", "test"])
def test_environment_env_var_is_the_catalog_key(env):
    for rel, dep in _deployments(env):
        assert dep["metadata"]["namespace"] == EXPECTED_NAMESPACE[env], rel
        container = dep["spec"]["template"]["spec"]["containers"][0]
        env_vars = {e["name"]: e for e in container.get("env", [])}
        assert m.ENVIRONMENT_ENV_VAR in env_vars, f"{rel}: env degiskeni yok"
        value = env_vars[m.ENVIRONMENT_ENV_VAR].get("value")
        assert value == env, f"{rel}: {value!r} (katalog anahtari degil)"
        # Namespace adi ASLA deger olarak kullanilmamali.
        assert value != EXPECTED_NAMESPACE[env]


@pytest.mark.parametrize("env", ["dev", "test"])
def test_metrics_port_is_declared_on_the_container(env):
    for rel, dep in _deployments(env):
        container = dep["spec"]["template"]["spec"]["containers"][0]
        ports = {str(p["containerPort"]) for p in container.get("ports", [])}
        assert METRICS_PORT in ports, rel


def test_metrics_endpoint_is_not_routed_through_any_ingress():
    """/metrics kumede kalir: hicbir Ingress kurali metrik portuna ya da
    /metrics yoluna gitmez."""
    ingress_files = [
        "k8s/05-ingress.yaml", "k8s/09-mcp-ingress.yaml",
        "k8s/test/05-ingress.yaml", "k8s/test/09-mcp-ingress.yaml",
    ]
    for rel in ingress_files:
        for doc in _docs(rel):
            if doc.get("kind") != "Ingress":
                continue
            for rule in doc["spec"].get("rules", []):
                for p in rule.get("http", {}).get("paths", []):
                    assert "metrics" not in p["path"], f"{rel}: {p['path']}"
                    port = p["backend"]["service"]["port"]
                    assert str(port.get("number")) != METRICS_PORT, rel


def test_retired_hermes_namespace_is_not_touched():
    """Plain `hermes` namespace'i EMEKLI: bu repodaki hicbir manifest
    oraya yazmaz — enstrumantasyon da annotation da (HERMES_METRICS.md
    kapsam kurali). Oyunda olan namespace'ler: hermes-dev, hermes-test."""
    for path in (REPO / "k8s").rglob("*.yaml"):
        for doc in yaml.safe_load_all(path.read_text()):
            if not doc or not isinstance(doc, dict):
                continue
            meta = doc.get("metadata") or {}
            assert meta.get("namespace") != "hermes", f"{path}: {meta}"
            if doc.get("kind") == "Namespace":
                assert meta.get("name") != "hermes", f"{path}: {meta}"


def test_scrape_annotations_only_exist_in_hermes_namespaces():
    """Annotation'lar YALNIZCA hermes-dev / hermes-test kaynaklarinda;
    baska ekiplerin/altyapinin manifestlerine dokunulmadi."""
    for path in (REPO / "k8s").rglob("*.yaml"):
        for doc in yaml.safe_load_all(path.read_text()):
            if not doc or not isinstance(doc, dict):
                continue
            blob = yaml.safe_dump(doc)
            if "prometheus.io/scrape" not in blob:
                continue
            ns = (doc.get("metadata") or {}).get("namespace")
            assert ns in ("hermes-dev", "hermes-test"), f"{path}: {ns}"
