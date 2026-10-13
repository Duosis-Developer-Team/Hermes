# =============================================================================
# HERMES — Talep agi (00-plan §4.0): kim, hangi saglayiciya ulasir?
# =============================================================================
# Canonical talep SAGLAYICININ verisindedir. Bu dosya cozum MANTIGINI sinar:
#   1. Baglam: saglayici → hub, baglantisi olan → portal, ikisi birden olabilir.
#   2. Baglantisi olmayan tenant'ta portal da hub da YOKTUR (404).
#   3. Birden fazla saglayicida istemci SECER; secim baglanti kumesine karsi
#      dogrulanir (kume disi = yok, 404); secmezse tahmin YOK (422).
#   4. Pasif baglanti yeni talebi durdurur; gecmis gorunur kalir.
#   5. Saglayicinin tickets modulu kapaliysa o saglayiciya gecit acilmaz.
# Saglayici IZOLASYONU (RLS) tests/test_rls_isolation.py'dedir.
# =============================================================================

import uuid

from app.services import ticket_network

from ..conftest import TEST_TENANT_ID
from .conftest import OTHER_TENANT_ID, THIRD_TENANT_ID, ensure_registry

PORTAL = "/api/v1/core/support/tickets"
CONTEXT = "/api/v1/core/tickets/context"
NEW = {
    "title": "Kaydetme hatasi",
    "description": "Kaydet butonu calismiyor ve hata veriyor.",
    "category": "bug", "impact": "single_user",
}


def _link(world, requester, provider, active=True):
    ticket_network.upsert_link(
        world["session"], requester=requester, provider=provider,
        active=active, actor="test",
    )
    world["session"].commit()


def _grant(world, user, *perms):
    world["grants"][str(user)] = list(perms)


# =============================================================================
# 1) Baglam
# =============================================================================

def test_requester_context_lists_its_providers(api, ticket_world):
    body = api(ticket_world["customer"], OTHER_TENANT_ID).get(CONTEXT).json()
    assert body["surface"] == "portal" and body["surfaces"] == ["portal"]
    assert body["integrations"] is False
    [provider] = body["providers"]
    assert provider["tenant_id"] == TEST_TENANT_ID
    assert provider["display_name"] == "Duosis"
    assert provider["can_create"] is True
    assert provider["route"]["group_name"] == "DevOps Team"
    assert body["can_create"] is True


def test_support_tenant_context_is_hub_with_integrations(api, ticket_world):
    body = api(ticket_world["agent_a"]).get(CONTEXT).json()
    assert body["surfaces"] == ["hub"] and body["integrations"] is True
    assert body["providers"] == []


def test_a_tenant_can_be_provider_and_requester_at_once(api, ticket_world):
    """Acme hem Duosis'e talep acar hem de kendisi saglayicidir (Globex → Acme)."""
    _link(ticket_world, THIRD_TENANT_ID, OTHER_TENANT_ID)
    agent = uuid.uuid4()
    _grant(ticket_world, agent, "tickets.access", "tickets.respond",
           "tickets.create")
    client = api(agent, OTHER_TENANT_ID)
    body = client.get(CONTEXT).json()
    assert body["surfaces"] == ["hub", "portal"]
    # Dis entegrasyon yonetimi YALNIZ yapilandirilmis destek tenant'inda.
    assert body["integrations"] is False
    assert client.get("/api/v1/core/tickets/queues").status_code == 200


# =============================================================================
# 2) Baglantisi olmayan tenant
# =============================================================================

def test_unconnected_tenant_has_no_ticket_surface(api, ticket_world):
    user = uuid.uuid4()
    _grant(ticket_world, user, "tickets.access", "tickets.create")
    client = api(user, THIRD_TENANT_ID)
    body = client.get(CONTEXT).json()
    assert body["surface"] == "unavailable" and body["reason"] == "not_connected"
    assert client.get(PORTAL).status_code == 404
    assert client.get("/api/v1/core/tickets/queues").status_code == 404


# =============================================================================
# 3) Saglayici secimi
# =============================================================================

def test_two_providers_require_an_explicit_choice(api, ticket_world):
    _link(ticket_world, OTHER_TENANT_ID, THIRD_TENANT_ID)
    client = api(ticket_world["customer"], OTHER_TENANT_ID)

    missing = client.post(PORTAL, json=NEW)
    assert missing.status_code == 422
    assert missing.headers["X-Error-Code"] == "provider_required"

    foreign = client.post(f"{PORTAL}?provider={uuid.uuid4()}", json=NEW)
    assert foreign.status_code == 404

    created = client.post(f"{PORTAL}?provider={TEST_TENANT_ID}", json=NEW)
    assert created.status_code == 201, created.text
    ticket = created.json()
    assert ticket["provider"] == {"tenant_id": TEST_TENANT_ID,
                                  "display_name": "Duosis"}
    detail = client.get(f"{PORTAL}/{ticket['id']}?provider={TEST_TENANT_ID}")
    assert detail.status_code == 200
    assert detail.json()["provider"]["tenant_id"] == TEST_TENANT_ID


def test_single_provider_needs_no_choice(api, ticket_world):
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    created = client.post(PORTAL, json=NEW)
    assert created.status_code == 201, created.text
    listed = client.get(PORTAL).json()
    assert listed["total"] == 1
    assert listed["items"][0]["provider"]["tenant_id"] == TEST_TENANT_ID


def test_choice_is_validated_against_the_callers_links(api, ticket_world):
    """Bir baskasinin saglayicisini secmek = var olmayani secmek (404)."""
    _link(ticket_world, THIRD_TENANT_ID, OTHER_TENANT_ID)
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    # Acme'nin baglantisi yalnizca destek tenant'ina; Globex'e degil.
    response = client.get(f"{PORTAL}?provider={THIRD_TENANT_ID}")
    assert response.status_code == 404


