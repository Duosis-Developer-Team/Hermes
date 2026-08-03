# =============================================================================
# HERMES - CSV kullanici gorunen-ad cozumu (Premium UI turu)
# =============================================================================
# KAPATILAN KUSUR: reports.view izni olmayan kullanici (Time Entry kendi
# haftasini CSV indiren kullanici dahil) icin users_map e-postayla
# kuruluyordu — cikti "gencay.coskun@duosis.com" gosteriyordu.
# Yeni sozlesme (TEK resolver, Reports + Time Entry ayni endpoint):
#   full_name → display_name → email → fallback; Turkce korunur.
# =============================================================================

import asyncio
from types import SimpleNamespace

import httpx

from app.routers import reports as r


def test_display_name_priority_chain():
    assert r._display_name({"full_name": "Gencay Coşkun",
                            "email": "g@x.com"}) == "Gencay Coşkun"
    assert r._display_name({"full_name": "",
                            "display_name": "Gencay C.",
                            "email": "g@x.com"}) == "Gencay C."
    assert r._display_name({"full_name": None,
                            "email": "g@x.com"}) == "g@x.com"
    assert r._display_name({}, "fallback") == "fallback"
    # Bosluklu ad e-postaya DUSMEZ; kirpilir.
    assert r._display_name({"full_name": "  Ayşe Yılmaz  "}) == "Ayşe Yılmaz"


def _self_map(monkeypatch, handler, token="tok"):
    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda **kw: real(transport=transport, **{k: v for k, v in kw.items()
                                                  if k != "transport"}),
    )
    user = SimpleNamespace(id="u-1", email="gencay.coskun@duosis.com")
    return asyncio.run(r.get_self_user_map(token, user))


def test_self_map_resolves_full_name(monkeypatch):
    def handler(request):
        assert "/users/lookup" in str(request.url)
        return httpx.Response(200, json=[{
            "id": "u-1", "full_name": "Gencay Coşkun",
            "email": "gencay.coskun@duosis.com",
        }])

    got = _self_map(monkeypatch, handler)
    assert got == {"u-1": "Gencay Coşkun"}


def test_self_map_falls_back_to_email_on_error(monkeypatch):
    def handler(request):
        return httpx.Response(500)

    got = _self_map(monkeypatch, handler)
    assert got == {"u-1": "gencay.coskun@duosis.com"}


def test_self_map_without_token_uses_email(monkeypatch):
    def handler(request):  # pragma: no cover — cagirilmamali
        raise AssertionError("no HTTP without token")

    got = _self_map(monkeypatch, handler, token="")
    assert got == {"u-1": "gencay.coskun@duosis.com"}


def test_all_users_map_uses_shared_chain():
    """get_all_users_map da ayni resolver'i kullanir — Reports ve Time
    Entry ayni kullanici icin AYNI ismi uretir (kaynak tek)."""
    import inspect

    src = inspect.getsource(r.get_all_users_map)
    assert "_display_name(" in src
