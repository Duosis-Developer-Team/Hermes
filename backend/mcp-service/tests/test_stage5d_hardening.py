# =============================================================================
# hermes-mcp - Stage 5D testleri: sertlestirme + OAuth kesif temeli
# =============================================================================
import json as _json
import uuid

from .conftest import make_api_client, rpc

U1 = uuid.uuid4()


def test_protected_resource_metadata_honest(mcp_http):
    """RFC 9728 dokumani: authorization_servers BOS — external
    uyumluluk IDDIA EDILMEZ (bilinclice 'not ready')."""
    for path in (
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
    ):
        r = mcp_http.get(path)
        assert r.status_code == 200, path
        body = r.json()
        assert body["authorization_servers"] == []
        assert body["bearer_methods_supported"] == ["header"]
        assert "internal-beta" in body["hermes_authorization_status"]
        assert "NOT claimed" in body["hermes_authorization_status"]


def test_challenge_points_to_prm(mcp_http):
    r = rpc(mcp_http, "tools/list")
    assert r.status_code == 401
    assert (
        "/.well-known/oauth-protected-resource/mcp"
        in r.headers["WWW-Authenticate"]
    )


def test_malformed_json_rpc_rejected(mcp_http, pg_session):
    token = make_api_client(
        pg_session, f"h-{uuid.uuid4().hex[:6]}", [("user", U1)],
        scopes=["tasks:read"],
    )
    r = mcp_http.post(
        "/mcp",
        content=b"{this is not json",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        },
    )
    assert r.status_code == 400


def test_oversized_body_rejected(mcp_http, pg_session):
    token = make_api_client(
        pg_session, f"h-{uuid.uuid4().hex[:6]}", [("user", U1)],
        scopes=["tasks:read"],
    )
    huge = _json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "x", "arguments": {"pad": "A" * 1_100_000}},
        }
    )
    r = mcp_http.post(
        "/mcp",
        content=huge.encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        },
    )
    assert r.status_code == 413


def test_concurrency_cap_returns_503(mcp_http, pg_session, monkeypatch):
    from hermes_mcp import main as mcp_main

    token = make_api_client(
        pg_session, f"h-{uuid.uuid4().hex[:6]}", [("user", U1)],
        scopes=["tasks:read"],
    )
    monkeypatch.setitem(mcp_main._inflight, "n", 10_000)
    r = rpc(mcp_http, "tools/list", token=token)
    assert r.status_code == 503
    assert r.json()["error"] == "server busy"


def test_health_ok_without_auth(mcp_http):
    assert mcp_http.get("/health").status_code == 200


# ── PRM/challenge URL turetimi (canli 5D bug regresyonu) ───────────────
# BUG: config.RESOURCE_URL.rstrip("/mcp") KARAKTER KUMESI siliyordu →
# "https://hermes.duosis.com/mcp/" icin challenge
# "https://hermes.duosis.co/..." (yanlis domain!) uretiyordu. Artik URL'ler
# yalnizca urllib.parse ile ayristirilir.

import pytest

from hermes_mcp.discovery import origin_of, prm_url, www_authenticate

PRM = "/.well-known/oauth-protected-resource"


@pytest.mark.parametrize(
    "resource,expected_origin,expected_prm",
    [
        # .com — bug'in tam vakasi: sondaki 'm' ASLA yenmez.
        (
            "https://hermes.duosis.com/mcp/",
            "https://hermes.duosis.com",
            f"https://hermes.duosis.com{PRM}/mcp",
        ),
        # .coop — rstrip("/mcp") burada 'p','o','o','c' silerdi.
        (
            "https://hermes.example.coop/mcp/",
            "https://hermes.example.coop",
            f"https://hermes.example.coop{PRM}/mcp",
        ),
        # localhost + acik port (dev/lokal calistirma).
        (
            "http://localhost:8010/mcp",
            "http://localhost:8010",
            f"http://localhost:8010{PRM}/mcp",
        ),
        # ACIK :443 — port aynen KORUNUR (workaround gerekmez, ama
        # verilirse bozulmaz).
        (
            "https://hermes.duosis.com:443/mcp/",
            "https://hermes.duosis.com:443",
            f"https://hermes.duosis.com:443{PRM}/mcp",
        ),
        # Path'siz kaynak → yalnizca well-known prefix'i.
        (
            "https://hermes.duosis.com/",
            "https://hermes.duosis.com",
            f"https://hermes.duosis.com{PRM}",
        ),
    ],
)
def test_discovery_urls_exact(resource, expected_origin, expected_prm):
    assert origin_of(resource) == expected_origin
    assert prm_url(resource) == expected_prm
    assert www_authenticate(resource) == (
        f'Bearer resource_metadata="{expected_prm}"'
    )


