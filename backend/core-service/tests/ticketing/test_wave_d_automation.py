# =============================================================================
# HERMES — Dalga D2: otomasyon kurallari
# =============================================================================
#   Olay (acildi / musteri yanitladi) ayni transaction'da; zamanli kural
#   bakim isinde ve talep basina BIR kez. Bozuk kural talep akisini bozmaz.
#   Otomasyon mesaji "system" yazarlidir: ilk yanit SLA'sini karsilamaz.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

from app.models.ticket_helpdesk import TicketAutomationRun, TicketNotification
from app.models.ticketing import Ticket, TicketMessage
from app.services import ticket_automation

from .conftest import OTHER_TENANT_ID
from .test_wave_b import HD, HUB, NEW, PORTAL

RULES = f"{HD}/automations"


def _open(api, world, **extra):
    return api(world["customer"], OTHER_TENANT_ID).post(PORTAL, json={**NEW, **extra}).json()


def _rule(api, world, **body):
    response = api(world["admin"]).post(RULES, json={"name": "Kural", **body})
    assert response.status_code == 201, response.text
    return response.json()


def test_rules_are_validated_and_need_config_permission(api, ticket_world):
    assert api(ticket_world["agent_a"]).post(RULES, json={
        "name": "x", "trigger": "created", "actions": [{"type": "set_priority", "value": "high"}],
    }).status_code == 403
    admin = api(ticket_world["admin"])
    no_age = admin.post(RULES, json={"name": "x", "trigger": "schedule",
                                     "actions": [{"type": "set_priority", "value": "high"}]})
    assert no_age.status_code == 422
    bad = admin.post(RULES, json={"name": "x", "trigger": "created", "actions": [{"type": "explode"}]})
    assert bad.status_code == 422
    empty = admin.post(RULES, json={"name": "x", "trigger": "created", "actions": []})
    assert empty.status_code == 422


def test_created_rule_triages_matching_tickets_only(api, ticket_world):
    tag = api(ticket_world["admin"]).post(f"{HD}/tags", json={"name": "Fatura"}).json()
    _rule(api, ticket_world, name="Fatura triyaj", trigger="created",
          conditions={"category": ["bug"], "text_any": ["FATURA"]},
          actions=[{"type": "set_priority", "value": "urgent"},
                   {"type": "add_tags", "tag_ids": [tag["id"]]},
                   {"type": "internal_note", "body": "Fatura ekibine haber verin."},
                   {"type": "notify", "target": "group"}])
    hit = _open(api, ticket_world, title="Faturalar yanlis kesiliyor")     # TR fold: ı/i
    miss = _open(api, ticket_world, title="Yazici calismiyor")
    agent = api(ticket_world["agent_a"])
    body = agent.get(f"{HUB}/{hit['id']}").json()
    assert body["priority"] == "urgent" and [t["name"] for t in body["tags"]] == ["Fatura"]
    note = [m for m in body["messages"] if m["visibility"] == "internal"][-1]
    assert note["body"] == "Fatura ekibine haber verin."
    assert note["author_display_name"] == "Otomasyon: Fatura triyaj"
    kinds = [n.kind for n in ticket_world["session"].query(TicketNotification)
             .filter(TicketNotification.ticket_id == uuid.UUID(hit["id"])).all()]
    assert "automation" in kinds
    assert agent.get(f"{HUB}/{miss['id']}").json()["priority"] != "urgent"


def test_a_broken_rule_never_blocks_ticket_creation(api, ticket_world):
    stranger = str(uuid.uuid4())   # grubun uyesi degil → assign_user reddedilir
    broken = _rule(api, ticket_world, name="Bozuk", trigger="created", position=0,
                   actions=[{"type": "assign_user", "user_id": stranger}])
    _rule(api, ticket_world, name="Saglam", trigger="created", position=1,
          actions=[{"type": "set_priority", "value": "high"}])
    ticket = _open(api, ticket_world)
    assert "id" in ticket
    assert api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()["priority"] == "high"
    runs = api(ticket_world["admin"]).get(f"{RULES}/{broken['id']}/runs").json()
    assert runs[0]["outcome"] == "error" and runs[0]["ticket_number"].startswith("TKT-")


def test_customer_reply_rule_runs_after_the_status_moves(api, ticket_world):
    _rule(api, ticket_world, name="Yanit gelince", trigger="customer_replied",
          conditions={"status": ["in_progress"]},
          actions=[{"type": "set_priority", "value": "high"}])
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    version = agent.get(f"{HUB}/{ticket['id']}").json()["version"]
    agent.post(f"{HUB}/{ticket['id']}/transition", json={
        "to_status": "waiting_customer", "expected_version": version,
        "public_message": "Hangi tarayici?"})
    api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{PORTAL}/{ticket['id']}/messages", json={"body": "Chrome"})
    body = api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()
    assert body["status"] == "in_progress" and body["priority"] == "high"


