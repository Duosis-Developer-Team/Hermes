# =============================================================================
# HERMES — Dalga D4: talep e-posta kanali
# =============================================================================
#   Giden: kuyruk kanonik mutasyonla ayni transaction'da; yalniz Hermes
#   uygulamasinin talep edenine (LogiSlot'a YOK), ekibe atama/musteri
#   yaniti; gonderici yeniden dener, kalici hatada birakir, bayatlari atlar.
#   Gelen (varsayilan kapali): kimligi dogrulanmis, bagli tenant'in yetkili
#   uyesinden yeni talep; konudaki numara + talep sahibi = yanit; geri
#   kalan sessizce ya da kisa aciklamayla reddedilir.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.ticket_mail import TicketMailInbound, TicketMailOutbox
from app.models.ticketing import Ticket, TicketMessage
from app.services import ticket_mail, ticket_mail_inbound as inbound, ticket_mail_templates as templates

from .conftest import OTHER_TENANT_ID
from .test_wave_b import HD, HUB, NEW, PORTAL

MAIL = f"{HD}/mail"
CUSTOMER_EMAIL = "musteri@acme-holding.com.tr"
MAILBOX = "talep@duosis.com"


@pytest.fixture()
def mail_on(ticket_world, monkeypatch):
    settings = ticket_mail.get_settings()
    monkeypatch.setattr(settings, "NOTIFICATIONS_ENABLED", True)
    monkeypatch.setattr(settings, "APP_BASE_URL", "https://hermes.duosis.com")
    monkeypatch.setattr(settings, "TICKET_MAIL_INBOUND_MAILBOX", "")
    return settings


def _open(api, world, **extra):
    ticket = api(world["customer"], OTHER_TENANT_ID).post(PORTAL, json={**NEW, **extra}).json()
    row = world["session"].get(Ticket, uuid.UUID(ticket["id"]))
    row.requester_email = CUSTOMER_EMAIL          # portal kullanicisinin is adresi
    world["session"].flush()
    return ticket


def _rows(world, ticket_id=None):
    q = world["session"].query(TicketMailOutbox)
    if ticket_id:
        q = q.filter(TicketMailOutbox.ticket_id == uuid.UUID(ticket_id))
    return q.order_by(TicketMailOutbox.created_at).all()


def _version(agent, ticket):
    return agent.get(f"{HUB}/{ticket['id']}").json()["version"]


# -----------------------------------------------------------------------------
# Giden: kuyruk
# -----------------------------------------------------------------------------

def test_requester_gets_reply_question_and_resolution_mails(api, ticket_world, mail_on):
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": "Bakiyoruz.", "visibility": "public"})
    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": "Ic not", "visibility": "internal"})
    agent.post(f"{HUB}/{ticket['id']}/transition", json={
        "to_status": "waiting_customer", "expected_version": _version(agent, ticket),
        "public_message": "Hangi tarayici?"})
    agent.post(f"{HUB}/{ticket['id']}/resolve", json={
        "resolution_code": "fixed", "public_summary": "Duzeldi", "expected_version": _version(agent, ticket)})
    requester = [(r.kind, r.recipient_email) for r in _rows(ticket_world, ticket["id"]) if r.audience == "requester"]
    # Ic not e-posta uretmez; bilgi istegi TEK e-postadir (yanit + durum).
    assert requester == [("reply", CUSTOMER_EMAIL), ("waiting", CUSTOMER_EMAIL), ("resolved", CUSTOMER_EMAIL)]


def test_team_gets_assignment_and_customer_reply_mails(api, ticket_world, mail_on):
    ticket = _open(api, ticket_world)
    admin = api(ticket_world["admin"])
    admin.post(f"{HUB}/{ticket['id']}/assign-user", json={
        "user_id": str(ticket_world["agent_a"]), "expected_version": _version(admin, ticket)})
    api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{PORTAL}/{ticket['id']}/messages", json={"body": "Hala oluyor."})
    agent_rows = [(r.kind, r.recipient_user_id) for r in _rows(ticket_world, ticket["id"]) if r.audience == "agent"]
    assert agent_rows == [("agent_assigned", ticket_world["agent_a"]),
                          ("agent_customer_replied", ticket_world["agent_a"])]


