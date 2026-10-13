# =============================================================================
# HERMES — Platform Admin talep agi (S2S yuzeyi)
# =============================================================================
# Bu uclar Platform Admin konsolunu besler. Iki sinir birden onemli:
#
#   1. YAPISAL: `/internal/*` altindaki HER uc S2S credential ISTEMELI.
#      Guard'siz bir ic uc, kullanici JWT'siyle (hatta credential'siz)
#      cagrilabilir olurdu — LogiSlot'un "guard'siz endpoint sessizce
#      acik" zaafinin ayni sinifi.
#   2. ICERIK: bu yuzey KONFIGURASYON doner; ticket govdesi/mesaji
#      DONDURMEZ (05: platform navigasyonunda ticket icerigi yoktur).
# =============================================================================

import uuid

import pytest
from fastapi.testclient import TestClient

from app.models.ticketing import SupportTicketRoute
from app.services import ticket_routing

from ..conftest import TEST_TENANT_ID
from .conftest import OTHER_TENANT_ID, THIRD_TENANT_ID, ensure_registry

S2S = "s2s-test-" + "x" * 40


@pytest.fixture()
def internal(ticket_world, pg_session, monkeypatch):
    """S2S credential'i tanimli, core uygulamasi.

    `support_session` override edilir: is mantigi testin acik
    transaction'ini kullansin (aksi halde ayri bir oturum acilir ve
    testin yazdigi satirlari GORMEZ).
    """
    from contextlib import contextmanager

    from app.config import get_settings
    from app.main import app
    from app.services import support_tenant

    monkeypatch.setattr(get_settings(), "HERMES_S2S_TOKEN_CURRENT", S2S)
    monkeypatch.setattr(get_settings(), "HERMES_S2S_TOKEN_NEXT", "")

    @contextmanager
    def _session():
        yield pg_session

    monkeypatch.setattr(support_tenant, "support_session", _session)
    import app.routers.internal_support as mod

    monkeypatch.setattr(mod.support, "support_session", _session)
    return TestClient(app)


def auth():
    return {"Authorization": f"Bearer {S2S}"}


# =============================================================================
# 1) S2S kapisi
# =============================================================================

@pytest.mark.parametrize("method,path", [
    ("GET", "/internal/support/providers"),
    ("GET", "/internal/support/network"),
    ("PUT", f"/internal/support/network/{OTHER_TENANT_ID}/{TEST_TENANT_ID}"),
    ("DELETE", f"/internal/support/network/{OTHER_TENANT_ID}/{TEST_TENANT_ID}"),
])
def test_every_internal_support_endpoint_requires_s2s(
    internal, method, path
):
    response = internal.request(method, path, json={})
    assert response.status_code == 401, (
        f"{method} {path} credential'siz gecti"
    )


def test_wrong_credential_is_rejected(internal):
    response = internal.get(
        "/internal/support/providers",
        headers={"Authorization": "Bearer wrong-" + "y" * 40},
    )
    assert response.status_code == 401


def test_internal_surface_is_fully_covered_by_the_s2s_guard():
    """Yeni bir `/internal/support` ucu guard'siz eklenemesin."""
    from app.main import app
    from app.routers.internal_tenants import require_s2s

    unguarded = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/internal/support"):
            continue
        deps = [d.call for d in route.dependant.dependencies]
        stack = list(route.dependant.dependencies)
        while stack:
            d = stack.pop()
            deps.append(d.call)
            stack.extend(d.dependencies)
        if require_s2s not in deps:
            unguarded.append(f"{sorted(route.methods)} {path}")
    assert not unguarded, f"S2S guard'i olmayan uc: {unguarded}"


# =============================================================================
# 2) Saglayici katalogu
# =============================================================================

def _link(requester, provider, **body):
    return f"/internal/support/network/{requester}/{provider}", body


