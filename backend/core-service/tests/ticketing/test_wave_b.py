# =============================================================================
# HERMES — Talep yonetimi Dalga B (00-plan §4.2): helpdesk cekirdegi
# =============================================================================
#   SLA (mesai takvimi, duraklama, ihlal kuyrugu) · etiket · makro · gorunum
#   · takip + bildirim · okundu bilgisi · toplu islem · talep eden gecmisi.
# Sozlesme notu: hicbir test yeni bir `ticket_events` turu BEKLEMEZ.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.ticket_helpdesk import TicketNotification, TicketSlaClock
from app.services import ticket_sla

from .conftest import OTHER_TENANT_ID

HUB = "/api/v1/core/tickets"
HD = "/api/v1/core/tickets/helpdesk"
PORTAL = "/api/v1/core/support/tickets"
NEW = {"title": "Kaydetme hatasi", "description": "Kaydet butonu calismiyor.",
       "category": "bug", "impact": "single_user"}
IST = {"timezone": "Europe/Istanbul",
       "days": {str(d): [["09:00", "18:00"]] for d in range(1, 6)},
       "holidays": ["2026-10-29"]}


def _ist(y, m, d, hh, mm=0):
    from zoneinfo import ZoneInfo

    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("Europe/Istanbul"))


# =============================================================================
# 1) Mesai takvimi
# =============================================================================

def test_calendar_adds_business_time_across_evenings_weekends_and_holidays():
    cal = ticket_sla.Calendar(IST)
    # Pazartesi 17:00 + 2 saat → Sali 10:00
    assert cal.add_seconds(_ist(2026, 10, 12, 17), 7200) == _ist(2026, 10, 13, 10)
    # Cuma 17:30 + 1 saat → Pazartesi 09:30
    assert cal.add_seconds(_ist(2026, 10, 16, 17, 30), 3600) == _ist(2026, 10, 19, 9, 30)
    # Carsamba 17:00 + 2 saat; Persembe (29 Ekim) tatil → Cuma 10:00
    assert cal.add_seconds(_ist(2026, 10, 28, 17), 7200) == _ist(2026, 10, 30, 10)
    # Cuma 17:00 → Pazartesi 10:00 arasi = 2 mesai saati
    assert cal.seconds_between(_ist(2026, 10, 16, 17), _ist(2026, 10, 19, 10)) == 7200


def test_empty_calendar_is_24_7_and_bad_timezone_is_rejected():
    start = datetime(2026, 10, 17, 3, tzinfo=timezone.utc)
    assert ticket_sla.Calendar(None).add_seconds(start, 60) == start + timedelta(minutes=1)
    with pytest.raises(ticket_sla.SlaConfigError):
        ticket_sla.Calendar({"timezone": "Mars/Olympus", "days": {"1": [["09:00", "18:00"]]}})


# =============================================================================
# 2) SLA politikasi ve saat
# =============================================================================

def _policy(api, world, *, calendar=None, active=True):
    response = api(world["admin"]).put(f"{HD}/sla-policy", json={
        "name": "Standart", "is_active": active, "calendar": calendar,
        "targets": {p: {"first_response": 60, "resolution": 240}
                    for p in ("low", "normal", "high", "urgent")},
    })
    assert response.status_code == 200, response.text
    return response.json()


def _open(api, world):
    return api(world["customer"], OTHER_TENANT_ID).post(PORTAL, json=NEW).json()


def test_sla_policy_needs_config_permission(api, ticket_world):
    denied = api(ticket_world["agent_a"]).put(f"{HD}/sla-policy", json={"targets": {}})
    assert denied.status_code == 403
    suggested = api(ticket_world["agent_a"]).get(f"{HD}/sla-policy").json()
    assert suggested["exists"] is False and suggested["targets"]["urgent"]["first_response"] == 60
    bad = api(ticket_world["admin"]).put(f"{HD}/sla-policy", json={
        "targets": {"normal": {"first_response": 0}}})
    assert bad.status_code == 422


