# =============================================================================
# HERMES — Dalga D1: talep birlestirme
# =============================================================================
#   Kaynak `duplicate` koduyla cozulur (sozlesmede mevcut alan), yazismasi
#   hedefe ic not olarak tasinir, takipci + etiket birlesir. Yalniz ayni
#   musteri; kapsam disi hedef = yok (404); cozme yetkisi sart.
# =============================================================================

from app.models.ticketing import TicketEvent
from app.ticket_contract import EVENT_TICKET_RESOLVED

from .conftest import OTHER_TENANT_ID
from .test_wave_b import HD, HUB, NEW, PORTAL


def _open(api, world, **extra):
    return api(world["customer"], OTHER_TENANT_ID).post(PORTAL, json={**NEW, **extra}).json()


def _merge(client, source, target, version, **extra):
    return client.post(f"{HUB}/{source}/merge", json={
        "target_ticket_id": target, "expected_version": version,
        "public_summary": "Bu talep diger talebinizle birlestirildi.",
        "note_header": "Birlestirildi", **extra,
    })


def test_merge_resolves_source_as_duplicate_and_carries_its_story(api, ticket_world):
    source = _open(api, ticket_world, title="Yazici calismiyor")
    api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{PORTAL}/{source['id']}/messages", json={"body": "Ikinci katta da ayni sorun."})
    target = _open(api, ticket_world, title="Yazicilar baski yapmiyor")
    admin = api(ticket_world["admin"])
    tag = admin.post(f"{HD}/tags", json={"name": "Donanim"}).json()
    agent = api(ticket_world["agent_a"])
    agent.put(f"{HUB}/{source['id']}/tags", json={"tag_ids": [tag["id"]]})
    agent.put(f"{HUB}/{source['id']}/watch", json={"watching": True})
    version = agent.get(f"{HUB}/{source['id']}").json()["version"]

    merged = _merge(agent, source["id"], target["id"], version)
    assert merged.status_code == 200, merged.text
    body = merged.json()
    assert body["id"] == target["id"]
    assert [r["id"] for r in body["merged_from"]] == [source["id"]]
    assert [t["name"] for t in body["tags"]] == ["Donanim"] and body["watching"] is True
    note = [m for m in body["messages"] if m["visibility"] == "internal"][-1]["body"]
    assert "Birlestirildi" in note and "Ikinci katta da ayni sorun." in note

    src = agent.get(f"{HUB}/{source['id']}").json()
    assert src["status"] == "resolved" and src["duplicate_of_ticket_id"] == target["id"]
    assert src["merged_into"]["id"] == target["id"]
    # Sozlesme olayi: kaynak icin `ticket.resolved` (duplicate) — yeni tur YOK.
    resolved = ticket_world["session"].query(TicketEvent).filter(
        TicketEvent.ticket_id == source["id"], TicketEvent.event_type == EVENT_TICKET_RESOLVED).all()
    assert len(resolved) == 1 and resolved[0].metadata_json["resolution_code"] == "duplicate"


def test_merge_guards(api, ticket_world):
    one = _open(api, ticket_world)
    two = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    version = agent.get(f"{HUB}/{one['id']}").json()["version"]
    assert _merge(agent, one["id"], one["id"], version).status_code == 422          # kendine
    # Cozme yetkisi olmayan ajan (agent_b) — ayrica kapsami da yok.
    ticket_world["grants"][str(ticket_world["agent_b"])] = ["tickets.access", "tickets.respond"]
    assert _merge(api(ticket_world["agent_b"]), one["id"], two["id"], version).status_code == 403
    agent = api(ticket_world["agent_a"])
    assert _merge(agent, one["id"], two["id"], version).status_code == 200
    # Ayni kaynak ikinci kez birlestirilemez (artik cozuldu).
    again = agent.get(f"{HUB}/{one['id']}").json()["version"]
    assert _merge(agent, one["id"], two["id"], again).status_code == 422


def test_only_tickets_of_the_same_customer_can_be_merged(api, ticket_world):
    from app.services import ticket_service
    from app.services.ticket_service import Actor, TicketCreateInput

    import uuid

    hermes = _open(api, ticket_world)
    logislot = ticket_service.create_ticket(
        ticket_world["session"], application=ticket_world["logislot_app"],
        source_tenant=ticket_world["logislot_src"], group=ticket_world["devops"],
        route_version=ticket_world["logislot_route"].route_version,
        data=TicketCreateInput(source_ticket_id=str(uuid.uuid4()), requester_source_user_id="x",
                               title="Randevu hatasi", description="Slot cift gorunuyor.",
                               category="bug", impact="single_user"),
        actor=Actor(type="tenant_user", role="requester", id="x"),
    )
    ticket_world["session"].flush()
    agent = api(ticket_world["agent_a"])
    version = agent.get(f"{HUB}/{hermes['id']}").json()["version"]
    assert _merge(agent, hermes["id"], str(logislot.id), version).status_code == 422