def test_providers_are_tickets_enabled_tenants_with_minimal_groups(
    internal, pg_session
):
    # Tickets modulu KAPALI tenant saglayici olamaz → listede yok.
    ensure_registry(pg_session, THIRD_TENANT_ID, "globex", modules=["time_entry"])
    pg_session.commit()
    body = internal.get("/internal/support/providers", headers=auth()).json()
    assert body["module_state"] == "ok"
    ids = [p["tenant_id"] for p in body["items"]]
    assert THIRD_TENANT_ID not in ids
    # Yapilandirilmis destek tenant'i (dis entegrasyonlarin saglayicisi) ONCE.
    first = body["items"][0]
    assert first["tenant_id"] == TEST_TENANT_ID and first["is_support_tenant"]
    names = {g["name"] for g in first["groups"]}
    assert {"DevOps Team", "Platform Team"} <= names
    for group in first["groups"]:
        # Uye KIMLIKLERI donmez — yalnizca sayi.
        assert set(group) == {"id", "name", "description", "member_count"}


# =============================================================================
# 3) Baglanti okuma/yazma
# =============================================================================

def test_network_lists_links_with_their_team(internal, ticket_world):
    body = internal.get("/internal/support/network", headers=auth()).json()
    rows = {(r["requester_tenant_id"], r["provider_tenant_id"]): r
            for r in body["items"]}
    row = rows[(OTHER_TENANT_ID, TEST_TENANT_ID)]
    assert row["is_active"] is True and row["group_name"] == "DevOps Team"
    assert row["requester_display_name"] == "Acme"
    assert row["provider_available"] is True and row["requester_has_tickets"]
    # LogiSlot'un kaynak tenant'i ('bta') bir Hermes baglantisi DEGILDIR.
    assert all(r["requester_tenant_id"] != "bta" for r in body["items"])


def test_linking_creates_mapping_route_and_link(
    internal, ticket_world, pg_session
):
    from app.services import ticket_network

    path, body = _link(
        THIRD_TENANT_ID, TEST_TENANT_ID,
        group_id=str(ticket_world["platform"].id),
        requester_display_name="Globex", provider_display_name="Duosis",
    )
    response = internal.put(path, json=body, headers=auth())
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["is_active"] is True and out["group_name"] == "Platform Team"
    assert out["route_version"] >= 1 and out["version"] == 1
    link = ticket_network.get_link(pg_session, THIRD_TENANT_ID, TEST_TENANT_ID)
    assert link is not None and link.is_active
    src = ticket_routing.get_source_tenant(
        pg_session, application_id=ticket_world["hermes_app"].id,
        source_tenant_id=THIRD_TENANT_ID,
    )
    assert src is not None and src.display_name == "Globex"


def test_changing_the_team_versions_the_route_and_keeps_history(
    internal, ticket_world, pg_session
):
    path, body = _link(OTHER_TENANT_ID, TEST_TENANT_ID,
                       group_id=str(ticket_world["platform"].id))
    out = internal.put(path, json=body, headers=auth()).json()
    assert out["group_name"] == "Platform Team" and out["route_version"] == 2
    routes = pg_session.query(SupportTicketRoute).filter(
        SupportTicketRoute.source_tenant_row_id == ticket_world["hermes_src"].id
    ).all()
    assert len(routes) == 2 and sum(r.is_active for r in routes) == 1


def test_a_workspace_cannot_link_to_itself(internal):
    path, body = _link(TEST_TENANT_ID, TEST_TENANT_ID, group_id=str(uuid.uuid4()))
    response = internal.put(path, json=body, headers=auth())
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "self_link"


def test_unknown_workspace_is_404(internal, ticket_world):
    path, body = _link(str(uuid.uuid4()), TEST_TENANT_ID,
                       group_id=str(ticket_world["devops"].id))
    response = internal.put(path, json=body, headers=auth())
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_tenant"


def test_provider_without_tickets_module_is_rejected(
    internal, ticket_world, pg_session
):
    ensure_registry(pg_session, OTHER_TENANT_ID, "acme", modules=["time_entry"])
    pg_session.commit()
    path, body = _link(THIRD_TENANT_ID, OTHER_TENANT_ID,
                       group_id=str(ticket_world["devops"].id))
    response = internal.put(path, json=body, headers=auth())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "provider_unavailable"


