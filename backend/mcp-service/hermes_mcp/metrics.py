# =============================================================================
# hermes-mcp - Prometheus HTTP metrikleri (Drake sozlesmesi)
# =============================================================================
# NEDEN KOPYA: hermes_mcp INCE katmandir; `shared` paketini import etmesi
# YAPISAL OLARAK yasaktir (test kilidi: test_stage5a_mcp::
# test_runtime_imports_no_core_or_db) ve image'a shared/ kopyalanmaz.
# Bu yuzden ayni sozlesme burada bagimsiz uygulanir. Sozlesme
# HERMES_METRICS.md'dedir; adlar/etiketler backend/shared/metrics.py ile
# BIREBIR ayni olmak zorundadir — iki taraf da testle kilitlidir.
#
#   http_server_requests_total            counter
#     etiketler: project, environment, service, status_class
#   http_server_request_duration_seconds  histogram  (SANIYE)
#     etiketler: project, environment, service
#
# Yasak etiketler (pod/route/path/instance/kullanici kimlikleri) burada
# da yoktur: MCP icin bu ozellikle onemli — yol ve arac adlari sinirsiz
# kardinalite kaynagi olurdu. Arac adi ETIKET DEGILDIR.
# =============================================================================

import os
import threading
from time import perf_counter

from prometheus_client import (
    CollectorRegistry, Counter, Histogram, start_http_server,
)

PROJECT = "hermes"
SERVICE = "hermes-mcp"  # k8s Deployment/Service adiyla ayni
REQUESTS_METRIC = "http_server_requests_total"
DURATION_METRIC = "http_server_request_duration_seconds"

STATUS_CLASSES = ("2xx", "3xx", "4xx", "5xx")

DURATION_BUCKETS = (
    0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75,
    1.0, 2.5, 5.0, 7.5, 10.0,
)

DEFAULT_METRICS_PORT = 9090
ENVIRONMENT_ENV_VAR = "HERMES_ENVIRONMENT"
KNOWN_ENVIRONMENTS = ("dev", "test")
UNKNOWN_ENVIRONMENT = "unknown"

# Saglik problari olculmez (kubelet trafigi request rate'i sisirir, p95'i
# yaniltir).
EXCLUDED_PATHS = frozenset({"/health"})

# OZEL registry: MCP test harness'i core-service'i AYNI surecte
# calistirir; her iki taraf ayni metrik adlarini tanimladigi icin global
# registry'de "Duplicated timeseries" hatasi olusurdu. Ayrica scrape
# ciktisi yalnizca sozlesmedeki iki metrigi tasir.
REGISTRY = CollectorRegistry()

REQUESTS = Counter(
    REQUESTS_METRIC,
    "Total HTTP requests handled by the service, by response status class.",
    ["project", "environment", "service", "status_class"],
    registry=REGISTRY,
)

DURATION = Histogram(
    DURATION_METRIC,
    "HTTP request duration in seconds.",
    ["project", "environment", "service"],
    buckets=DURATION_BUCKETS,
    registry=REGISTRY,
)


def resolve_environment() -> str:
    """Katalog anahtari ('dev' | 'test'); namespace adi DEGIL. Gecersiz
    deger sessizce dogru sorguya dusmesin diye 'unknown' olur."""
    value = (os.environ.get(ENVIRONMENT_ENV_VAR) or "").strip()
    if value in KNOWN_ENVIRONMENTS:
        return value
    return UNKNOWN_ENVIRONMENT


def status_class(status_code: int) -> str:
    """Durum SINIFI ('5xx'), kod ('500') DEGIL. Cikti kumesi kapali."""
    if 500 <= status_code:
        return "5xx"
    if 400 <= status_code < 500:
        return "4xx"
    if 300 <= status_code < 400:
        return "3xx"
    if 200 <= status_code < 300:
        return "2xx"
    return "2xx"


class PrometheusMiddleware:
    """Ham ASGI olcum katmani: istegi/yaniti DEGISTIRMEZ, govdeye
    dokunmaz. MCP'nin ham ASGI /mcp ucu (redirect'siz tam eslesme) bu
    zincirin altinda aynen calisir."""

    def __init__(self, app, service: str = SERVICE, environment=None):
        self.app = app
        self.service = service
        self.environment = environment or resolve_environment()

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") in EXCLUDED_PATHS:
            await self.app(scope, receive, send)
            return

        started = perf_counter()
        seen = {"status": None}

        async def _send(message):
            if message["type"] == "http.response.start":
                seen["status"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception:
            self._observe(seen["status"] or 500, perf_counter() - started)
            raise
        self._observe(seen["status"] or 500, perf_counter() - started)

    def _observe(self, status_code: int, elapsed_seconds: float) -> None:
        """Olcum ASLA istegi kirmaz."""
        try:
            REQUESTS.labels(
                project=PROJECT,
                environment=self.environment,
                service=self.service,
                status_class=status_class(status_code),
            ).inc()
            DURATION.labels(
                project=PROJECT,
                environment=self.environment,
                service=self.service,
            ).observe(elapsed_seconds)
        except Exception:  # noqa: BLE001 — bilincli olarak sessiz
            pass


def preinit_series(environment=None) -> str:
    """Sifir degerli seriler: bos ortamda sorgu 'veri yok' yerine 0
    dondursun (aksi halde enstrumantasyon calismiyor gibi gorunur)."""
    env = environment or resolve_environment()
    for cls in STATUS_CLASSES:
        REQUESTS.labels(
            project=PROJECT,
            environment=env,
            service=SERVICE,
            status_class=cls,
        )
    DURATION.labels(project=PROJECT, environment=env, service=SERVICE)
    return env


_server_lock = threading.Lock()
_server = None


def start_metrics_server(port=None):
    """/metrics'i ayri in-cluster portta yayinlar (daemon thread).
    Ingress'e ASLA baglanmaz: 09-mcp-ingress yalnizca /mcp ve PRM
    yollarini tasir. Baglama hatasi servisi dusurmez."""
    global _server
    with _server_lock:
        if _server is not None:
            return _server.server_port
        target = port if port is not None else _configured_port()
        try:
            server, _thread = start_http_server(target, registry=REGISTRY)
        except OSError as exc:
            print(f"⚠️  Metrik sunucusu {target} portunda baslatilamadi: {exc}")
            return None
        _server = server
        print(f"📈 Metrikler yayinda: :{server.server_port}/metrics")
        return server.server_port


def _configured_port() -> int:
    raw = (os.environ.get("METRICS_PORT") or "").strip()
    if not raw:
        return DEFAULT_METRICS_PORT
    try:
        return int(raw)
    except ValueError:
        print(
            f"⚠️  METRICS_PORT gecersiz ({raw!r}) — "
            f"{DEFAULT_METRICS_PORT} kullaniliyor"
        )
        return DEFAULT_METRICS_PORT
