# =============================================================================
# HERMES - OpenTelemetry izleri (Drake'e OTLP ile)
# =============================================================================
# Ne: auth/core/reporting servisleri her HTTP istegi, her SQL sorgusu ve
# her servisler-arasi httpx cagrisi icin span uretir ve bunlari OTLP gRPC
# ile Drake'in toplayicisina (drake-otel-gateway) yollar.
#
# Neden SDK (eBPF/OBI degil): OBI yalnizca BULUNDUGU node'u gorur ve
# kumede node1'e (control-plane, zaten yorgun) ek ajan kurmak istemiyoruz.
# SDK izi uygulamanin icinden uretir; pod hangi node'da olursa olsun calisir.
#
# --- DATADOG ILE YAN YANA (bilincli tasarim) -------------------------------
# Kumede Datadog "single step APM" acik: her Hermes pod'una ddtrace enjekte
# edilir ve ddtrace W3C `traceparent` + `x-datadog-*` basliklarini yazar/okur.
# Datadog'a DOKUNMUYORUZ (sirket onu kullaniyor). Cakismayi BIZ onluyoruz:
#   * Yayilim (propagation) varsayilani B3 (`b3` basligi). ddtrace B3'u
#     varsayilan olarak ne yazar ne okur; biz de traceparent'a dokunmayiz.
#     Iki izleyici ayni istek uzerinde birbirinin baglamini EZEMEZ.
#   * TracerProvider ACIKCA enstrumantasyonlara verilir; global saglayiciya
#     guvenilmez (ddtrace'in OTel koprusu bir gun acilsa bile spanlarimiz
#     Datadog'a degil Drake'e gider).
# Datadog birakildiginda W3C'ye gecis = env'de OTEL_PROPAGATORS=tracecontext
# (kod degismez).
#
# --- KAPALI VARSAYILAN ------------------------------------------------------
# OTEL_EXPORTER_OTLP_ENDPOINT (ya da ..._TRACES_ENDPOINT) tanimli degilse
# hicbir sey yapilmaz: enstrumantasyon import bile edilmez. Testler, yerel
# gelistirme ve env'i verilmemis pod'lar etkilenmez. OTEL_SDK_DISABLED=true
# ve OTEL_TRACES_EXPORTER=none acik kapatma anahtarlaridir.
#
# --- SIZINTI KORUMASI (testle kilitli) ---------------------------------------
# * URL sorgu dizesi ve kullanici:parola kisimlari span'a GIRMEZ
#   (`?token=...`, `?workspace=...`, arama terimleri). Yalnizca yol kalir.
# * Istek/yanit basliklari kaydedilmez (Authorization, Cookie dahil).
# * SQL yalnizca parametreli haliyle gider (degerler degil); SQL'e yorum
#   ekleyen "commenter" KAPALI — sorgular degistirilmez.
#
# --- ASLA ISTEGI KIRMAZ ------------------------------------------------------
# Kurulumdaki her hata yakalanir, uyari basilir, servis izsiz acilir.
# Disa aktarim arka plan thread'inde (BatchSpanProcessor); toplayici
# erisilemezse spanlar dusurulur, istek beklemez.
# =============================================================================

import os
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from shared.metrics import PROJECT, resolve_environment

ENDPOINT_ENV_VARS = (
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
)
PROPAGATORS_ENV_VAR = "OTEL_PROPAGATORS"

# Saglik/hazirlik problari ve metrik ucu izlenmez: kubelet trafigi gercek
# istekleri bogar ve toplayiciya anlamsiz yuk bindirir.
EXCLUDED_URLS = "/health$,/ready$,/metrics$"

# URL tasiyan span ozellikleri (eski ve kararli HTTP semantik adlari).
_FULL_URL_KEYS = ("http.url", "url.full")
_TARGET_KEYS = ("http.target",)
_QUERY_KEYS = ("url.query",)

# Surec basina tek seferlik global yamalar (httpx) ve motor bazli
# enstrumantasyon icin koruma.
_state = {"provider": None, "httpx": False, "engines": set()}