def test_nothing_is_queued_for_logislot_reserved_or_disabled(api, ticket_world, mail_on, monkeypatch):
    s = ticket_world["session"]
    agent = api(ticket_world["agent_a"])
    logislot = _open(api, ticket_world)
    s.get(Ticket, uuid.UUID(logislot["id"])).application_id = ticket_world["logislot_app"].id
    s.flush()
    agent.post(f"{HUB}/{logislot['id']}/messages", json={"body": "Merhaba", "visibility": "public"})
    assert _rows(ticket_world, logislot["id"]) == []          # LogiSlot'un kendi webhook'u var

    seeded = _open(api, ticket_world)
    s.get(Ticket, uuid.UUID(seeded["id"])).requester_email = "ali@acme.hermes-demo.example.com"
    s.flush()
    agent.post(f"{HUB}/{seeded['id']}/messages", json={"body": "Merhaba", "visibility": "public"})
    assert _rows(ticket_world, seeded["id"]) == []            # dev tohum adresi

    api(ticket_world["admin"]).put(MAIL, json={"requester_enabled": False, "agent_enabled": True,
                                               "language": "tr", "inbound_enabled": False})
    off = _open(api, ticket_world)
    agent.post(f"{HUB}/{off['id']}/messages", json={"body": "Merhaba", "visibility": "public"})
    assert _rows(ticket_world, off["id"]) == []

    # Kuyruk her surecte yazilir; gonderim yalniz bayrak + Graph olan surecte.
    monkeypatch.setattr(mail_on, "NOTIFICATIONS_ENABLED", False)
    api(ticket_world["admin"]).put(MAIL, json={"requester_enabled": True, "agent_enabled": True,
                                               "language": "tr", "inbound_enabled": False})
    agent.post(f"{HUB}/{off['id']}/messages", json={"body": "Tekrar", "visibility": "public"})
    assert [r.status for r in _rows(ticket_world, off["id"])] == ["pending"]
    summary = ticket_mail.dispatch_pending(s, tenant_id="x")
    assert summary["status"] == "graph_not_configured" and summary["sent"] == 0


def test_reserved_and_malformed_addresses_are_not_deliverable():
    assert ticket_mail.deliverable("ayse@duosis.com")
    for bad in ("x@example.com", "x@acme.hermes-demo.example.com", "x@host.test", "x@box.local", "nope", None):
        assert not ticket_mail.deliverable(bad)
    assert ticket_mail.mask("ayse.yilmaz@duosis.com") == "a***z@duosis.com"


# -----------------------------------------------------------------------------
# Giden: gonderici
# -----------------------------------------------------------------------------

def test_dispatch_sends_retries_and_gives_up(api, ticket_world, mail_on):
    s = ticket_world["session"]
    ticket = _open(api, ticket_world, title='R&D "Fatura" hatasi')
    agent = api(ticket_world["agent_a"])
    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": 'Satir 1\nSatir 2 & "x"', "visibility": "public"})
    api(ticket_world["admin"]).post(f"{HUB}/{ticket['id']}/assign-user", json={
        "user_id": str(ticket_world["agent_a"]), "expected_version": _version(agent, ticket)})
    sent = []

    def send(**mail):
        sent.append(mail)

    directory = {str(ticket_world["agent_a"]): {"email": "ajan@duosis.com"}}
    summary = ticket_mail.dispatch_pending(s, tenant_id=str(s.get(Ticket, uuid.UUID(ticket["id"])).tenant_id),
                                           send=send, resolve_users=lambda t, ids: directory)
    assert summary["sent"] == 2
    to = {m["to_email"]: m for m in sent}
    reply = to[CUSTOMER_EMAIL]
    assert reply["subject"].startswith(f"[{ticket['ticket_number']}] ")
    assert "Satir 1<br>Satir 2 &amp; &quot;x&quot;" in reply["html_body"]
    assert "R&amp;D &quot;Fatura&quot; hatasi" in reply["html_body"]
    assert f"/support?ticket={ticket['id']}" in reply["html_body"]
    assert reply["reply_to"] is None                          # gelen e-posta kapali
    assert reply["headers"]["X-Hermes-Mail"] == "ticket"
    assert "/tickets?ticket=" in to["ajan@duosis.com"]["html_body"]
    assert to["ajan@duosis.com"]["reply_to"] is None

    # Gecici hata → yeniden dene; kalici hata → birak.
    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": "Ikinci", "visibility": "public"})
    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": "Ucuncu", "visibility": "public"})
    codes = iter([503, 400])

    def flaky(**mail):
        raise ticket_mail.SendError(next(codes), "graph error")

    summary = ticket_mail.dispatch_pending(s, tenant_id="x", send=flaky, resolve_users=lambda t, ids: {})
    assert summary["retried"] == 1 and summary["failed"] == 1
    retry = [r for r in _rows(ticket_world, ticket["id"]) if r.status == "pending"][0]
    assert retry.attempts == 1 and retry.next_attempt_at > datetime.now(timezone.utc)

    # 24 saatte gidemeyen bildirim bayatlar.
    retry.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
    s.flush()
    assert ticket_mail.dispatch_pending(s, tenant_id="x", send=send, resolve_users=lambda t, ids: {})["skipped"] == 1


