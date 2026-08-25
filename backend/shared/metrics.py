# =============================================================================
# HERMES - Prometheus HTTP metrikleri (Drake sozlesmesi — TEK KAYNAK)
# =============================================================================
# Drake (platform ekibinin gozlemlenebilirlik kontrol duzlemi) CPU/bellek/
# restart/pod sagligini Kubernetes'ten gorur. Request rate, hata orani ve
# p95 gecikme ise YALNIZCA uygulama yayarsa vardir. Sozlesme
# (HERMES_METRICS.md) BIREBIR sudur:
#
#   http_server_requests_total            counter
#     etiketler: project, environment, service, status_class
#   http_server_request_duration_seconds  histogram  (SANIYE — ms DEGIL)
#     etiketler: project, environment, service
#
# Tek bir etiket adi sapsa metrik TOPLANIR ama hicbir ekranda GORUNMEZ:
# haftalar sonra fark edilen sessiz basarisizlik. Bu yuzden adlar ve
# degerler burada sabittir ve testle kilitlidir (her serviste
# tests/test_metrics_contract.py).
#
# YASAK etiketler (Drake katalogu reddeder + sinirsiz kardinalite metrik
# backend'ini bogar): pod, container, instance, route, path, method,
# tenant, customer, kullanici/e-posta/istek kimlikleri. Yol AGREGE
# EDILIR — burada route/path etiketi YOKTUR. Endpoint kirilimi istenirse
# ayri bir konusma: sinirli, allow-list'li route adlari.
#
# environment = KATALOG ANAHTARI ('dev' | 'test'), namespace DEGIL
# ('hermes-dev' YANLIS — en olasi hata). Deger HERMES_ENVIRONMENT
# env'inden okunur. DIKKAT: mevcut hermes-config ConfigMap'indeki
# ENVIRONMENT anahtari hermes-dev'de "production" tasir; bu yuzden o
# anahtar BILEREK kullanilmaz.
#
# Middleware istegin TAM YOLUNDA oturur. Maliyet: iki perf_counter + iki
# etiketli gozlem. Govde okunmaz/tamponlanmaz, yanit degistirilmez,
# olcum hatasi istegi ASLA kirmaz (gozlem try/except ile izole).
#
# /metrics AYRI bir in-cluster portta (varsayilan 9090) yayinlanir;
# uygulama portuna ve ingress'e HIC dokunmaz — public ingress yalnizca
# Service port 80 -> uygulama portuna gider, dolayisiyla metrik ucu
# kumeden yapisal olarak cikamaz.
# =============================================================================

import os
import threading
from time import perf_counter
from typing import Iterable, Optional

from prometheus_client import (
    CollectorRegistry, Counter, Histogram, start_http_server,
)

# --- Sozlesme sabitleri (degistirilemez — Drake sorgu kaydi) --------------

PROJECT = "hermes"
REQUESTS_METRIC = "http_server_requests_total"
DURATION_METRIC = "http_server_request_duration_seconds"

# Kapali kume: status_class SINIFI tasir, kodu DEGIL ('500' yanlis,
# '5xx' dogru).
STATUS_CLASSES = ("2xx", "3xx", "4xx", "5xx")

# Saniye cinsinden bucket'lar (prometheus_client varsayilani). p95 icin
# yeterli cozunurluk; +Inf otomatik eklenir.
DURATION_BUCKETS = (
    0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75,
    1.0, 2.5, 5.0, 7.5, 10.0,
)

DEFAULT_METRICS_PORT = 9090
ENVIRONMENT_ENV_VAR = "HERMES_ENVIRONMENT"
# Katalogda kayitli ortamlar. Disindaki bir deger sessizce kabul
# edilmez: 'unknown' ile yayilir (seri VARDIR ama Drake sorgusuna
# DUSMEZ) ve startup'ta uyari basilir — bos dashboard'dan cok daha
# kolay teshis edilir.
KNOWN_ENVIRONMENTS = ("dev", "test")
UNKNOWN_ENVIRONMENT = "unknown"

# Saglik problari olculmez: kubelet trafigi gercek istek hacmini sisirir
# ve hizli /health yanitlari p95'i asagi cekip gercek yavasligi gizler.
DEFAULT_EXCLUDED_PATHS = frozenset({"/health"})


# --- Metrik nesneleri (surec basina TEK KEZ) ------------------------------
# Modul seviyesinde tanimlidir; setup_metrics birden fazla kez cagrilsa
# bile ikinci kayit denenmez.
#
# OZEL registry (varsayilan global REGISTRY DEGIL) iki nedenle:
#   1) hermes_mcp/metrics.py ayni metrik adlarini bagimsiz tanimlar; MCP
#      test harness'i core uygulamasini AYNI surecte calistirdigi icin
#      global registry'de "Duplicated timeseries" hatasi olusurdu.
#   2) Scrape ciktisi sozlesmedeki iki metrigi ETIKETLERIYLE tasir;
#      ayrica etiketSIZ surec/GC metrikleri eklenir (asagida).

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

# -----------------------------------------------------------------------------
# Surec metrikleri (bellek/CPU/GC)
# -----------------------------------------------------------------------------
# Onceki yorum "CPU/bellek zaten Kubernetes'ten geliyor" diyordu ve bu
# yuzden surec metrikleri bilerek disarida birakilmisti. BU VARSAYIM BU
# KUMEDE GECERLI DEGIL: metrics-server kurulu degil, `kubectl top`
# calismiyor. Sonuc: hermes-test'te core-service araliklarla tikanip
# liveness probe tarafindan oldurulurken bellek egrisine BAKAMADIK —
# hipotez kurup dogrulayamadik.
#
# Eklenenler etiketSIZdir (`process_resident_memory_bytes`,
# `process_cpu_seconds_total`, `python_gc_*`), dolayisiyla sozlesmedeki
# etiket disiplinini BOZMAZ: yol/pod/route gibi sinirsiz etiket yok.
# Iki sozlesme metriginin adi ve etiketleri aynen kalir.
try:  # pragma: no cover - surum farki startup'i DUSURMEMELI
    from prometheus_client import GCCollector, ProcessCollector

    ProcessCollector(registry=REGISTRY)
    GCCollector(registry=REGISTRY)