def test_inactive_group_is_rejected(internal, ticket_world, pg_session):
    ticket_world["platform"].is_active = False
    pg_session.flush()
    path, body = _link(THIRD_TENANT_ID, TEST_TENANT_ID,
                       group_id=str(ticket_world["platform"].id))
    response = internal.put(path, json=body, headers=auth())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "group_inactive"


def test_stale_version_is_409(internal, ticket_world):
    path, body = _link(OTHER_TENANT_ID, TEST_TENANT_ID,
                       group_id=str(ticket_world["platform"].id),
                       expected_version=99)
    response = internal.put(path, json=body, headers=auth())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "version_conflict"


def test_disabling_deactivates_route_and_link_without_deleting(
    internal, ticket_world, pg_session
):
    """Kayit SILINMEZ: gecmis yonlendirme ve mevcut talepler korunur;
    yalnizca YENI talep acilamaz."""
    from app.services import ticket_network

    before = pg_session.query(SupportTicketRoute).filter(
        SupportTicketRoute.source_tenant_row_id
        == ticket_world["hermes_src"].id
    ).count()
    response = internal.delete(
        f"/internal/support/network/{OTHER_TENANT_ID}/{TEST_TENANT_ID}",
        headers=auth(),
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_active"] is False
    after = pg_session.query(SupportTicketRoute).filter(
        SupportTicketRoute.source_tenant_row_id
        == ticket_world["hermes_src"].id
    ).all()
    assert len(after) == before          # satir SILINMEDI
    assert all(not r.is_active for r in after)
    link = ticket_network.get_link(pg_session, OTHER_TENANT_ID, TEST_TENANT_ID)
    assert link is not None and not link.is_active and link.version == 2
    with pytest.raises(Exception):
        ticket_routing.resolve_route(
            pg_session, source_tenant=ticket_world["hermes_src"]
        )


def test_disabling_works_even_if_the_provider_module_is_off(
    internal, ticket_world, pg_session
):
    ensure_registry(pg_session, TEST_TENANT_ID, "test-tenant",
                    modules=["time_entry"])
    pg_session.commit()
    response = internal.delete(
        f"/internal/support/network/{OTHER_TENANT_ID}/{TEST_TENANT_ID}",
        headers=auth(),
    )
    assert response.status_code == 200, response.text


def test_disabling_an_unknown_link_is_404(internal, ticket_world):
    response = internal.delete(
        f"/internal/support/network/{THIRD_TENANT_ID}/{TEST_TENANT_ID}",
        headers=auth(),
    )
    assert response.status_code == 404


# =============================================================================
# 4) Icerik siniri
# =============================================================================

def test_internal_surface_never_returns_ticket_content(
    internal, ticket_world
):
    """Platform yuzeyi KONFIGURASYON doner; talep govdesi/mesaji ASLA."""
    from app.services.ticket_service import Actor, TicketCreateInput
    from app.services import ticket_service

    ticket_service.create_ticket(
        ticket_world["session"],
        application=ticket_world["hermes_app"],
        source_tenant=ticket_world["hermes_src"],
        group=ticket_world["devops"],
        route_version=ticket_world["hermes_route"].route_version,
        data=TicketCreateInput(
            source_ticket_id=str(uuid.uuid4()),
            requester_source_user_id="user-1",
            title="GIZLI BASLIK BURADA",
            description="GIZLI GOVDE METNI burada duruyor.",
            category="bug", impact="single_user",
        ),
        actor=Actor(type="tenant_user", role="requester", id="user-1"),
    )
    ticket_world["session"].flush()

    for path in ("/internal/support/providers", "/internal/support/network"):
        text = internal.get(path, headers=auth()).text
        assert "GIZLI BASLIK" not in text
        assert "GIZLI GOVDE" not in text
