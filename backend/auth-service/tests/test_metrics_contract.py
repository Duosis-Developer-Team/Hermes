# =============================================================================
# Drake metrik sozlesmesi — auth-service tarafi (HERMES_METRICS.md)
# =============================================================================
# Sozlesmenin TAM kilidi core-service suite'indedir (middleware davranisi,
# etiket kumeleri, k8s manifest kontrolu). Burada auth-service'e OZGU olan
# sey dogrulanir: uygulama gercekten enstrumante mi ve 'service' etiketi
# dashboard'larin bekledigi deger mi ('auth-service').
# =============================================================================

from fastapi.testclient import TestClient

from shared import metrics as m


def _count(service, status_class, environment):
    return m.REGISTRY.get_sample_value(
        "http_server_requests_total",
        {
            "project": "hermes",
            "environment": environment,
            "service": service,
            "status_class": status_class,
        },
    ) or 0.0


def test_auth_app_is_instrumented_with_the_contract_service_label():
    from app.main import app

    installed = [
        mw for mw in app.user_middleware if mw.cls is m.PrometheusMiddleware
    ]
    assert len(installed) == 1, "auth-service enstrumante degil (ya da iki kez)"
    assert installed[0].kwargs["service"] == "auth-service"


def test_requests_are_counted_by_status_class():
    from app.main import app

    client = TestClient(app, raise_server_exceptions=False)
    env = m.resolve_environment()
    before = _count("auth-service", "4xx", env)
    # Var olmayan yol → 404; kimlik dogrulama gerekmez.
    assert client.get("/__does_not_exist__").status_code == 404
    assert _count("auth-service", "4xx", env) == before + 1


def test_health_probe_traffic_is_not_measured():
    from app.main import app

    client = TestClient(app, raise_server_exceptions=False)
    env = m.resolve_environment()
    before = sum(
        _count("auth-service", c, env) for c in m.STATUS_CLASSES
    )
    for _ in range(3):
        assert client.get("/health").status_code == 200
    after = sum(_count("auth-service", c, env) for c in m.STATUS_CLASSES)
    assert after == before


def test_forbidden_labels_never_appear():
    """pod/route/path/instance gibi sinirsiz etiketler Drake katalogunca
    reddedilir ve seri sayisini patlatir."""
    for metric in (m.REQUESTS, m.DURATION):
        labels = set(metric._labelnames)
        assert not (labels & {
            "pod", "container", "instance", "route", "path", "method",
            "tenant", "customer", "user", "email", "request_id",
            "status_code",
        })