def test_templates_follow_the_provider_language():
    ticket = Ticket(number=42, title="Rapor", status="resolved", priority="high",
                    assigned_group_name_snapshot="DevOps Team", id=uuid.uuid4())
    tr = templates.render("resolved", lang="tr", ticket=ticket, app_base_url="javascript:alert(1)")
    en = templates.render("resolved", lang="en", ticket=ticket, app_base_url="https://h.example")
    assert tr.subject == "[TKT-000042] Talebiniz çözüldü: Rapor"
    assert en.subject == "[TKT-000042] Your request was resolved: Rapor"
    assert "javascript:" not in tr.html                       # guvensiz taban adres → buton yok
    assert "View and rate" in en.html
    assert "Öncelik" not in tr.html                           # oncelik ic triyaj; musteriye gosterilmez
    assert "Priority" in templates.render("agent_assigned", lang="en", ticket=ticket).html
    raw = templates.render("reply", lang="tr", ticket=ticket,
                           message=TicketMessage(body="<script>alert(1)</script>"))
    assert "<script>" not in raw.html and "&lt;script&gt;alert(1)&lt;/script&gt;" in raw.html


# -----------------------------------------------------------------------------
# Ayar ucu
# -----------------------------------------------------------------------------

def test_mail_settings_need_config_and_show_the_inbound_address(api, ticket_world, mail_on, monkeypatch):
    assert api(ticket_world["agent_a"]).get(MAIL).status_code == 403
    admin = api(ticket_world["admin"])
    body = admin.get(MAIL).json()
    assert body["requester_enabled"] is True and body["inbound_enabled"] is False
    assert body["inbound_configured"] is False and body["inbound_address"] is None

    monkeypatch.setattr(mail_on, "TICKET_MAIL_INBOUND_MAILBOX", MAILBOX)
    saved = admin.put(MAIL, json={"requester_enabled": True, "agent_enabled": False,
                                  "language": "en", "inbound_enabled": True}).json()
    assert saved["agent_enabled"] is False and saved["language"] == "en"
    assert saved["inbound_address"] == MAILBOX                # destek tenant'i duz adresi kullanir
    assert ticket_mail.inbound_address("acme", is_support_tenant=False) == "talep+acme@duosis.com"
    assert admin.put(MAIL, json={"language": "de"}).status_code == 422


# -----------------------------------------------------------------------------
# Gelen: saf kurallar
# -----------------------------------------------------------------------------

