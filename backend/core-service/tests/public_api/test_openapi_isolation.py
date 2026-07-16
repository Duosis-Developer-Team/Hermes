# =============================================================================
# HERMES Public API - OpenAPI izolasyon + internal hardening testleri
# =============================================================================
# Guvence altina alinanlar:
#   1) Public sema YALNIZCA /v1/* yollarini icerir; internal /api/v1/core
#      route'lari veya semalari asla sizmali.
#   2) Internal uygulamanin /openapi.json'i DEBUG=False iken 404'tur
#      (docs/redoc zaten kapali) — public sema bundan ETKILENMEZ.
#   3) Public semada Bearer guvenlik semasi + scope metadata dogru uretilir.
#
# Bu dosya app.main'i (tam internal uygulama) import eder; conftest env'i
# hazirlar, DB baglantisi ACILMAZ (lifespan calismaz).
# =============================================================================

from fastapi import FastAPI
from fastapi.testclient import TestClient

import pytest


@pytest.fixture(scope="module")
def main_client():
    from app.main import app  # conftest env'i sonrasi guvenli

    return TestClient(app, raise_server_exceptions=False)


def test_internal_openapi_hidden_when_not_debug(main_client):
    # conftest DEBUG'i ayarlamaz -> default False (prod davranisi).
    assert main_client.get("/openapi.json").status_code == 404
    assert main_client.get("/docs").status_code == 404
    assert main_client.get("/redoc").status_code == 404


def test_public_openapi_still_available_on_main_app(main_client):
    r = main_client.get("/api/public/v1/openapi.json")
    assert r.status_code == 200
    assert r.json()["info"]["title"] == "Hermes Public API"


def test_public_docs_still_available_on_main_app(main_client):
    assert main_client.get("/api/public/v1/docs").status_code == 200


def test_public_schema_contains_only_v1_paths(main_client):
    paths = main_client.get("/api/public/v1/openapi.json").json()["paths"]
    assert paths, "public schema must not be empty"
    for p in paths:
        assert p.startswith("/v1/"), f"non-public path leaked: {p}"
        assert not p.startswith("/api/v1"), f"internal path leaked: {p}"


def test_public_schema_has_no_internal_schemas(main_client):
    schema = main_client.get("/api/public/v1/openapi.json").json()
    component_names = set(
        (schema.get("components", {}).get("schemas") or {}).keys()
    )
    # Internal semalardan bilinen hassas ornekler asla gorunmemeli.
    forbidden = {
        "TaskResponse",
        "TaskPermissionMeResponse",
        "TaskPermissionRow",
        "NotificationSettingRow",
        "WorkLogResponse",
    }
    assert not (component_names & forbidden), component_names & forbidden


def test_internal_schema_never_lists_public_mount(main_client):
    # Internal semayi dogrudan uygulama nesnesinden uret (route kapali
    # olsa bile) — mount edilen public app internal semaya route olarak
    # girmemeli.
    from app.main import app

    internal_schema = app.openapi()
    assert all(
        not p.startswith("/api/public")
        for p in internal_schema.get("paths", {})
    )


def test_public_schema_declares_bearer_security_scheme(main_client):
    schema = main_client.get("/api/public/v1/openapi.json").json()
    token_scheme = schema["components"]["securitySchemes"]["ApiToken"]
    assert token_scheme["type"] == "http"
    assert token_scheme["scheme"] == "bearer"


def test_public_schema_documents_scope_catalog(main_client):
    schema = main_client.get("/api/public/v1/openapi.json").json()
    desc = schema["info"]["description"]
    assert "## Scopes" in desc
    assert "`tasks:read`" in desc


def test_scope_marked_route_gets_security_and_docs():
    # scope_docs ile isaretlenen route'a security + aciklama islenir.
    from app.public_api.app import create_public_app
    from app.public_api.scopes import scope_docs

    public = create_public_app()

    @public.get("/v1/_test/protected", openapi_extra=scope_docs("tasks:read"))
    async def _protected():  # pragma: no cover - sadece sema icin
        return {}

    root = FastAPI()
    root.mount("/api/public", public)
    schema = (
        TestClient(root)
        .get("/api/public/v1/openapi.json")
        .json()
    )
    op = schema["paths"]["/v1/_test/protected"]["get"]
    assert op["security"] == [{"ApiToken": []}]
    assert "Required scopes" in op["description"]
    assert "`tasks:read`" in op["description"]
