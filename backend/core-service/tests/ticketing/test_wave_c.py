# =============================================================================
# HERMES — Talep yonetimi Dalga C (00-plan §4.3): rapor + CSAT
# =============================================================================
#   1. CSAT: yalniz talep eden, yalniz cozuldu/kapandi; tek kayit (guncellenir);
#      ajan detayinda gorunur.
#   2. Rapor: hacim, cozum, birikim, medyan, SLA uyumu, CSAT; kapsam = hub
#      gorunurlugu (Platform ekibi DevOps taleplerini SAYMAZ).
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

from app.models.ticket_helpdesk import TicketSlaClock

from .conftest import OTHER_TENANT_ID

HUB = "/api/v1/core/tickets"
HD = "/api/v1/core/tickets/helpdesk"
PORTAL = "/api/v1/core/support/tickets"
NEW = {"title": "Kaydetme hatasi", "description": "Kaydet butonu calismiyor.",
       "category": "bug", "impact": "single_user"}


def _open(api, world, **extra):
    return api(world["customer"], OTHER_TENANT_ID).post(PORTAL, json={**NEW, **extra}).json()


def _resolve(api, world, ticket_id):
    agent = api(world["agent_a"])
    version = agent.get(f"{HUB}/{ticket_id}").json()["version"]
    agent.post(f"{HUB}/{ticket_id}/messages", json={"body": "Bakiyoruz.", "visibility": "public"})
    version = agent.get(f"{HUB}/{ticket_id}").json()["version"]
    out = agent.post(f"{HUB}/{ticket_id}/resolve", json={
        "resolution_code": "fixed", "public_summary": "Duzeldi", "expected_version": version})
    assert out.status_code == 200, out.text
    return out.json()


def test_requester_rates_a_resolved_ticket_once_and_agents_see_it(api, ticket_world):
    ticket = _open(api, ticket_world)
    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    early = customer.post(f"{PORTAL}/{ticket['id']}/csat", json={"rating": 5})
    assert early.status_code == 422                         # henuz cozulmedi
    _resolve(api, ticket_world, ticket["id"])

    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    detail = customer.get(f"{PORTAL}/{ticket['id']}").json()
    assert detail["can_rate"] is True and detail["csat"] is None
    rated = customer.post(f"{PORTAL}/{ticket['id']}/csat", json={"rating": 4, "comment": "Hizliydi"}).json()
    assert rated["csat"]["rating"] == 4
    again = customer.post(f"{PORTAL}/{ticket['id']}/csat", json={"rating": 2}).json()
    assert again["csat"] == {**again["csat"], "rating": 2, "comment": None}

    assert customer.post(f"{PORTAL}/{ticket['id']}/csat", json={"rating": 9}).status_code == 422
    seen = api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()
    assert seen["csat"]["rating"] == 2


def test_another_requester_in_the_workspace_cannot_rate(api, ticket_world):
    ticket = _open(api, ticket_world)
    _resolve(api, ticket_world, ticket["id"])
    ticket_world["grants"][str(ticket_world["customer_two"])] = [
        "tickets.access", "tickets.create", "tickets.view_all"]
    other = api(ticket_world["customer_two"], OTHER_TENANT_ID)
    assert other.get(f"{PORTAL}/{ticket['id']}").json()["can_rate"] is False
    assert other.post(f"{PORTAL}/{ticket['id']}/csat", json={"rating": 1}).status_code == 403


def test_report_counts_volume_sla_and_csat_within_scope(api, ticket_world):
    api(ticket_world["admin"]).put(f"{HD}/sla-policy", json={
        "is_active": True, "targets": {p: {"first_response": 60, "resolution": 240}
                                       for p in ("low", "normal", "high", "urgent")}})
    done = _open(api, ticket_world)
    late = _open(api, ticket_world)
    _open(api, ticket_world)
    _resolve(api, ticket_world, done["id"])
    # Ikinci talebin ilk yanit vadesi gecmisti (ihlal).
    clock = ticket_world["session"].query(TicketSlaClock).filter_by(ticket_id=uuid.UUID(late["id"])).one()
    clock.first_response_due_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    ticket_world["session"].flush()
    api(ticket_world["customer"], OTHER_TENANT_ID).post(f"{PORTAL}/{done['id']}/csat", json={"rating": 5})

    report = api(ticket_world["agent_a"]).get(f"{HD}/reports", params={"days": 7}).json()
    totals = report["totals"]
    assert totals["created"] == 3 and totals["resolved"] == 1 and totals["backlog"] == 2
    assert totals["median_resolution_minutes"] is not None
    assert report["sla"]["first_response"] == {"total": 2, "met": 1, "rate": 0.5}
    assert report["sla"]["resolution"] == {"total": 1, "met": 1, "rate": 1.0}
    assert report["csat"] == {"responses": 1, "average": 5.0, "satisfied_rate": 1.0}
    assert sum(d["created"] for d in report["series"]) == 3, report["series"][-3:]
    assert report["teams"][0]["name"] == "DevOps Team" and report["teams"][0]["open"] == 2
    assert report["agents"][0]["user_id"] == str(ticket_world["agent_a"])
    assert report["by_category"] == {"bug": 3}

    # Platform ekibindeki ajan DevOps taleplerini gormez → raporda da yok.
    other = api(ticket_world["agent_b"]).get(f"{HD}/reports", params={"days": 7}).json()
    assert other["totals"]["created"] == 0 and other["totals"]["backlog"] == 0


def test_report_rejects_bad_period_and_timezone(api, ticket_world):
    agent = api(ticket_world["agent_a"])
    assert agent.get(f"{HD}/reports", params={"tz": "Mars/Olympus"}).status_code == 422
    assert agent.get(f"{HD}/reports", params={
        "from": "2026-10-10T00:00:00Z", "to": "2026-10-01T00:00:00Z"}).status_code == 422
