# =============================================================================
# WS6 — MCP tenant binding kapilari
# =============================================================================
# MCP'nin tenant modelindeki rolu BILEREK pasiftir: tenant'i SECMEZ,
# gormez, override edemez. Tek yaptigi, tenant'a BAGLI bir `hms_...`
# token'ini degistirmeden iletmektir; tum yetki ve izolasyon kararlari
# Public API + RLS tarafinda verilir.
#
# Bu dosya o pasifligi YAPISAL olarak dogrular:
#   1. hicbir tool tenant/workspace argumani kabul etmez;
#   2. upstream tek ve sabittir (host/base-URL override yok);
#   3. gorunurluk cache'i tenant'i saklar ve uyusmazlikta reddeder.
# =============================================================================

import pytest


# =============================================================================
# 1) Tool yuzeyi: tenant secilebilir DEGIL
# =============================================================================

def test_no_tool_accepts_a_tenant_argument():
    """Hicbir tool `tenant_id`/`workspace` gibi bir arguman ALMAZ.

    Alsaydi, istemci hangi organizasyonda calisacagini secebilirdi —
    oysa bu karar YALNIZCA token'a aittir.
    """
    from hermes_mcp import registry

    forbidden = {"tenant", "tenant_id", "workspace", "workspace_id",
                 "organization", "organization_id", "org", "org_id"}
    offenders = []
    for tool in registry.REGISTRY:
        for prop in ((tool.input_schema or {}).get("properties") or {}):
            if prop.lower() in forbidden:
                offenders.append(f"{tool.name}.{prop}")
    assert not offenders, f"tenant secen tool argumani: {offenders}"


def test_no_tool_accepts_a_base_url_override():
    """Upstream adresi arguman olarak verilemez (SSRF + tenant kacisi)."""
    from hermes_mcp import registry

    forbidden = {"base_url", "url", "host", "endpoint", "api_base",
                 "upstream"}
    offenders = []
    for tool in registry.REGISTRY:
        for prop in ((tool.input_schema or {}).get("properties") or {}):
            if prop.lower() in forbidden:
                offenders.append(f"{tool.name}.{prop}")
    assert not offenders, f"upstream override argumani: {offenders}"


# =============================================================================
# 2) Gorunurluk cache'i tenant'i saklar ve dogrular
# =============================================================================

@pytest.mark.asyncio
async def test_visibility_caches_workspace_id(monkeypatch):
    """/v1/me'nin bildirdigi workspace cache'e YAZILIR."""
    from hermes_mcp import auth

    auth.clear_visibility_cache()

    async def fake_request(method, path, token=None, tool=None, **kw):
        return 200, {
            "workspace": {"id": "tenant-a", "slug": "acme-dev"},
            "client": {"type": "user"},
            "scopes": ["tasks:read"],
        }

    monkeypatch.setattr(auth.upstream, "api_request", fake_request)

    result = await auth.resolve_visibility("hms_dev_" + "a" * 43)
    assert result["workspace_id"] == "tenant-a"
    assert result["client_type"] == "user"


@pytest.mark.asyncio
async def test_visibility_rejects_workspace_change_for_same_token(
    monkeypatch,
):
    """AYNI token icin farkli bir workspace bildirilirse REDDEDILIR.

    Olmamasi gereken bir durumdur; ama sessizce kabul etmek,
    gorunurlugun yanlis organizasyona servis edilmesi demekti. Cache
    temizlenir ve istek hata verir — fail-closed.
    """
    from hermes_mcp import auth

    auth.clear_visibility_cache()
    token = "hms_dev_" + "b" * 43
    state = {"workspace": "tenant-a"}

    async def fake_request(method, path, token=None, tool=None, **kw):
        return 200, {
            "workspace": {"id": state["workspace"]},
            "client": {"type": "service"},
            "scopes": ["tasks:read"],
        }

    monkeypatch.setattr(auth.upstream, "api_request", fake_request)

    first = await auth.resolve_visibility(token)
    assert first["workspace_id"] == "tenant-a"

    # Cache'i sureli olarak gecersiz kil ki upstream yeniden sorulsun.
    auth._visibility_cache[
        auth.hashlib.sha256(token.encode()).hexdigest()
    ] = (0.0, first["scopes"], "service", "tenant-a")

    state["workspace"] = "tenant-b"
    with pytest.raises(auth.AuthError):
        await auth.resolve_visibility(token)

    # Supheli giris cache'te BIRAKILMAZ.
    assert (
        auth.hashlib.sha256(token.encode()).hexdigest()
        not in auth._visibility_cache
    )


@pytest.mark.asyncio
async def test_different_tokens_do_not_share_visibility(monkeypatch):
    """Iki farkli tenant'in token'i ayri cache girisleri uretir."""
    from hermes_mcp import auth

    auth.clear_visibility_cache()
    mapping = {
        "hms_dev_" + "c" * 43: ("tenant-a", ["tasks:read"]),
        "hms_dev_" + "d" * 43: ("tenant-b", ["tasks:write"]),
    }

    async def fake_request(method, path, token=None, tool=None, **kw):
        workspace, scopes = mapping[token]
        return 200, {
            "workspace": {"id": workspace},
            "client": {"type": "user"},
            "scopes": scopes,
        }

    monkeypatch.setattr(auth.upstream, "api_request", fake_request)

    for token, (workspace, scopes) in mapping.items():
        result = await auth.resolve_visibility(token)
        assert result["workspace_id"] == workspace
        assert result["scopes"] == frozenset(scopes)

    assert len(auth._visibility_cache) == 2


# =============================================================================
# 3) MCP hala veritabanina/RBAC katalogua DOKUNMAZ
# =============================================================================

def test_mcp_still_has_no_database_or_rbac_import():
    """Tenant calismasi MCP'nin mimari sinirini BOZMAMALI.

    MCP tenant'i yalnizca upstream'in bildirdigi kadar bilir; ne DB
    surucusu ne izin katalogu import eder.
    """
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent / "hermes_mcp"
    forbidden = ("sqlalchemy", "psycopg2", "shared.permissions",
                 "app.models", "app.database")
    offenders = []
    for path in root.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        code = "\n".join(
            line for line in source.splitlines()
            if not line.lstrip().startswith("#")
        )
        for needle in forbidden:
            if needle in code:
                offenders.append(f"{path.name}: {needle}")
    assert not offenders, offenders
