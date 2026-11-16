# =============================================================================
# hermes-mcp - OpenTelemetry izleri (Drake'e OTLP ile)
# =============================================================================
# hermes_mcp `shared` paketini import EDEMEZ (yapisal kural), bu yuzden
# backend/shared/tracing.py'nin davranisi burada BAGIMSIZ uygulanir; iki
# kopya arasindaki kayma tests/test_tracing.py'deki parite testiyle yasak.
# Gerekce ve Datadog ile yan yana calisma: backend/shared/tracing.py ust
# yorumu + docs/observability-tracing.md. Ozet:
#   * OTLP hedefi env'de yoksa KAPALI (enstrumantasyon import edilmez).
#   * Yayilim B3 (W3C traceparent Datadog ddtrace'in); MCP -> Public API
#     cagrisi ayni ize baglanir.
#   * Sorgu dizesi, basliklar (Bearer hms_...) span'a girmez.
#
# MCP'ye ozel:
#   * Her arac cagrisi icin `mcp.tool <ad>` span'i. Ad, kayitli arac
#     kumesinden gelir (sinirli). Arac ARGUMANLARI ve SONUCU span'a
#     GIRMEZ — guvenilmez kullanici verisi + kisisel veri.
#   * "Tek upstream" kurali: arac girdisinden hicbir URL turetilmez. OTLP
#     hedefi YALNIZCA operatorun verdigi env'den gelir; gonderim kullanici
#     verisi tasimayan telemetridir. Kural "Public API + telemetri ucu"
#     olarak genisletildi (testle kilitli).
# =============================================================================

import contextlib
import os
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from .metrics import PROJECT, SERVICE, resolve_environment

ENDPOINT_ENV_VARS = (
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
)
PROPAGATORS_ENV_VAR = "OTEL_PROPAGATORS"
EXCLUDED_URLS = "/health$,/ready$,/metrics$"

_FULL_URL_KEYS = ("http.url", "url.full")
_TARGET_KEYS = ("http.target",)
_QUERY_KEYS = ("url.query",)

_state = {"provider": None, "tracer": None, "httpx": False, "routes": None}


def tracing_enabled() -> bool:
    if (os.environ.get("OTEL_SDK_DISABLED") or "").strip().lower() == "true":
        return False
    if (os.environ.get("OTEL_TRACES_EXPORTER") or "").strip().lower() == "none":
        return False
    return any((os.environ.get(k) or "").strip() for k in ENDPOINT_ENV_VARS)


def strip_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        netloc = parts.hostname or ""
        if parts.port:
            netloc = f"{netloc}:{parts.port}"
        return urlunsplit((parts.scheme, netloc, parts.path, "", ""))
    except Exception:  # noqa: BLE001
        return ""


def strip_target(value: str) -> str:
    return value.split("?", 1)[0].split("#", 1)[0]


def sanitize_span(span) -> None:
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
    except Exception:  # noqa: BLE001
        pass


def _server_request_hook(span, scope) -> None:
    if span is not None and span.is_recording():
        sanitize_span(span)


def _sanitizing_processor_cls():
    from opentelemetry.sdk.trace import SpanProcessor

    class SanitizingSpanProcessor(SpanProcessor):
        def on_start(self, span, parent_context=None):  # noqa: D401
            sanitize_span(span)

    return SanitizingSpanProcessor


def _match_route(routes, scope, prefix=""):
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


def _span_details(scope):
    method = (scope.get("method") or "HTTP").upper()
    try:
        route = _match_route(_state["routes"] or [], scope)
    except Exception:  # noqa: BLE001
        route = None
    if route:
        return f"{method} {route}", {"http.route": route}
    return method, {}


def build_resource():
    from opentelemetry.sdk.resources import Resource

    env = resolve_environment()
    return Resource.create({
        "service.name": SERVICE,
        "service.namespace": PROJECT,
        "deployment.environment.name": env,
        "deployment.environment": env,
    })


def _install_propagator() -> None:
    if (os.environ.get(PROPAGATORS_ENV_VAR) or "").strip():
        return
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.propagators.b3 import B3SingleFormat

    set_global_textmap(B3SingleFormat())


class TracingMiddleware:
    """Starlette yiginda HER ZAMAN duran ince ASGI katmani.

    Izler kapaliyken dogrudan gecirir (tek sozluk okumasi). Acikken
    OpenTelemetry ASGI middleware'ini ilk istekte kurup ona devreder.
    Bu sayede uygulama import aninda kurulur, izler kurulumdan BAGIMSIZ
    acilip kapanabilir (Starlette baslatildiktan sonra middleware
    eklenemez).
    """

    def __init__(self, app) -> None:
        self.app = app
        self._otel = None
        self._provider = None

    async def __call__(self, scope, receive, send):
        provider = _state["provider"]
        if provider is None or scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        if self._otel is None or self._provider is not provider:
            from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware

            self._otel = OpenTelemetryMiddleware(
                self.app,
                tracer_provider=provider,
                excluded_urls=EXCLUDED_URLS,
                default_span_details=_span_details,
                server_request_hook=_server_request_hook,
                exclude_spans=["receive", "send"],
            )
            self._provider = provider
        await self._otel(scope, receive, send)


def setup_tracing(app, span_processor=None):
    """Izleri acar; kapaliysa hicbir sey yapmaz. `span_processor` testler
    icindir. Donus: TracerProvider ya da None."""
    if span_processor is None and not tracing_enabled():
        return None
    try:
        provider = _state["provider"]
        if provider is None:
            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider

            provider = TracerProvider(resource=build_resource())
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
            except Exception:  # noqa: BLE001
                pass

        if not _state["httpx"]:
            # Upstream (Public API) cagrisi: istemci span'i + b3 basligi.
            from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

            HTTPXClientInstrumentor().instrument(tracer_provider=provider)
            _state["httpx"] = True

        _state["routes"] = list(getattr(app, "routes", []) or [])
        _state["tracer"] = provider.get_tracer("hermes_mcp")
        _state["provider"] = provider
        print("🔭 OpenTelemetry izleri acik (hermes-mcp)")
        return provider
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  OpenTelemetry kurulamadi, izsiz devam: {exc!r}")
        return None


@contextlib.contextmanager
def tool_span(name: str, write: bool):
    """Arac cagrisi span'i; izler kapaliysa hicbir sey yapmaz.

    Yalnizca arac ADI (kayitli kume) ve yazma bayragi yazilir. Argumanlar
    ve sonuc ASLA. Hata durumunu `mark_tool_error` isaretler.
    """
    tracer = _state["tracer"]
    if tracer is None:
        yield None
        return
    with tracer.start_as_current_span(
        f"mcp.tool {name}",
        attributes={"mcp.tool.name": name, "mcp.tool.write": bool(write)},
    ) as span:
        yield span


def mark_tool_error(span, payload) -> None:
    """Upstream hata zarfindaki KOD (12'lik kapali katalog) yazilir;
    mesaj yazilmaz."""
    if span is None:
        return
    try:
        from opentelemetry.trace import Status, StatusCode

        code = ((payload or {}).get("error") or {}).get("code")
        if isinstance(code, str) and len(code) <= 64:
            span.set_attribute("error.type", code)
        span.set_status(Status(StatusCode.ERROR))
    except Exception:  # noqa: BLE001
        pass


SHUTDOWN_TIMEOUT_SECONDS = 3.0


def shutdown_tracing(timeout: float = SHUTDOWN_TIMEOUT_SECONDS) -> None:
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