def test_sla_clock_follows_the_ticket_lifecycle(api, ticket_world):
    _policy(api, ticket_world)                       # 7/24
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    detail = agent.get(f"{HUB}/{ticket['id']}").json()
    assert detail["sla"]["first_response"]["status"] == "ok"
    assert detail["sla"]["resolution"]["target_minutes"] == 240

    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": "Bakiyoruz.", "visibility": "public"})
    detail = agent.get(f"{HUB}/{ticket['id']}").json()
    assert detail["sla"]["first_response"]["status"] == "met"

    paused = agent.post(f"{HUB}/{ticket['id']}/transition", json={
        "to_status": "waiting_customer", "expected_version": detail["version"],
        "public_message": "Hangi tarayici?"})
    assert paused.status_code == 200, paused.text
    paused = paused.json()
    assert paused["sla"]["resolution"]["status"] == "paused"
    due_before = paused["sla"]["resolution"]["due_at"]

    # Duraklamada saklanan kalan sure devamda AYNEN geri verilir.
    clock = ticket_world["session"].query(TicketSlaClock).filter_by(ticket_id=uuid.UUID(ticket["id"])).one()
    assert clock.remaining_seconds and clock.remaining_seconds > 3 * 3600
    # Musteri yanitlayinca talep OTOMATIK isleme doner (durum makinesi).
    api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{PORTAL}/{ticket['id']}/messages", json={"body": "Chrome kullaniyorum."})
    agent = api(ticket_world["agent_a"])
    resumed = agent.get(f"{HUB}/{ticket['id']}").json()
    assert resumed["status"] == "in_progress"
    assert resumed["sla"]["resolution"]["status"] in ("ok", "at_risk")
    assert resumed["sla"]["resolution"]["due_at"] >= due_before

    resolved = agent.post(f"{HUB}/{ticket['id']}/resolve", json={
        "resolution_code": "fixed", "public_summary": "Duzeldi",
        "expected_version": resumed["version"]}).json()
    assert resolved["sla"]["resolution"]["status"] == "met"


def test_breached_tickets_have_their_own_queue_and_sort_first(api, ticket_world):
    _policy(api, ticket_world)
    late = _open(api, ticket_world)
    fresh = _open(api, ticket_world)
    clock = ticket_world["session"].query(TicketSlaClock).filter_by(ticket_id=uuid.UUID(late["id"])).one()
    clock.first_response_due_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    ticket_world["session"].flush()
    agent = api(ticket_world["agent_a"])
    queue = agent.get(HUB, params={"queue": "sla_breached"}).json()
    assert [row["id"] for row in queue["items"]] == [late["id"]]
    assert queue["items"][0]["sla"]["status"] == "breached"
    by_due = agent.get(HUB, params={"queue": "all", "sort": "due"}).json()
    assert by_due["items"][0]["id"] == late["id"]
    assert fresh["id"] in [row["id"] for row in by_due["items"]]


def test_no_policy_means_no_sla(api, ticket_world):
    ticket = _open(api, ticket_world)
    assert api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()["sla"] is None


# =============================================================================
# 3) Etiketler + makrolar + gorunumler
# =============================================================================

def test_tags_are_managed_by_config_and_filter_the_list(api, ticket_world):
    assert api(ticket_world["agent_a"]).post(f"{HD}/tags", json={"name": "VIP"}).status_code == 403
    admin = api(ticket_world["admin"])
    vip = admin.post(f"{HD}/tags", json={"name": "VIP", "color": "gold"}).json()
    assert admin.post(f"{HD}/tags", json={"name": "vip"}).status_code == 422   # ad tekil
    ticket = _open(api, ticket_world)
    other = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    tags = agent.put(f"{HUB}/{ticket['id']}/tags", json={"tag_ids": [vip["id"]]}).json()
    assert [t["name"] for t in tags] == ["VIP"]
    listed = agent.get(HUB, params={"queue": "all", "tag": vip["id"]}).json()
    assert [row["id"] for row in listed["items"]] == [ticket["id"]]
    assert listed["items"][0]["tags"][0]["color"] == "gold"
    assert other["id"] not in [row["id"] for row in listed["items"]]


def test_macro_applies_message_priority_tag_and_status_in_one_go(api, ticket_world):
    admin = api(ticket_world["admin"])
    tag = admin.post(f"{HD}/tags", json={"name": "Bilgi bekleniyor"}).json()
    assert api(ticket_world["agent_a"]).post(f"{HD}/macros", json={
        "name": "Paylasilan", "is_shared": True}).status_code == 403
    bad = api(ticket_world["admin"]).post(f"{HD}/macros", json={
        "name": "Coz", "set_status": "resolved"})
    assert bad.status_code == 422
    macro = api(ticket_world["admin"]).post(f"{HD}/macros", json={
        "name": "Ekran goruntusu iste", "body": "Ekran goruntusu paylasir misiniz?",
        "visibility": "public", "set_status": "waiting_customer", "set_priority": "high",
        "add_tag_ids": [tag["id"]], "is_shared": True}).json()
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    version = agent.get(f"{HUB}/{ticket['id']}").json()["version"]
    applied = agent.post(f"{HUB}/{ticket['id']}/macros/{macro['id']}/apply",
                         json={"expected_version": version})
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["status"] == "waiting_customer" and body["priority"] == "high"
    assert [t["name"] for t in body["tags"]] == ["Bilgi bekleniyor"]
    assert any(m["body"] == "Ekran goruntusu paylasir misiniz?" and m["visibility"] == "public"
               for m in body["messages"])


def test_personal_views_are_private_shared_need_config(api, ticket_world):
    mine = api(ticket_world["agent_a"]).post(f"{HD}/views", json={
        "name": "Acil olanlarim", "filters": {"priority": ["urgent"], "junk": "x"}}).json()
    assert mine["filters"] == {"priority": ["urgent"]}
    assert api(ticket_world["agent_a"]).post(f"{HD}/views", json={
        "name": "Ekip", "is_shared": True}).status_code == 403
    others = api(ticket_world["agent_b"]).get(f"{HD}/views").json()
    assert mine["id"] not in [v["id"] for v in others]
    assert api(ticket_world["agent_b"]).delete(f"{HD}/views/{mine['id']}").status_code == 404
    assert api(ticket_world["agent_a"]).delete(f"{HD}/views/{mine['id']}").status_code == 204


