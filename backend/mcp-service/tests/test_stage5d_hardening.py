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
