# =============================================================================
# HERMES Public API - Stage 1A/1B foundation tests
# =============================================================================
# Kapsam: hata zarfi, request-ID, meta endpoint'ler, pagination sozlesmesi.
# DB gerektirmez (lifespan calismaz, hicbir endpoint DB'ye dokunmaz).
# =============================================================================

from fastapi import Depends, FastAPI, Query
from fastapi.testclient import TestClient

from app.public_api.app import create_public_app
from app.public_api.errors import ERROR_STATUS, PublicAPIError
from app.public_api.pagination import PageParams, page_params, paginated
from app.public_api.scopes import SCOPES, scope_docs

import pytest


@pytest.fixture()
def client():
    """Public sub-app'i prod'daki gibi /api/public altina mount ederek test
    eder (root_path davranisi dahil)."""
    root = FastAPI()
    root.mount("/api/public", create_public_app())
    return TestClient(root, raise_server_exceptions=False)


@pytest.fixture()
def rich_client():
    """Zarf/pagination davranislarini dogrulamak icin test-only route'lar
    eklenmis public app (gercek yuzeye route eklemez)."""
    public = create_public_app()

    @public.get("/v1/_test/boom")
    async def _boom():
        raise RuntimeError("secret internal detail must not leak")

    @public.get("/v1/_test/custom-error")
    async def _custom():
        raise PublicAPIError("conflict", "Duplicate thing.")

    @public.get("/v1/_test/validated")
    async def _validated(count: int = Query(..., ge=1)):
        return {"count": count}

    @public.get("/v1/_test/paged")
    async def _paged(params: PageParams = Depends(page_params)):
        rows = list(range(params.offset, params.offset + params.fetch_limit))
        return paginated(rows, params)

    root = FastAPI()
    root.mount("/api/public", public)
    return TestClient(root, raise_server_exceptions=False)


# ── Meta ────────────────────────────────────────────────────────────────


def test_health(client):
    r = client.get("/api/public/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_capabilities_shape(client):
    r = client.get("/api/public/v1/capabilities")
    assert r.status_code == 200
    body = r.json()
    assert body["api_version"] == "v1"
    assert body["authentication"]["type"] == "bearer"
    assert body["scopes"] == SCOPES
    assert body["pagination"]["max_limit"] == 100


# ── Request ID ──────────────────────────────────────────────────────────


def test_request_id_generated(client):
    r = client.get("/api/public/v1/health")
    assert r.headers["x-request-id"].startswith("req_")


def test_request_id_safe_inbound_kept(client):
    r = client.get(
        "/api/public/v1/health", headers={"X-Request-ID": "trace-42_ABC"}
    )
    assert r.headers["x-request-id"] == "trace-42_ABC"


def test_request_id_unsafe_inbound_replaced(client):
    r = client.get(
        "/api/public/v1/health",
        headers={"X-Request-ID": "bad id!<script>alert(1)</script>"},
    )
    assert r.headers["x-request-id"].startswith("req_")


# ── Error envelope ──────────────────────────────────────────────────────


def _assert_envelope(r, code):
    body = r.json()
    assert set(body.keys()) == {"error"}
    assert set(body["error"].keys()) == {"code", "message", "request_id"}
    assert body["error"]["code"] == code
    assert body["error"]["request_id"] == r.headers["x-request-id"]


def test_404_envelope(client):
    r = client.get("/api/public/v1/nope")
    assert r.status_code == 404
    _assert_envelope(r, "resource_not_found")


def test_405_envelope_preserves_status(client):
    r = client.post("/api/public/v1/health")
    assert r.status_code == 405
    _assert_envelope(r, "invalid_request")


def test_validation_envelope(rich_client):
    r = rich_client.get("/api/public/v1/_test/validated?count=0")
    assert r.status_code == 422
    _assert_envelope(r, "validation_error")
    assert "count" in r.json()["error"]["message"]


def test_custom_public_error(rich_client):
    r = rich_client.get("/api/public/v1/_test/custom-error")
    assert r.status_code == ERROR_STATUS["conflict"] == 409
    _assert_envelope(r, "conflict")


def test_unhandled_error_leaks_nothing(rich_client):
    r = rich_client.get("/api/public/v1/_test/boom")
    assert r.status_code == 500
    _assert_envelope(r, "internal_error")
    assert "secret internal detail" not in r.text
    assert "Traceback" not in r.text


def test_unknown_error_code_rejected():
    with pytest.raises(ValueError):
        PublicAPIError("made_up_code", "nope")


# ── Pagination ──────────────────────────────────────────────────────────


def test_pagination_defaults(rich_client):
    r = rich_client.get("/api/public/v1/_test/paged")
    body = r.json()
    assert body["pagination"] == {
        "limit": 25,
        "offset": 0,
        "count": 25,
        "has_more": True,
    }
    assert len(body["data"]) == 25


def test_pagination_bounds(rich_client):
    assert (
        rich_client.get("/api/public/v1/_test/paged?limit=0").status_code
        == 422
    )
    assert (
        rich_client.get("/api/public/v1/_test/paged?limit=101").status_code
        == 422
    )
    assert (
        rich_client.get("/api/public/v1/_test/paged?offset=-1").status_code
        == 422
    )


def test_paginated_has_more_logic():
    p = PageParams(limit=3, offset=0)
    assert paginated([1, 2, 3, 4], p)["pagination"]["has_more"] is True
    assert paginated([1, 2, 3], p)["pagination"]["has_more"] is False
    out = paginated([], p)
    assert out["data"] == [] and out["pagination"]["count"] == 0


# ── Scope metadata foundation ───────────────────────────────────────────


def test_scope_docs_rejects_unknown():
    with pytest.raises(ValueError):
        scope_docs("tasks:destroy-everything")


def test_scope_docs_shape():
    assert scope_docs("tasks:read", "tasks:comment") == {
        "x-required-scopes": ["tasks:read", "tasks:comment"]
    }