def tracing_enabled() -> bool:
    """Izler yalnizca bir OTLP hedefi ACIKCA verildiyse acilir."""
    if (os.environ.get("OTEL_SDK_DISABLED") or "").strip().lower() == "true":
        return False
    if (os.environ.get("OTEL_TRACES_EXPORTER") or "").strip().lower() == "none":
        return False
    return any((os.environ.get(k) or "").strip() for k in ENDPOINT_ENV_VARS)


def strip_url(value: str) -> str:
    """Tam URL'den sorgu dizesini, parcayi ve kullanici bilgisini atar."""
    try:
        parts = urlsplit(value)
        netloc = parts.hostname or ""
        if parts.port:
            netloc = f"{netloc}:{parts.port}"
        return urlunsplit((parts.scheme, netloc, parts.path, "", ""))
    except Exception:  # noqa: BLE001 — cozulemeyen deger hic yazilmaz
        return ""


def strip_target(value: str) -> str:
    """`/yol?x=1` -> `/yol`."""
    return value.split("?", 1)[0].split("#", 1)[0]


def sanitize_span(span) -> None:
    """Span'daki URL ozelliklerinden sorgu/kimlik bilgisini atar.

    Iki noktadan cagrilir: (1) her span BASLARKEN (islemci on_start —
    httpx ve SQL ozelliklerini olusturmada yazar), (2) ASGI sunucu span'i
    icin `server_request_hook` — ASGI enstrumantasyonu istek ozelliklerini
    span basladiktan SONRA tekrar yazar, hook ondan sonra calisir. Hata
    istegi kirmaz.
    """
    try:
        attrs = span.attributes or {}
        for key in _FULL_URL_KEYS:
            if key in attrs:
                span.set_attribute(key, strip_url(str(attrs[key])))
        for key in _TARGET_KEYS:
            if key in attrs:
                span.set_attribute(key, strip_target(str(attrs[key])))
        for key in _QUERY_KEYS:
            if key in attrs:
                span.set_attribute(key, "")
    except Exception:  # noqa: BLE001 — temizlik istegi kirmaz
        pass


def _server_request_hook(span, scope) -> None:
    if span is not None and span.is_recording():
        sanitize_span(span)


def _match_route(routes, scope, prefix=""):
    """Starlette route sablonunu bulur (`/items/{item_id}`); mount'lara iner.

    Sablon SINIRLI bir kumedir (kod tanimlar) — gercek yol (kimlikler)
    span adina girmez.
    """
    from starlette.routing import Match, Mount

    for route in routes:
        match, child = route.matches(scope)
        if match != Match.FULL:
            continue
        path = getattr(route, "path", None)
        if isinstance(route, Mount):
            inner = _match_route(
                getattr(route, "routes", []) or [], {**scope, **child}, prefix + (path or "")
            )
            return inner or (prefix + (path or "")) or None
        return (prefix + path) if path is not None else None
    return None


def span_details_for(app):
    """ASGI middleware'i icin (span adi, ozellikler) ureticisi."""

    def details(scope):
        method = (scope.get("method") or "HTTP").upper()
        try:
            route = _match_route(app.routes, scope)
        except Exception:  # noqa: BLE001 — ad cozulemezse yalnizca metot
            route = None
        if route:
            return f"{method} {route}", {"http.route": route}
        return method, {}

    return details


def _sanitizing_processor_cls():
    from opentelemetry.sdk.trace import SpanProcessor

    class SanitizingSpanProcessor(SpanProcessor):
        """Span BASLARKEN URL ozelliklerini temizler (diger islemcilerden
        ONCE eklenir)."""

        def on_start(self, span, parent_context=None):  # noqa: D401
            sanitize_span(span)

    return SanitizingSpanProcessor


def build_resource(service: str):
    """Servis kimligi + Kubernetes baglami.

    service.name metrik sozlesmesindeki `service` degeriyle AYNI
    (core-service vb.); environment katalog anahtari (dev/test). k8s.*
    ozellikleri pod'a Downward API ile verilen OTEL_RESOURCE_ATTRIBUTES'tan
    gelir (Drake gateway'i izlere k8s ozelligi EKLEMEZ). Burada verilenler
    env'dekilerin uzerine yazar.
    """
    from opentelemetry.sdk.resources import Resource

    env = resolve_environment()
    return Resource.create({
        "service.name": service,
        "service.namespace": PROJECT,
        "deployment.environment.name": env,
        "deployment.environment": env,
    })