def _msg(**over):
    base = {
        "id": "AAMk-" + uuid.uuid4().hex, "internetMessageId": f"<{uuid.uuid4().hex}@mail.acme>",
        "subject": "Rapor acilmiyor", "from": {"emailAddress": {"address": CUSTOMER_EMAIL}},
        "toRecipients": [{"emailAddress": {"address": MAILBOX}}], "ccRecipients": [],
        "receivedDateTime": "2026-10-14T08:00:00Z", "hasAttachments": False,
        "body": {"content": "Rapor ekrani bos geliyor."}, "uniqueBody": {"content": "Rapor ekrani bos geliyor."},
        "internetMessageHeaders": [{"name": "Authentication-Results",
                                    "value": "spf=pass smtp.mailfrom=acme; dmarc=pass action=none"}],
    }
    base.update(over)
    return base


def test_routing_threading_and_loop_rules():
    assert inbound.route_slug(_msg(), MAILBOX) == (True, None)
    plus = _msg(toRecipients=[{"emailAddress": {"address": "Talep+Acme@Duosis.com"}}])
    assert inbound.route_slug(plus, MAILBOX) == (True, "acme")
    assert inbound.route_slug(_msg(toRecipients=[{"emailAddress": {"address": "x@duosis.com"}}]), MAILBOX)[0] is False
    assert inbound.ticket_number_from("YNT: [TKT-000123] Rapor") == 123
    assert inbound.ticket_number_from("Rapor TKT-000123") is None
    assert inbound.clean_subject("RE: Fwd: YNT: [TKT-000123] Rapor  acilmiyor") == "Rapor acilmiyor"

    own = (MAILBOX, "hermes@duosis.com")
    assert inbound.is_automated({"auto-submitted": "auto-replied"}, CUSTOMER_EMAIL, own)
    assert inbound.is_automated({"x-hermes-mail": "ticket"}, CUSTOMER_EMAIL, own)
    assert inbound.is_automated({}, "mailer-daemon@acme.com", own)
    assert inbound.is_automated({}, "hermes@duosis.com", own)
    assert not inbound.is_automated({"auto-submitted": "no"}, CUSTOMER_EMAIL, own)

    assert inbound.sender_authenticated({"authentication-results": "spf=fail; dmarc=pass"})
    assert inbound.sender_authenticated({"authentication-results": "dmarc=none; compauth=pass reason=109"})
    assert inbound.sender_authenticated({"x-ms-exchange-organization-authas": "Internal"})
    assert not inbound.sender_authenticated({"authentication-results": "dmarc=fail; compauth=fail"})
    assert not inbound.sender_authenticated({})
    # DMARC sonucu baska bir alan adina aitse gecmez.
    assert inbound.sender_authenticated({"authentication-results": "dmarc=pass header.from=acme.com"}, "a@acme.com")
    assert not inbound.sender_authenticated({"authentication-results": "dmarc=pass header.from=evil.com"}, "a@acme.com")
    # Gonderenin iletiye koydugu ikinci (alttaki) baslik okunmaz.
    forged = {"internetMessageHeaders": [
        {"name": "Authentication-Results", "value": "spf=fail; dmarc=fail action=quarantine"},
        {"name": "Authentication-Results", "value": "dmarc=pass"},
    ]}
    assert not inbound.sender_authenticated(inbound.headers_of(forged), "a@acme.com")

    text = "Tesekkurler, oldu.\r\n\r\nOn Mon, 13 Oct 2026 at 10:00, Destek wrote:\r\n> eski\r\n> metin"
    assert inbound.clean_body(text) == "Tesekkurler, oldu."
    tr = "Tamam.\n\n13 Eki 2026 Pzt 10:00 tarihinde Destek şunu yazdı:\neski"
    assert inbound.clean_body(tr) == "Tamam."


# -----------------------------------------------------------------------------
# Gelen: isleme
# -----------------------------------------------------------------------------

@pytest.fixture()
def inbound_on(api, ticket_world, mail_on, monkeypatch):
    monkeypatch.setattr(mail_on, "TICKET_MAIL_INBOUND_MAILBOX", MAILBOX)
    api(ticket_world["admin"]).put(MAIL, json={"requester_enabled": True, "agent_enabled": True,
                                               "language": "tr", "inbound_enabled": True})
    customer = str(ticket_world["customer"])

    def find_user(tenant_id, email):
        if tenant_id == OTHER_TENANT_ID and email == CUSTOMER_EMAIL:
            return {"id": customer, "display_name": "Ayse Musteri", "work_email": email, "is_active": True}
        return None

    return inbound.Deps(find_user=find_user)


