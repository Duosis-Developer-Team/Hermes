# =============================================================================
# HERMES - Stage 2F: guvenlik matrisi bosluk testleri + regresyon kanaryalari
# =============================================================================
# Matristeki cogu madde 1A-2D test dosyalarinda zaten kapali; bu dosya
# kalan bosluklari kapatir:
#   - bicimsiz token varyantlari
#   - OpenAPI ciktisinda sir/ornek-token bulunmamasi
#   - audit path'inde query string bulunmamasi
#   - internal uygulama regresyon kanaryalari (public mount internal'i
#     golgelemiyor, internal auth hala zorunlu)
# =============================================================================

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.public_api import deps
from app.public_api.app import create_public_app

from .test_stage2b_auth import FakeSession, make_client, make_token


@pytest.fixture()
def public_http(monkeypatch):
    public = create_public_app()
    public.dependency_overrides[get_db] = lambda: FakeSession()
    monkeypatch.setattr(deps, "_lookup_token", lambda db, digest: (None, None))
    root = FastAPI()
    root.mount("/api/public", public)
    return TestClient(root, raise_server_exceptions=False)


# ── 1) Bicimsiz token varyantlari ───────────────────────────────────────


@pytest.mark.parametrize(
    "auth_header",
    [
        "Bearer ",  # bos
        "Bearer short",  # cok kisa
        "Bearer token_without_prefix_aaaaaaaaaaaaaaaaaaaa",  # yanlis prefix
        "Bearer hms_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaa",  # gecersiz env tag
        "Basic aGVybWVzOnRlc3Q=",  # Bearer degil
        "hms_dev_rawwithoutbearerkeyword_aaaaaaaaaaaa",  # Bearer kelimesi yok
    ],
)
def test_malformed_tokens_rejected(public_http, auth_header):
    r = public_http.get(
        "/api/public/v1/me", headers={"Authorization": auth_header}
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


# ── 2) OpenAPI ciktisinda sir yok ───────────────────────────────────────

# Gercekci token: hms_dev_/hms_live_ + >=30 karakter sir. Dokumantasyondaki
# "hms_dev_..." format IPUCU (3 nokta) buna takilmaz.
_REAL_TOKEN_RE = re.compile(r"hms_(dev|live)_[A-Za-z0-9_\-]{30,}")
_SHA256_RE = re.compile(r"\b[a-f0-9]{64}\b")


def test_public_openapi_contains_no_secrets(public_http):
    text = public_http.get("/api/public/v1/openapi.json").text
    assert not _REAL_TOKEN_RE.search(text), "realistic token in OpenAPI"
    assert not _SHA256_RE.search(text), "sha256-like hash in OpenAPI"


def test_capabilities_contains_no_secrets(public_http):
    text = public_http.get("/api/public/v1/capabilities").text
    assert not _REAL_TOKEN_RE.search(text)
    assert not _SHA256_RE.search(text)


# ── 3) Audit path'inde query string yok ─────────────────────────────────


def test_audit_path_never_contains_query_string(audit_records, public_http):
    r = public_http.get(
        "/api/public/v1/health?debug=1&token=hms_dev_should_never_be_logged"
    )
    assert r.status_code == 200
    rec = audit_records[-1]
    assert rec["path"] == "/v1/health"
    assert "?" not in rec["path"]
    # Query'deki deger (denenmis token dahil) kaydin HICBIR alaninda yok.
    assert "hms_dev_should_never_be_logged" not in str(rec)
    assert "debug=1" not in str(rec)


# ── 4) Internal uygulama regresyon kanaryalari ──────────────────────────


@pytest.fixture(scope="module")
def main_http():
    from app.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_internal_health_still_works(main_http):
    r = main_http.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


def test_internal_api_still_requires_session(main_http):
    """Internal router'lar ayakta ve auth hala zorunlu — public mount
    internal davranisi DEGISTIRMEDI."""
    for path in (
        "/api/v1/core/customers",
        "/api/v1/core/tasks",
        "/api/v1/core/work-logs",
        "/api/v1/core/meetings",
    ):
        r = main_http.get(path)
        assert r.status_code == 401, f"{path} -> {r.status_code}"


def test_public_mount_does_not_shadow_internal_prefix(main_http):
    """/api/public mount'u /api/v1'i golgelemez; /api/public disindaki
    yollar internal uygulamada cozulur."""
    r = main_http.get("/api/publicX/v1/health")
    assert r.status_code == 404  # internal 404 (mount'a dusmedi)


def test_public_error_envelope_not_used_internally(main_http):
    """Internal hata bicimi degismedi (public zarf internal'e sizmadi)."""
    r = main_http.get("/api/v1/core/customers")
    body = r.json()
    # Internal konvansiyon: FastAPI detail (veya Hermes {success,error}).
    assert "detail" in body or "success" in body
    assert "request_id" not in body.get("error", {}) if isinstance(
        body.get("error"), dict
    ) else True


# ── 5) Rate-limit sayaclari token degeri tasimaz (deps seviyesinde) ─────


def test_limiter_never_keys_on_token_value(public_http):
    from app.public_api import rate_limit

    attempted = "hms_dev_" + "S3CR3T" * 8
    public_http.get(
        "/api/public/v1/me",
        headers={"Authorization": f"Bearer {attempted}"},
    )
    keys = " ".join(rate_limit.get_limiter()._buckets.keys())
    assert "S3CR3T" not in keys
    assert "hms_" not in keys
