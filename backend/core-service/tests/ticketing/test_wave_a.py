# =============================================================================
# HERMES — Talep yonetimi Dalga A (00-plan §4.1): hatalar + eksik yuzeyler
# =============================================================================
#   1. Kisa cozum ozeti kabul edilir (servis 20 karakter istiyordu; kontrat
#      2026-08-28'de 1'e inmisti — iki kural celisiyordu).
#   2. Ajan yeniden acmasi gerekceyle durum penceresinden calisir.
#   3. Liste siralamasi: oncelik / en eski / en yeni — deterministik.
#   4. Musteri iptal hakki SUNUCUDA hesaplanir (can_cancel).
# =============================================================================

import uuid

from app.services import ticket_service
from app.services.ticket_service import Actor, TicketCreateInput

from .conftest import OTHER_TENANT_ID

HUB = "/api/v1/core/tickets"
PORTAL = "/api/v1/core/support/tickets"
REQUESTER = Actor(type="tenant_user", role="requester", id="req-1")


def _ticket(world, *, title="Kaydetme hatasi var", impact="single_user",
            requester="req-1"):
    s = world["session"]
    ticket = ticket_service.create_ticket(
        s, application=world["hermes_app"], source_tenant=world["hermes_src"],
        group=world["devops"], route_version=world["hermes_route"].route_version,
        data=TicketCreateInput(
            source_ticket_id=str(uuid.uuid4()), requester_source_user_id=requester,
            title=title, description="Aciklama metni burada.",
            category="bug", impact=impact,
        ),
        actor=REQUESTER,
    )
    s.flush()
    return ticket


def _resolve(client, ticket, summary):
    return client.post(f"{HUB}/{ticket.id}/resolve", json={
        "resolution_code": "fixed", "public_summary": summary,
        "expected_version": ticket.version,
    })


def test_short_resolution_summary_is_accepted(api, ticket_world):
    ticket = _ticket(ticket_world)
    response = _resolve(api(ticket_world["agent_a"]), ticket, "Duzeldi")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "resolved"


def test_blank_resolution_summary_is_rejected(api, ticket_world):
    ticket = _ticket(ticket_world)
    response = _resolve(api(ticket_world["agent_a"]), ticket, "   ")
    assert response.status_code in (400, 422)


def test_agent_reopens_with_reason_from_the_status_window(api, ticket_world):
    client = api(ticket_world["agent_a"])
    ticket = _ticket(ticket_world)
    resolved = _resolve(client, ticket, "Duzeldi").json()
    missing = client.post(f"{HUB}/{ticket.id}/transition", json={
        "to_status": "reopened", "expected_version": resolved["version"],
    })
    assert missing.status_code == 409   # gerekce zorunlu (durum makinesi)
    reopened = client.post(f"{HUB}/{ticket.id}/transition", json={
        "to_status": "reopened", "expected_version": resolved["version"],
        "reason": "Musteri sorunun surdugunu bildirdi",
    })
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "reopened"


def test_hub_list_sorts_by_priority_and_age(api, ticket_world):
    first = _ticket(ticket_world, title="Ilk acilan talep", impact="single_user")
    urgent = _ticket(ticket_world, title="Guvenlik riski", impact="security_or_data_risk")
    last = _ticket(ticket_world, title="Son acilan talep", impact="single_user")
    client = api(ticket_world["agent_a"])

    def ids(sort):
        body = client.get(HUB, params={"queue": "all", "sort": sort}).json()
        return [row["id"] for row in body["items"]]

    assert ids("priority")[0] == str(urgent.id)
    assert ids("oldest")[0] == str(first.id)
    assert ids("newest")[0] == str(last.id)
    assert client.get(HUB, params={"sort": "random"}).status_code == 422


def test_customer_can_cancel_only_before_support_replies(api, ticket_world):
    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    created = customer.post(PORTAL, json={
        "title": "Kaydetme hatasi", "description": "Kaydet butonu calismiyor.",
        "category": "bug", "impact": "single_user",
    }).json()
    assert created["can_cancel"] is True

    agent = api(ticket_world["agent_a"])
    reply = agent.post(f"{HUB}/{created['id']}/messages", json={
        "body": "Inceliyoruz.", "visibility": "public",
    })
    assert reply.status_code == 201, reply.text
    # Istemci fabrikasi kimligi app-genelinde degistirir: musteriye geri don.
    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    detail = customer.get(f"{PORTAL}/{created['id']}").json()
    assert detail["can_cancel"] is False


def test_responder_can_take_a_ticket_but_not_assign_others(api, ticket_world):
    """agent_b yalniz tickets.respond tasir: kendine alabilir, baskasina atayamaz."""
    from app.models.user_group import UserGroupMember

    s = ticket_world["session"]
    s.add(UserGroupMember(group_id=ticket_world["devops"].id,
                          user_id=ticket_world["agent_b"], is_active=True))
    s.flush()
    ticket = _ticket(ticket_world)
    client = api(ticket_world["agent_b"])
    other = client.post(f"{HUB}/{ticket.id}/assign-user", json={
        "user_id": str(ticket_world["agent_a"]), "expected_version": ticket.version,
    })
    assert other.status_code == 403
    taken = client.post(f"{HUB}/{ticket.id}/assign-user", json={
        "user_id": str(ticket_world["agent_b"]), "expected_version": ticket.version,
    })
    assert taken.status_code == 200, taken.text
    assert taken.json()["assigned_user_id"] == str(ticket_world["agent_b"])