def test_a_member_email_opens_a_ticket_in_their_portal(api, ticket_world, inbound_on):
    s = ticket_world["session"]
    outcome = inbound.process_message(_msg(subject="FW: Rapor acilmiyor"), mailbox=MAILBOX, deps=inbound_on)
    assert outcome.outcome == "created"
    ticket = s.get(Ticket, uuid.UUID(outcome.ticket_id))
    assert ticket.title == "Rapor acilmiyor" and ticket.requester_email == CUSTOMER_EMAIL
    assert ticket.requester_source_user_id == str(ticket_world["customer"])
    portal = api(ticket_world["customer"], OTHER_TENANT_ID).get(PORTAL).json()["items"]
    assert [t["id"] for t in portal] == [outcome.ticket_id]
    assert [r.kind for r in _rows(ticket_world, outcome.ticket_id) if r.audience == "requester"] == ["received"]


def test_a_reply_with_the_number_continues_the_ticket(api, ticket_world, inbound_on):
    ticket = _open(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    agent.post(f"{HUB}/{ticket['id']}/transition", json={
        "to_status": "waiting_customer", "expected_version": _version(agent, ticket),
        "public_message": "Hangi tarayici?"})
    reply = _msg(subject=f"YNT: [{ticket['ticket_number']}] Sizden bilgi bekliyoruz",
                 uniqueBody={"content": "Chrome.\n\nFrom: Destek\nSent: ..."})
    outcome = inbound.process_message(reply, mailbox=MAILBOX, deps=inbound_on)
    assert outcome.outcome == "replied" and outcome.ticket_id == ticket["id"]
    body = agent.get(f"{HUB}/{ticket['id']}").json()
    assert body["status"] == "in_progress"                    # portal yanitiyla ayni kural
    last = [m for m in body["messages"] if m["visibility"] == "public"][-1]
    assert last["body"] == "Chrome." and last["author_type"] == "requester"
    # Ayni ileti ikinci kez islenmez.
    assert inbound.process_message(reply, mailbox=MAILBOX, deps=inbound_on).outcome == "duplicate"
    assert ticket_world["session"].query(TicketMessage).filter(
        TicketMessage.ticket_id == uuid.UUID(ticket["id"]), TicketMessage.body == "Chrome.").count() == 1


def test_untrusted_or_unknown_senders_do_not_open_tickets(api, ticket_world, inbound_on):
    s = ticket_world["session"]
    spoofed = _msg(internetMessageHeaders=[{"name": "Authentication-Results", "value": "dmarc=fail"}])
    assert inbound.process_message(spoofed, mailbox=MAILBOX, deps=inbound_on).reason == "unauthenticated"
    auto = _msg(internetMessageHeaders=[{"name": "Auto-Submitted", "value": "auto-replied"}])
    assert inbound.process_message(auto, mailbox=MAILBOX, deps=inbound_on).outcome == "ignored"
    stranger = {"from": {"emailAddress": {"address": "biri@baska-firma.com"}}}
    first = inbound.process_message(_msg(**stranger), mailbox=MAILBOX, deps=inbound_on)
    second = inbound.process_message(_msg(**stranger), mailbox=MAILBOX, deps=inbound_on)
    assert (first.reason, second.reason) == ("unknown_sender", "unknown_sender")
    assert s.query(Ticket).count() == 0
    # Dogrulanmis yabanciya saatte bir kisa aciklama; sahte gonderene hic.
    notes = [(r.kind, r.recipient_email, r.reason) for r in _rows(ticket_world)]
    assert notes == [("inbound_rejected", "biri@baska-firma.com", "unknown_sender")]
    assert {r.outcome for r in s.query(TicketMailInbound).all()} == {"rejected"}


def test_only_the_requester_can_reply_and_permission_is_required(api, ticket_world, inbound_on):
    ticket = _open(api, ticket_world)
    colleague = _msg(subject=f"RE: [{ticket['ticket_number']}] x",
                     **{"from": {"emailAddress": {"address": "mudur@acme-holding.com.tr"}}})
    assert inbound.process_message(colleague, mailbox=MAILBOX, deps=inbound_on).reason == "not_requester"
    ticket_world["grants"][str(ticket_world["customer"])] = ["tickets.access"]    # create yok
    from app.services import authz_client

    authz_client.clear_cache()
    assert inbound.process_message(_msg(), mailbox=MAILBOX, deps=inbound_on).reason == "unknown_sender"


def test_inbound_is_inert_until_enabled(api, ticket_world, mail_on, monkeypatch):
    # Kutu yapilandirilmamis: hic baglanilmaz.
    assert inbound.poll_mailbox(client=object())["status"] == "disabled"
    monkeypatch.setattr(mail_on, "TICKET_MAIL_INBOUND_MAILBOX", MAILBOX)
    # Kutu var ama saglayici gelen e-postayi acmamis.
    outcome = inbound.process_message(_msg(), mailbox=MAILBOX, deps=inbound.Deps(find_user=lambda t, e: None))
    assert (outcome.outcome, outcome.reason) == ("ignored", "inbound_disabled")


def test_poll_moves_each_message_to_its_folder(api, ticket_world, inbound_on, monkeypatch):
    moved = []

    class FakeGraph:
        async def list_inbox(self, *, mailbox, top):
            return [_msg(id="m1"), _msg(id="m2", internetMessageHeaders=[])]

        async def ensure_folder(self, *, mailbox, name):
            return name

        async def move_message(self, *, mailbox, message_id, folder_id):
            moved.append((message_id, folder_id))

        async def list_attachments(self, *, mailbox, message_id):
            return []

    summary = inbound.poll_mailbox(client=FakeGraph(), deps_factory=lambda mid: inbound_on)
    assert summary["created"] == 1 and summary["rejected"] == 1
    assert moved == [("m1", inbound.PROCESSED_FOLDER), ("m2", inbound.REJECTED_FOLDER)]


def test_email_attachments_pass_the_scan_pipeline(api, ticket_world, inbound_on, mail_on, monkeypatch, tmp_path):
    import base64

    from app.models.ticketing import TicketAttachment
    from app.services import ticket_storage

    monkeypatch.setattr(mail_on, "TICKET_ATTACHMENTS_ENABLED", True)
    monkeypatch.setattr(mail_on, "TICKET_STORAGE_BACKEND", "local")
    monkeypatch.setattr(mail_on, "TICKET_STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(mail_on, "TICKET_SCANNER_MODE", "disabled_dev_only")
    ticket_storage.get_storage(force_reload=True)
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()
    exe = base64.b64encode(b"MZ" + b"\x00" * 64).decode()
    files = [
        {"@odata.type": "#microsoft.graph.fileAttachment", "name": "ekran.png", "contentType": "image/png",
         "contentBytes": png, "isInline": False},
        {"@odata.type": "#microsoft.graph.fileAttachment", "name": "imza.png", "contentType": "image/png",
         "contentBytes": png, "isInline": True},                       # imza logosu: yok sayilir
        {"@odata.type": "#microsoft.graph.fileAttachment", "name": "kur.exe",
         "contentType": "application/octet-stream", "contentBytes": exe, "isInline": False},
    ]
    deps = inbound.Deps(find_user=inbound_on.find_user, fetch_attachments=lambda mid: files)
    outcome = inbound.process_message(_msg(hasAttachments=True), mailbox=MAILBOX, deps=deps)
    assert outcome.outcome == "created"
    attached = ticket_world["session"].query(TicketAttachment).filter(
        TicketAttachment.ticket_id == uuid.UUID(outcome.ticket_id)).all()
    assert [a.file_name for a in attached] == ["ekran.png"]
    description = ticket_world["session"].get(Ticket, uuid.UUID(outcome.ticket_id))
    first = ticket_world["session"].query(TicketMessage).filter(
        TicketMessage.ticket_id == description.id).order_by(TicketMessage.sequence).first()
    assert "1 ek dosya eklenemedi" in first.body