# =============================================================================
# 4) Takip, bildirim, okundu bilgisi
# =============================================================================

def _kinds(world, user):
    return sorted(n.kind for n in world["session"].query(TicketNotification)
                  .filter(TicketNotification.user_id == user).all())


def test_team_is_notified_and_watchers_follow_customer_replies(api, ticket_world):
    ticket = _open(api, ticket_world)
    assert _kinds(ticket_world, ticket_world["agent_a"]) == ["new_ticket"]
    agent = api(ticket_world["agent_a"])
    watched = agent.put(f"{HUB}/{ticket['id']}/watch", json={"watching": True}).json()
    assert watched["watching"] is True and watched["watcher_count"] == 1
    api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{PORTAL}/{ticket['id']}/messages", json={"body": "Hala oluyor."})
    assert _kinds(ticket_world, ticket_world["agent_a"]) == ["customer_replied", "new_ticket"]

    bell = api(ticket_world["agent_a"]).get(f"{HD}/notifications").json()
    assert bell["unread"] == 2 and bell["items"][0]["ticket_number"].startswith("TKT-")
    api(ticket_world["agent_a"]).post(f"{HD}/notifications/read-all")
    assert api(ticket_world["agent_a"]).get(f"{HD}/notifications").json()["unread"] == 0


def test_taking_a_ticket_does_not_notify_yourself(api, ticket_world):
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    version = agent.get(f"{HUB}/{ticket['id']}").json()["version"]
    agent.post(f"{HUB}/{ticket['id']}/assign-user", json={
        "user_id": str(ticket_world["agent_a"]), "expected_version": version})
    assert "assigned" not in _kinds(ticket_world, ticket_world["agent_a"])


def test_unread_and_has_update_follow_what_each_side_has_seen(api, ticket_world):
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    row = agent.get(HUB, params={"queue": "all"}).json()["items"][0]
    assert row["unread"] is True                     # hic acilmadi
    agent.get(f"{HUB}/{ticket['id']}")               # okundu
    assert agent.get(HUB, params={"queue": "all"}).json()["items"][0]["unread"] is False

    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    assert customer.get(PORTAL).json()["items"][0]["has_update"] is False
    api(ticket_world["agent_a"]).post(f"{HUB}/{ticket['id']}/messages",
                                      json={"body": "Cozduk gibi.", "visibility": "public"})
    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    assert customer.get(PORTAL).json()["items"][0]["has_update"] is True
    customer.get(f"{PORTAL}/{ticket['id']}")
    assert customer.get(PORTAL).json()["items"][0]["has_update"] is False


# =============================================================================
# 5) Toplu islem + talep eden gecmisi
# =============================================================================

def test_bulk_reports_per_ticket_and_respects_scope(api, ticket_world):
    one = _open(api, ticket_world)
    two = _open(api, ticket_world)
    # agent_b yalniz Platform ekibini gorur: DevOps talepleri kapsam disi.
    ticket_world["grants"][str(ticket_world["agent_b"])] = ["tickets.access", "tickets.respond"]
    out_of_scope = api(ticket_world["agent_b"]).post(f"{HUB}/bulk", json={
        "ticket_ids": [one["id"]], "action": "priority", "value": "high"}).json()
    assert out_of_scope == [{"id": one["id"], "ok": False, "error": "not_found"}]

    agent = api(ticket_world["agent_a"])
    done = agent.post(f"{HUB}/bulk", json={
        "ticket_ids": [one["id"], two["id"]], "action": "priority", "value": "urgent"}).json()
    assert all(r["ok"] for r in done)
    assert agent.get(f"{HUB}/{one['id']}").json()["priority"] == "urgent"
    refused = agent.post(f"{HUB}/bulk", json={
        "ticket_ids": [one["id"]], "action": "status", "value": "resolved"}).json()
    assert refused[0]["ok"] is False


def test_requester_history_lists_their_other_tickets(api, ticket_world):
    first = _open(api, ticket_world)
    second = _open(api, ticket_world)
    history = api(ticket_world["agent_a"]).get(f"{HUB}/{second['id']}/requester-history").json()
    assert [row["id"] for row in history] == [first["id"]]


def test_cleanup_purges_old_read_ticket_notifications(api, ticket_world):
    from app.services.notification_service import purge_read

    _open(api, ticket_world)
    s = ticket_world["session"]
    note = s.query(TicketNotification).first()
    note.read_at = datetime.now(timezone.utc) - timedelta(days=120)
    s.flush()
    report = purge_read(s, dry_run=True)
    assert report["candidates"] >= 1 and report["deleted"] == 0