# =============================================================================
# 4) Pasif baglanti
# =============================================================================

def test_inactive_link_stops_new_tickets_but_keeps_history(api, ticket_world):
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    ticket = client.post(PORTAL, json=NEW).json()
    _link(ticket_world, OTHER_TENANT_ID, TEST_TENANT_ID, active=False)

    blocked = client.post(PORTAL, json={**NEW, "title": "Ikinci talep"})
    assert blocked.status_code == 409
    assert blocked.headers["X-Error-Code"] == "route_missing"

    assert client.get(PORTAL).json()["total"] == 1
    assert client.get(f"{PORTAL}/{ticket['id']}").status_code == 200
    body = client.get(CONTEXT).json()
    assert body["providers"][0]["is_active"] is False
    assert body["can_create"] is False


# =============================================================================
# 5) Saglayicinin modulu kapali
# =============================================================================

def test_provider_with_tickets_module_off_is_closed(api, ticket_world):
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    ensure_registry(ticket_world["session"], TEST_TENANT_ID, "test-tenant",
                    modules=["time_entry", "work"])
    ticket_world["session"].commit()

    assert client.post(PORTAL, json=NEW).status_code != 201
    assert client.get(PORTAL).json()["total"] == 0
    provider = client.get(CONTEXT).json()["providers"][0]
    assert provider["can_create"] is False


def test_merged_list_orders_across_providers(monkeypatch, api, ticket_world):
    """Birden fazla saglayicida liste `updated_at`e gore birlesir ve
    dilimlenir; her kayit kendi saglayicisini tasir."""
    from datetime import datetime, timedelta, timezone

    from app.routers import support_portal
    from app.schemas.ticketing import TicketCustomerListItem

    _link(ticket_world, OTHER_TENANT_ID, THIRD_TENANT_ID)
    now = datetime.now(timezone.utc)
    stamp = {TEST_TENANT_ID: [5, 1], THIRD_TENANT_ID: [3]}
    calls = []

    def fake_list(db, scope, filters, *, limit, offset):
        provider = [p for p in stamp if p not in calls][0]
        calls.append(provider)
        return [(provider, h) for h in stamp[provider]], len(stamp[provider])

    def fake_item(row):
        provider, hours = row
        return TicketCustomerListItem(
            id=uuid.uuid4(), ticket_number=f"TKT-{provider[-2:]}-{hours}",
            title="x" * 10, status="open", category="bug",
            impact="single_user", assigned_group={"id": uuid.uuid4(),
                                                  "name": "Ekip"},
            created_at=now, updated_at=now - timedelta(hours=hours),
            version=1,
        )

    monkeypatch.setattr(support_portal.ticket_queries, "list_portal_tickets",
                        fake_list)
    monkeypatch.setattr(support_portal.ser, "customer_list_item", fake_item)
    body = api(ticket_world["customer"], OTHER_TENANT_ID).get(
        f"{PORTAL}?limit=2&offset=0"
    ).json()
    assert body["total"] == 3
    numbers = [i["ticket_number"] for i in body["items"]]
    assert numbers == [f"TKT-{TEST_TENANT_ID[-2:]}-1",
                       f"TKT-{THIRD_TENANT_ID[-2:]}-3"]
    assert [i["provider"]["tenant_id"] for i in body["items"]] == [
        TEST_TENANT_ID, THIRD_TENANT_ID]


# =============================================================================
# 6) 0018 geri doldurmasi
# =============================================================================

def test_backfill_turns_existing_hermes_routes_into_links(ticket_world):
    """Mevcut `hermes` yonlendirmeleri baglantiya donusur; LogiSlot'un
    kaynak tenant'i ('bta') Hermes tenant'i olmadigi icin atlanir; tekrar
    kosmak hicbir sey eklemez (konsol degisikligi ezilmez)."""
    from sqlalchemy import text

    from app.migrations.ticket_network_migration import backfill_links

    s = ticket_world["session"]
    s.execute(text("DELETE FROM ticket_network_links"))
    conn = s.connection()
    first = backfill_links(conn)
    assert first["links_inserted"] == 1 and first["links_active"] == 1
    link = ticket_network.get_link(s, OTHER_TENANT_ID, TEST_TENANT_ID)
    assert link is not None and link.is_active
    assert link.requester_display_name == "Acme"
    assert first["skipped"] == 0   # 'bta' bir hermes eslemesi degil
    again = backfill_links(conn)
    assert again["links_inserted"] == 0


# =============================================================================
# 7) Bakim isi her saglayicida
# =============================================================================

def test_maintenance_visits_every_provider_and_skips_closed_ones(
    monkeypatch, ticket_world, network_sessions
):
    from contextlib import contextmanager

    from app.jobs import ticket_maintenance
    from app.services import support_tenant

    @contextmanager
    def lock_session():
        yield ticket_world["session"]

    monkeypatch.setattr(support_tenant, "support_session", lock_session)
    _link(ticket_world, THIRD_TENANT_ID, OTHER_TENANT_ID)       # Acme saglayici
    _link(ticket_world, OTHER_TENANT_ID, THIRD_TENANT_ID)       # Globex saglayici
    ensure_registry(ticket_world["session"], THIRD_TENANT_ID, "globex",
                    modules=["time_entry"])                     # modulu kapali
    ticket_world["session"].commit()

    summary = ticket_maintenance.run_once()
    assert summary["status"] == "completed"
    assert summary["providers"] == 2 and summary["providers_skipped"] == 1
    assert TEST_TENANT_ID in network_sessions and OTHER_TENANT_ID in network_sessions
