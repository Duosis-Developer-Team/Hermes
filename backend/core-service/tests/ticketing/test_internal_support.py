# =============================================================================
# HERMES — Platform Admin destek yonlendirmesi (S2S yuzeyi)
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

from .conftest import OTHER_TENANT_ID, THIRD_TENANT_ID

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
    ("GET", "/internal/support/routing"),
    ("PUT", f"/internal/support/routing/{OTHER_TENANT_ID}"),
    ("DELETE", f"/internal/support/routing/{OTHER_TENANT_ID}"),
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

def test_providers_lists_exactly_one_provider_with_active_groups(internal):
    body = internal.get(
        "/internal/support/providers", headers=auth()
    ).json()
    assert body["module_state"] == "ok"
    # Bugun TEK saglayici; liste sekli ileriye donuk.
    assert len(body["items"]) == 1
    provider = body["items"][0]
    names = {g["name"] for g in provider["groups"]}
    assert "DevOps Team" in names and "Platform Team" in names
    for group in provider["groups"]:
        # Uye KIMLIKLERI donmez — yalnizca sayi.
        assert set(group) == {"id", "name", "description", "member_count"}


# =============================================================================
# 3) Yonlendirme okuma/yazma
# =============================================================================

def test_routing_lists_only_hermes_source_tenants(internal, ticket_world):
    body = internal.get("/internal/support/routing", headers=auth()).json()
    tenants = {row["tenant_id"] for row in body["items"]}
    # LogiSlot'un kaynak tenant'i ('bta') BU listede olmamali: dis
    # entegrasyonlar Duosis tarafindaki ekrandan yonetilir.
    assert "bta" not in tenants
    assert OTHER_TENANT_ID in tenants


def test_enabling_a_tenant_creates_mapping_and_route(
    internal, ticket_world, pg_session
):
    payload = {
        # Testte support tenant'i = `pg_session`in damgaladigi tenant.
        "provider_tenant_id": str(pg_session.info["hermes_tenant_id"]),
        "group_id": str(ticket_world["platform"].id),
    }
    response = internal.put(
        f"/internal/support/routing/{THIRD_TENANT_ID}",
        json=payload, headers=auth(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["enabled"] is True
    assert body["group_name"] == "Platform Team"
    assert body["route_version"] >= 1


def test_unknown_provider_is_rejected(internal):
    response = internal.put(
        f"/internal/support/routing/{THIRD_TENANT_ID}",
        json={"provider_tenant_id": str(uuid.uuid4()),
              "group_id": str(uuid.uuid4())},
        headers=auth(),
    )
    assert response.status_code == 400
    assert "provider" in response.json()["detail"].lower()


def test_support_workspace_cannot_route_to_itself(internal, pg_session):
    """Duosis'in kendisi musteri portali GORMEZ; ona route yazmak olu
    konfigurasyon uretirdi."""
    support_tenant_id = str(pg_session.info["hermes_tenant_id"])
    response = internal.put(
        f"/internal/support/routing/{support_tenant_id}",
        json={"provider_tenant_id": support_tenant_id,
              "group_id": str(uuid.uuid4())},
        headers=auth(),
    )
    assert response.status_code == 400
    assert "itself" in response.json()["detail"].lower()


def test_inactive_group_is_rejected(internal, ticket_world, pg_session):
    ticket_world["platform"].is_active = False
    pg_session.flush()
    response = internal.put(
        f"/internal/support/routing/{THIRD_TENANT_ID}",
        json={"provider_tenant_id": str(pg_session.info["hermes_tenant_id"]),
              "group_id": str(ticket_world["platform"].id)},
        headers=auth(),
    )
    assert response.status_code == 409


def test_disabling_deactivates_the_route_without_deleting_it(
    internal, ticket_world, pg_session
):
    """Kayit SILINMEZ: gecmis yonlendirme bilgisi ve mevcut ticket'lar
    korunur; yalnizca YENI ticket acilamaz."""
    before = pg_session.query(SupportTicketRoute).filter(
        SupportTicketRoute.source_tenant_row_id
        == ticket_world["hermes_src"].id
    ).count()

    response = internal.delete(
        f"/internal/support/routing/{OTHER_TENANT_ID}", headers=auth()
    )
    assert response.status_code == 200
    assert response.json()["enabled"] is False

    after = pg_session.query(SupportTicketRoute).filter(
        SupportTicketRoute.source_tenant_row_id
        == ticket_world["hermes_src"].id
    ).all()
    assert len(after) == before          # satir SILINMEDI
    assert all(not r.is_active for r in after)

    # Route yoksa create kapali (portal `route_missing` gorur).
    with pytest.raises(Exception):
        ticket_routing.resolve_route(
            pg_session, source_tenant=ticket_world["hermes_src"]
        )


def test_disabling_an_unmapped_tenant_is_404(internal):
    response = internal.delete(
        f"/internal/support/routing/{THIRD_TENANT_ID}", headers=auth()
    )
    assert response.status_code == 404


# =============================================================================
# 4) Icerik siniri
# =============================================================================

def test_internal_surface_never_returns_ticket_content(
    internal, ticket_world
):
    """Platform yuzeyi KONFIGURASYON doner; ticket govdesi/mesaji ASLA."""
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

    for path in ("/internal/support/providers", "/internal/support/routing"):
        text = internal.get(path, headers=auth()).text
        assert "GIZLI BASLIK" not in text
        assert "GIZLI GOVDE" not in text