except Exception:  # noqa: BLE001
    # Metrik toplayici eklenemezse servis yine de acilir: gozlemlenebilirlik
    # onemlidir ama uygulamayi dusurecek kadar degil.
    pass




def resolve_environment() -> str:
    """Katalog anahtarini env'den cozer ('dev' | 'test').

    Namespace adi (hermes-dev) ya da bos deger KABUL EDILMEZ; boyle bir
    durumda 'unknown' doner — metrik yine yayilir, ama yanlis degerle
    dogru sorguya dusup 'calisiyor' izlenimi vermez.
    """
    value = (os.environ.get(ENVIRONMENT_ENV_VAR) or "").strip()
    if value in KNOWN_ENVIRONMENTS:
        return value
    return UNKNOWN_ENVIRONMENT


def status_class(status_code: int) -> str:
    """HTTP durum kodunu SINIFA cevirir. Cikti kumesi kapalidir:
    2xx/3xx/4xx/5xx disinda bir deger URETILEMEZ."""
    if 500 <= status_code:
        return "5xx"
    if 400 <= status_code < 500:
        return "4xx"
    if 300 <= status_code < 400:
        return "3xx"
    if 200 <= status_code < 300:
        return "2xx"
    # 1xx: gecici/bilgi yaniti — hata degildir, basarili sayilir.
    return "2xx"


class PrometheusMiddleware:
    """Ham ASGI middleware: istegi olcer, ASLA degistirmez.

    Ham ASGI (BaseHTTPMiddleware DEGIL) bilincli tercih: BaseHTTPMiddleware
    yaniti bir stream'e sarar, arka plan gorevleri/streaming yanitlar icin
    ek yol acar ve gecikme ekler. Burada yapilan tek is send mesajlarini
    izleyip durum kodunu yakalamaktir.
    """

    def __init__(
        self,
        app,
        service: str,
        environment: Optional[str] = None,
        excluded_paths: Optional[Iterable[str]] = None,
    ) -> None:
        self.app = app
        self.service = service
        self.environment = environment or resolve_environment()
        self.excluded_paths = frozenset(
            DEFAULT_EXCLUDED_PATHS if excluded_paths is None else excluded_paths
        )

    async def __call__(self, scope, receive, send):
        # HTTP disi kapsamlar (lifespan, websocket) dokunulmadan gecer.
        if scope.get("type") != "http" or scope.get("path") in self.excluded_paths:
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
            # Istisna DISARI aynen gider (ServerErrorMiddleware 500'u
            # uretir); biz yalnizca sayariz. Yanit baslamissa gercek
            # kodu, baslamamissa 5xx'i kaydederiz.
            self._observe(seen["status"] or 500, perf_counter() - started)
            raise
        self._observe(seen["status"] or 500, perf_counter() - started)

    def _observe(self, status_code: int, elapsed_seconds: float) -> None:
        """Olcum ASLA istegi kirmaz: burada olusabilecek her hata yutulur.
        Bir metrik kaydi ugruna canli istek dusurmek kabul edilemez."""
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


def preinit_series(service: str, environment: str) -> None:
    """Etiket kombinasyonlarini 0 degeriyle onceden yaratir.

    Sebep: Prometheus'ta bir seri ancak ILK kez yazildiginda dogar. Bos
    bir ortamda hic 5xx olmazsa hata orani sorgusu VERI YOK doner ve
    "enstrumantasyon calismiyor" gibi gorunur. Onceden yaratilan sifir
    seriler sayesinde sorgular 0 doner.
    """
    for cls in STATUS_CLASSES:
        REQUESTS.labels(
            project=PROJECT,
            environment=environment,
            service=service,
            status_class=cls,
        )
    DURATION.labels(
        project=PROJECT, environment=environment, service=service
    )


def setup_metrics(app, service: str, environment: Optional[str] = None) -> str:
    """Servisi enstrumante eder: middleware + sifir seriler.

    Soket ACMAZ (test/import guvenli) — /metrics sunucusu ayrica
    start_metrics_server() ile, yalnizca gercek calisma sirasinda
    (lifespan startup) baslatilir.
    """
    env = environment or resolve_environment()
    if env == UNKNOWN_ENVIRONMENT:
        print(
            f"⚠️  {ENVIRONMENT_ENV_VAR} tanimsiz/gecersiz — metrikler "
            f"environment=\"{UNKNOWN_ENVIRONMENT}\" ile yayilacak "
            f"(beklenen: {', '.join(KNOWN_ENVIRONMENTS)})"
        )
    app.add_middleware(PrometheusMiddleware, service=service, environment=env)
    preinit_series(service, env)
    return env


_server_lock = threading.Lock()
_server = None


def start_metrics_server(port: Optional[int] = None) -> Optional[int]:
    """/metrics'i ayri bir in-cluster portta (daemon thread) yayinlar.

    Neden ayri port ve ayri thread:
      - Uygulama portu ingress'e bagli; metrik ucu oraya HIC dusmez.
      - Event loop tikandiginda bile scrape yanit verir; Drake'in
        'up' sinyali uygulama yavasligiyla karismaz.

    Baglama hatasi (ornegin port dolu) servisi DUSURMEZ: uyari basilir,
    uygulama normal calismaya devam eder. Baglanan port doner.
    """
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