def test_schedule_reminds_once_then_resolves_quiet_tickets(api, ticket_world):
    _rule(api, ticket_world, name="Hatirlat", trigger="schedule",
          conditions={"status": ["waiting_customer"], "age": {"basis": "public_activity", "hours": 72}},
          actions=[{"type": "public_reply", "body": "Hatirlatma: yanitinizi bekliyoruz."}])
    _rule(api, ticket_world, name="Kapat", trigger="schedule",
          conditions={"status": ["waiting_customer"], "age": {"basis": "public_activity", "hours": 168}},
          actions=[{"type": "resolve", "resolution_code": "answered",
                    "summary": "Yanit gelmedigi icin cozuldu."}])
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    version = agent.get(f"{HUB}/{ticket['id']}").json()["version"]
    agent.post(f"{HUB}/{ticket['id']}/transition", json={
        "to_status": "waiting_customer", "expected_version": version,
        "public_message": "Ekran goruntusu?"})
    s = ticket_world["session"]
    row = s.get(Ticket, uuid.UUID(ticket["id"]))
    first_response = row.first_response_at

    row.last_public_activity_at = datetime.now(timezone.utc) - timedelta(hours=80)
    s.flush()
    assert ticket_automation.run_schedules(s)["applied"] == 1        # yalniz hatirlatma
    assert ticket_automation.run_schedules(s)["applied"] == 0        # tekrar YOK
    reminders = s.query(TicketMessage).filter(
        TicketMessage.ticket_id == row.id, TicketMessage.author_type == "system").all()
    assert len(reminders) == 1 and reminders[0].visibility == "public"
    assert row.first_response_at == first_response                  # SLA sayilmaz

    row.last_public_activity_at = datetime.now(timezone.utc) - timedelta(hours=200)
    s.flush()
    assert ticket_automation.run_schedules(s)["applied"] == 1
    assert row.status == "resolved"
    assert s.query(TicketAutomationRun).filter(TicketAutomationRun.ticket_id == row.id).count() == 2


# -----------------------------------------------------------------------------
# Dakikalik zamanli kural + "ekipten birine ata" (CTO, 2026-10-14)
# -----------------------------------------------------------------------------

def _team(world, *extra):
    from app.models.user_group import UserGroupMember

    s = world["session"]
    for user_id in extra:
        s.add(UserGroupMember(group_id=world["devops"].id, user_id=user_id, is_active=True))
    s.flush()


def test_schedule_age_is_in_minutes_with_legacy_hours(api, ticket_world):
    admin = api(ticket_world["admin"])
    base = {"name": "x", "trigger": "schedule", "actions": [{"type": "assign_from_team"}]}
    too_soon = admin.post(RULES, json={**base, "conditions": {"age": {"basis": "created", "minutes": 4}}})
    assert too_soon.status_code == 422
    quarter = _rule(api, ticket_world, **{**base, "conditions": {"age": {"basis": "created", "minutes": 15}}})
    assert quarter["conditions"]["age"] == {"basis": "created", "minutes": 15}
    assert quarter["actions"] == [{"type": "assign_from_team", "user_ids": []}]
    legacy = _rule(api, ticket_world, **{**base, "conditions": {"age": {"basis": "updated", "hours": 2}}})
    assert legacy["conditions"]["age"] == {"basis": "updated", "minutes": 120}
    assert ticket_automation.age_minutes({"basis": "created", "hours": 3}) == 180   # eski kayit


def test_least_loaded_member_breaks_ties_by_longest_wait(api, ticket_world):
    s = ticket_world["session"]
    a, c, d = ticket_world["agent_a"], uuid.uuid4(), uuid.uuid4()
    _team(ticket_world, c, d)
    group = ticket_world["devops"].id
    for _ in range(2):                                         # a: iki acik talep
        row = s.get(Ticket, uuid.UUID(_open(api, ticket_world)["id"]))
        row.assigned_user_id = a
    s.flush()
    from app.services import ticket_service
    from app.services.ticket_service import Actor

    # c bir kez atama aldi (sonra birakildi) — esitlikte hic almamis d once.
    row = s.get(Ticket, uuid.UUID(_open(api, ticket_world)["id"]))
    ticket_service.assign_user(s, row, user_id=c, actor=Actor(type="system_job", role="agent", id="t"), expected_version=None)
    row.assigned_user_id = None
    s.flush()
    assert ticket_automation.least_loaded_member(s, group) == d
    assert ticket_automation.least_loaded_member(s, group, pool=[str(a), str(c)]) == c
    assert ticket_automation.least_loaded_member(s, group, pool=[str(uuid.uuid4())]) is None
    assert ticket_automation.least_loaded_member(s, None) is None


def test_fifteen_minutes_after_opening_the_team_gets_an_owner(api, ticket_world):
    from app.models.ticket_mail import TicketMailOutbox

    s = ticket_world["session"]
    c = uuid.uuid4()
    _team(ticket_world, c)
    _rule(api, ticket_world, name="15 dk atama", trigger="schedule",
          conditions={"assignee": "unassigned", "age": {"basis": "created", "minutes": 15}},
          actions=[{"type": "assign_from_team"}])
    fresh = s.get(Ticket, uuid.UUID(_open(api, ticket_world)["id"]))
    taken = s.get(Ticket, uuid.UUID(_open(api, ticket_world)["id"]))
    taken.assigned_user_id = ticket_world["agent_a"]           # biri elle aldi
    fresh.requester_email = "musteri@acme-holding.com.tr"
    s.flush()

    now = datetime.now(timezone.utc)
    assert ticket_automation.run_schedules(s, now=now + timedelta(minutes=10))["applied"] == 0
    assert fresh.assigned_user_id is None                       # henuz 15 dk olmadi
    assert ticket_automation.run_schedules(s, now=now + timedelta(minutes=16))["applied"] == 1
    assert fresh.assigned_user_id in (ticket_world["agent_a"], c)
    assert fresh.assigned_user_id == c                          # a'nin uzerinde acik talep var
    assert taken.assigned_user_id == ticket_world["agent_a"]    # elle alinana dokunulmaz
    mails = {r.kind for r in s.query(TicketMailOutbox).filter(TicketMailOutbox.ticket_id == fresh.id)}
    assert {"assigned", "agent_assigned"} <= mails              # musteriye + ekibe atama e-postasi
    assert ticket_automation.run_schedules(s, now=now + timedelta(minutes=30))["applied"] == 0   # bir kez