def _install_propagator() -> None:
    """Env'de acik secim yoksa B3 (Datadog ile cakismasin diye)."""
    if (os.environ.get(PROPAGATORS_ENV_VAR) or "").strip():
        return  # OTEL_PROPAGATORS'i OTel kendisi okur
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.propagators.b3 import B3SingleFormat

    set_global_textmap(B3SingleFormat())


def setup_tracing(app, service: str, engine=None, span_processor=None):
    """Servisi izler icin enstrumante eder; kapaliysa hicbir sey yapmaz.

    `span_processor` yalnizca testler icindir (bellek ici disa aktarim).
    Donus: TracerProvider ya da None (kapali/basarisiz).
    """
    if span_processor is None and not tracing_enabled():
        return None
    try:
        provider = _state["provider"]
        if provider is None:
            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider

            provider = TracerProvider(resource=build_resource(service))
            provider.add_span_processor(_sanitizing_processor_cls()())
            if span_processor is None:
                from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                    OTLPSpanExporter,
                )
                from opentelemetry.sdk.trace.export import BatchSpanProcessor

                span_processor = BatchSpanProcessor(OTLPSpanExporter())
            provider.add_span_processor(span_processor)
            _install_propagator()
            try:
                trace.set_tracer_provider(provider)
            except Exception:  # noqa: BLE001 — global zaten ayarliysa sorun degil
                pass
            _state["provider"] = provider

        # FastAPIInstrumentor KULLANILMAZ: Datadog ddtrace Starlette'in
        # middleware yiginini degistirdigi icin o enstrumantor "beklenmeyen
        # yigin" deyip SESSIZCE atlar (ddtrace-run ile dogrulandi). ASGI
        # middleware'ini dogrudan takiyoruz; route adini kendimiz cozuyoruz.
        if not getattr(app.state, "hermes_tracing", False):
            from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware

            app.add_middleware(
                OpenTelemetryMiddleware,
                tracer_provider=provider,
                excluded_urls=EXCLUDED_URLS,
                default_span_details=span_details_for(app),
                server_request_hook=_server_request_hook,
                # Her govde parcasi icin acilan ic spanlar gurultudur.
                exclude_spans=["receive", "send"],
            )
            app.state.hermes_tracing = True

        if not _state["httpx"]:
            from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

            HTTPXClientInstrumentor().instrument(tracer_provider=provider)
            _state["httpx"] = True

        if engine is not None and id(engine) not in _state["engines"]:
            from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

            SQLAlchemyInstrumentor().instrument(
                engine=engine,
                tracer_provider=provider,
                enable_commenter=False,
            )
            _state["engines"].add(id(engine))

        print(f"🔭 OpenTelemetry izleri acik ({service})")
        return provider
    except Exception as exc:  # noqa: BLE001 — izsiz acilmak, acilmamaktan iyidir
        print(f"⚠️  OpenTelemetry kurulamadi, izsiz devam: {exc!r}")
        return None


SHUTDOWN_TIMEOUT_SECONDS = 3.0


def shutdown_tracing(timeout: float = SHUTDOWN_TIMEOUT_SECONDS) -> None:
    """Kapanista kuyruktaki spanlari bosaltir (lifespan shutdown).

    Sureyle SINIRLI: toplayiciya ulasilamazken disa aktarici yeniden
    dener ve kapanisi ~10 sn uzatir; pod sonlandirmasi buna takilmamali.
    Sure dolarsa kalan spanlar dusurulur.
    """
    import threading

    provider: Optional[object] = _state["provider"]
    if provider is None:
        return

    def _shutdown():
        try:
            provider.shutdown()
        except Exception:  # noqa: BLE001
            pass

    worker = threading.Thread(target=_shutdown, daemon=True)
    worker.start()
    worker.join(timeout)