def test_com_suffix_never_truncated():
    """Bug'in kalici regresyon kilidi: hicbir uretimde '.co' ile biten
    bozuk host olusamaz."""
    for url in (
        "https://hermes.duosis.com/mcp/",
        "https://hermes.duosis.com/mcp",
        "https://hermes.duosis.com:443/mcp/",
    ):
        out = prm_url(url)
        assert "duosis.co/" not in out and not out.startswith(
            "https://hermes.duosis.co/"
        ), out
        assert out.startswith("https://hermes.duosis.com"), out


def test_relative_or_invalid_resource_rejected():
    for bad in ("/mcp", "hermes.duosis.com/mcp", ""):
        with pytest.raises(ValueError):
            prm_url(bad)


def test_live_challenge_and_prm_match_configured_resource(
    mcp_http, monkeypatch
):
    """Uctan uca: hem 401 challenge basligi hem PRM JSON, yapilandirilan
    kaynakla birebir tutarli (test ortaminin gercek degeri ile)."""
    from hermes_mcp import config

    monkeypatch.setattr(
        config, "RESOURCE_URL", "https://hermes.duosis.com/mcp/"
    )

    r = rpc(mcp_http, "tools/list")
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == (
        'Bearer resource_metadata="https://hermes.duosis.com'
        '/.well-known/oauth-protected-resource/mcp"'
    )

    doc = mcp_http.get("/.well-known/oauth-protected-resource/mcp").json()
    # PRM 'resource' kaynagin KENDISIDIR (sondaki '/' korunur).
    assert doc["resource"] == "https://hermes.duosis.com/mcp/"
    assert doc["authorization_servers"] == []


def test_sources_never_rstrip_urls():
    """Kalici kural: hermes_mcp kaynaklarinda `.rstrip(` cagrisi YOK —
    URL sonek silme yanilsamasi bir daha girmesin."""
    import pathlib

    pkg = pathlib.Path(__file__).parent.parent / "hermes_mcp"
    for f in pkg.glob("*.py"):
        for i, line in enumerate(f.read_text().splitlines(), 1):
            code = line.split("#")[0]
            assert ".rstrip(" not in code, f"{f.name}:{i}: {line.strip()}"


# ── /mcp slash-redirect regresyonu (canli bulgu) ───────────────────────
# BUG: Mount("/mcp") tek basina "/mcp" tam yolunu ESLESTIRMEZ → Starlette
# 307 ile "/mcp/"e yonlendiriyordu; ingress arkasinda Location `http://`
# olarak uretiliyor ve HTTP client'lari sema degisiminde Authorization
# header'ini dusurdugu icin MCP client'lari baglanamiyordu. Artik her iki
# yol da DOGRUDAN servis edilir.


@pytest.mark.parametrize("path", ["/mcp", "/mcp/"])
def test_both_mcp_paths_served_without_redirect(mcp_http, path):
    r = mcp_http.post(
        path,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list",
              "params": {}},
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
        follow_redirects=False,
    )
    # Redirect YOK: token'siz istek dogrudan 401 challenge alir.
    assert r.status_code == 401, f"{path} -> {r.status_code}"
    assert "resource_metadata=" in r.headers.get("WWW-Authenticate", "")


@pytest.mark.parametrize("path", ["/mcp", "/mcp/"])
def test_both_mcp_paths_work_authenticated(mcp_http, pg_session, path):
    token = make_api_client(
        pg_session, f"slash-{uuid.uuid4().hex[:6]}", [("user", U1)],
        scopes=["tasks:read"],
    )
    r = mcp_http.post(
        path,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list",
              "params": {}},
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        },
        follow_redirects=False,
    )
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert "hermes_list_tasks" in names
