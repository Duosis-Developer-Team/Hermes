# =============================================================================
# HERMES — Ticket yasam dongusu (gercek Postgres)
# =============================================================================
# Bu dosya "is kurallari gercekten veritabaninda tutuyor mu?" sorusunu
# cevaplar: atomiklik, benzersizlik, canli grup uyeligi, atama
# temizligi, outbox kilitleme ve otomatik kapatma.
# =============================================================================

import uuid

import pytest
from sqlalchemy import func, text as sa_text

from app.models.ticketing import (
    Ticket,
    TicketEvent,
    TicketMessage,
    TicketOutboxEvent,
)
from app.models.user_group import UserGroupMember
from app.services import ticket_routing, ticket_service
from app.services import ticket_visibility as visibility
from app.services.ticket_service import Actor, TicketCreateInput
from app.ticket_contract import (
    EVENT_INTERNAL_NOTE_ADDED,
    EVENT_TICKET_CREATED,
    OUTBOUND_EVENT_TYPES,
)

REQUESTER = Actor(
    type="tenant_user", role="requester", id="user-1",
    display_name="Example User", source_user_id="user-1",
)


def _agent(world, admin=False):
    return Actor(
        type="support_agent", role="admin" if admin else "agent",
        id=str(world["admin"] if admin else world["agent_a"]),
        display_name="agent@duosis.com",
        user_id=world["admin"] if admin else world["agent_a"],
    )


def _create(world, *, source_ticket_id=None, title="Kaydetme hatasi var",
            app_key="logislot_app", src_key="logislot_src",
            route_key="logislot_route", attachment_ids=()):
    s = world["session"]
    return ticket_service.create_ticket(
        s,
        application=world[app_key],
        source_tenant=world[src_key],
        group=world["devops"],
        route_version=world[route_key].route_version,
        data=TicketCreateInput(
            source_ticket_id=source_ticket_id or str(uuid.uuid4()),
            requester_source_user_id="user-1",
            requester_display_name="Example User",
            requester_email="user@example.com",
            title=title,
            description="Kaydet butonundan sonra islem tamamlanmiyor.",
            category="bug", impact="multiple_users",
            attachment_ids=attachment_ids,
        ),
        actor=REQUESTER,
    )


# =============================================================================
# Olusturma
# =============================================================================

def test_create_writes_ticket_message_event_and_outbox_atomically(ticket_world):
    world = ticket_world
    s = world["session"]
    # LogiSlot uygulamasina callback tanimli olmali ki outbox yazilsin.
    world["logislot_app"].callback_url = "https://logislot.example.com/hook"
    s.flush()

    ticket = _create(world)
    s.flush()

    assert ticket.status == "open"
    assert ticket.number >= 1
    assert ticket.assigned_group_id == world["devops"].id
    assert ticket.assigned_group_name_snapshot == "DevOps Team"

    messages = s.query(TicketMessage).filter(
        TicketMessage.ticket_id == ticket.id
    ).all()
    assert len(messages) == 1
    assert messages[0].visibility == "public"
    assert messages[0].author_type == "requester"
    assert messages[0].sequence == 1

    events = s.query(TicketEvent).filter(
        TicketEvent.ticket_id == ticket.id
    ).all()
    assert [e.event_type for e in events] == [EVENT_TICKET_CREATED]

    outbox = s.query(TicketOutboxEvent).filter(
        TicketOutboxEvent.ticket_id == ticket.id
    ).all()
    assert len(outbox) == 1
    assert outbox[0].event_type == EVENT_TICKET_CREATED
    assert outbox[0].status == "pending"
    # Zarf sozlesme sekli.
    envelope = outbox[0].payload_json
    assert envelope["application_code"] == "logislot"
    assert envelope["ticket_number"].startswith("TKT-")
    assert envelope["sequence"] == 1


def test_no_outbox_row_when_the_application_has_no_callback(ticket_world):
    """Hermes'in kendi portali webhook BEKLEMEZ.

    Kayit yazmak, 24 saat sonra dead-letter'a dusecek sahte bir kuyruk
    uretirdi ve "dead-letter 0" release kapisini kalici kirardi.
    """
    world = ticket_world
    s = world["session"]
    ticket = _create(
        world, app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    s.flush()
    assert s.query(TicketOutboxEvent).filter(
        TicketOutboxEvent.ticket_id == ticket.id
    ).count() == 0


def test_duplicate_source_ticket_returns_the_same_canonical_record(ticket_world):
    world = ticket_world
    s = world["session"]
    source_id = str(uuid.uuid4())
    first = _create(world, source_ticket_id=source_id)
    s.flush()
    second = _create(world, source_ticket_id=source_id)
    s.flush()
    assert first.id == second.id
    assert s.query(func.count(Ticket.id)).scalar() == 1


def test_ticket_numbers_are_unique_and_monotonic(ticket_world):
    world = ticket_world
    s = world["session"]
    numbers = []
    for _ in range(5):
        numbers.append(_create(world).number)
        s.flush()
    assert numbers == sorted(numbers)
    assert len(set(numbers)) == 5


def test_create_is_blocked_when_the_route_group_is_inactive(ticket_world):
    world = ticket_world
    s = world["session"]
    world["devops"].is_active = False
    s.flush()
    with pytest.raises(ticket_service.TicketValidationError) as exc:
        ticket_routing.resolve_route(
            s, source_tenant=world["logislot_src"]
        )
    assert exc.value.code == "group_inactive"


def test_create_is_blocked_without_a_route(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket_routing.deactivate_route(s, source_tenant=world["logislot_src"])
    s.flush()
    with pytest.raises(ticket_service.TicketValidationError) as exc:
        ticket_routing.resolve_route(
            s, source_tenant=world["logislot_src"]
        )
    assert exc.value.code == "route_missing"


def test_stale_route_version_is_rejected(ticket_world):
    world = ticket_world
    s = world["session"]
    with pytest.raises(ticket_service.TicketValidationError) as exc:
        ticket_routing.resolve_route(
            s, source_tenant=world["logislot_src"],
            expected_route_version=99,
        )
    assert exc.value.code == "route_stale"


# =============================================================================
# Gorunurluk — CANLI grup uyeligi
# =============================================================================

def test_group_membership_drives_visibility_live(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()

    member = visibility.HubScope(
        user_id=str(world["agent_a"]),
        permissions=frozenset({"tickets.access"}),
        group_ids=visibility.active_group_ids(s, str(world["agent_a"])),
    )
    outsider = visibility.HubScope(
        user_id=str(world["agent_b"]),
        permissions=frozenset({"tickets.access"}),
        group_ids=visibility.active_group_ids(s, str(world["agent_b"])),
    )
    visibility.assert_hub_can_view(ticket, member)
    with pytest.raises(visibility.TicketAccessDenied):
        visibility.assert_hub_can_view(ticket, outsider)

    # Uyelik pasife alininca erisim ANINDA duser (snapshot degil).
    s.query(UserGroupMember).filter(
        UserGroupMember.user_id == world["agent_a"]
    ).update({"is_active": False})
    s.flush()
    revoked = visibility.HubScope(
        user_id=str(world["agent_a"]),
        permissions=frozenset({"tickets.access"}),
        group_ids=visibility.active_group_ids(s, str(world["agent_a"])),
    )
    with pytest.raises(visibility.TicketAccessDenied):
        visibility.assert_hub_can_view(ticket, revoked)


def test_admin_sees_every_ticket_regardless_of_group(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    admin = visibility.HubScope(
        user_id=str(world["admin"]),
        permissions=frozenset({"tickets.admin", "tickets.access"}),
        group_ids=(),
    )
    visibility.assert_hub_can_view(ticket, admin)


def test_assignment_alone_never_grants_access(ticket_world):
    """Yanlis bir atama, private grup sinirini DELEMEZ (02_HERMES §2)."""
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    ticket.assigned_user_id = world["agent_b"]  # baska grubun uyesi
    s.flush()
    outsider = visibility.HubScope(
        user_id=str(world["agent_b"]),
        permissions=frozenset({"tickets.access"}),
        group_ids=visibility.active_group_ids(s, str(world["agent_b"])),
    )
    with pytest.raises(visibility.TicketAccessDenied):
        visibility.assert_hub_can_view(ticket, outsider)


# =============================================================================
# Atama
# =============================================================================

def test_reassigning_the_group_drops_a_non_member_assignee(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    ticket_service.assign_user(
        s, ticket, user_id=world["agent_a"], actor=_agent(world),
        expected_version=ticket.version,
    )
    assert ticket.assigned_user_id == world["agent_a"]

    ticket_service.assign_group(
        s, ticket, group_id=world["platform"].id, actor=_agent(world),
        expected_version=ticket.version,
    )
    # agent_a Platform Team uyesi DEGIL → atama atomik olarak dusurulur.
    assert ticket.assigned_user_id is None
    assert ticket.assigned_group_name_snapshot == "Platform Team"


def test_assignee_must_be_an_active_member_of_the_group(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    with pytest.raises(ticket_service.TicketValidationError):
        ticket_service.assign_user(
            s, ticket, user_id=world["agent_b"], actor=_agent(world),
            expected_version=ticket.version,
        )


# =============================================================================
# Konusma ve otomatik kurallar
# =============================================================================

def test_customer_reply_moves_waiting_customer_back_to_in_progress(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    ticket_service.transition(
        s, ticket, to_status="waiting_customer", actor=_agent(world),
        expected_version=ticket.version,
        public_message="Hata kodunu paylasabilir misiniz?",
    )
    assert ticket.status == "waiting_customer"

    ticket_service.add_message(
        s, ticket, body="LS-API-409", visibility="public",
        actor=REQUESTER, author_type="requester",
    )
    assert ticket.status == "in_progress"


def test_customer_reply_reopens_a_resolved_ticket_inside_the_window(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    ticket_service.resolve(
        s, ticket, resolution_code="fixed",
        public_summary="Dogrulama hatasi giderildi ve dogrulandi.",
        actor=_agent(world), expected_version=ticket.version,
    )
    assert ticket.status == "resolved"

    ticket_service.add_message(
        s, ticket, body="Sorun devam ediyor.", visibility="public",
        actor=REQUESTER, author_type="requester",
    )
    assert ticket.status == "reopened"


def test_internal_note_never_produces_an_outbound_event(ticket_world):
    world = ticket_world
    s = world["session"]
    world["logislot_app"].callback_url = "https://logislot.example.com/hook"
    ticket = _create(world)
    s.flush()
    before = s.query(func.count(TicketOutboxEvent.id)).scalar()

    ticket_service.add_message(
        s, ticket, body="Musteri gecen hafta da aramisti.",
        visibility="internal", actor=_agent(world), author_type="agent",
    )
    after = s.query(func.count(TicketOutboxEvent.id)).scalar()
    assert after == before

    internal_events = s.query(TicketEvent).filter(
        TicketEvent.ticket_id == ticket.id,
        TicketEvent.event_type == EVENT_INTERNAL_NOTE_ADDED,
    ).count()
    assert internal_events == 1


def test_first_response_is_stamped_once(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    assert ticket.first_response_at is None
    ticket_service.add_message(
        s, ticket, body="Bakiyoruz.", visibility="public",
        actor=_agent(world), author_type="agent",
    )
    stamped = ticket.first_response_at
    assert stamped is not None
    ticket_service.add_message(
        s, ticket, body="Guncelleme.", visibility="public",
        actor=_agent(world), author_type="agent",
    )
    assert ticket.first_response_at == stamped


def test_public_agent_messages_show_the_team_not_the_person(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    message = ticket_service.add_message(
        s, ticket, body="Bakiyoruz.", visibility="public",
        actor=_agent(world), author_type="agent",
    )
    assert message.author_display_name == "DevOps Team"
    # Kim yazdi bilgisi IC tarafta duruyor.
    assert message.author_user_id == world["agent_a"]


# =============================================================================
# Surum catismasi
# =============================================================================

def test_stale_expected_version_is_rejected(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    stale = ticket.version
    ticket_service.add_message(
        s, ticket, body="Bakiyoruz.", visibility="public",
        actor=_agent(world), author_type="agent",
    )
    with pytest.raises(ticket_service.TicketConflict):
        ticket_service.add_message(
            s, ticket, body="ikinci", visibility="public",
            actor=_agent(world), author_type="agent",
            expected_version=stale,
        )


# =============================================================================
# Cozum revizyonlari
# =============================================================================

def test_reopen_then_resolve_creates_a_new_revision(ticket_world):
    world = ticket_world
    s = world["session"]
    ticket = _create(world)
    s.flush()
    first = ticket_service.resolve(
        s, ticket, resolution_code="workaround",
        public_summary="Gecici cozum uygulandi, kalicisi planlandi.",
        actor=_agent(world), expected_version=ticket.version,
    )
    ticket_service.reopen(
        s, ticket, reason="Sorun tekrar etti.", actor=REQUESTER,
        expected_version=ticket.version,
    )
    second = ticket_service.resolve(
        s, ticket, resolution_code="fixed",
        public_summary="Kok neden giderildi ve dogrulandi.",
        actor=_agent(world), expected_version=ticket.version,
        internal_root_cause="Yaris kosulu; kilit eklendi.",
    )
    assert first.revision == 1 and second.revision == 2
    # Eski cozum SILINMEZ, yalnizca gecersiz damgasi alir.
    assert first.superseded_at is not None
    assert ticket.current_resolution_id == second.id


# =============================================================================
# Otomatik kapatma
# =============================================================================

def test_auto_close_only_touches_eligible_resolved_tickets(ticket_world):
    world = ticket_world
    s = world["session"]
    eligible = _create(world)
    fresh = _create(world)
    untouched = _create(world)
    s.flush()

    for ticket in (eligible, fresh):
        ticket_service.resolve(
            s, ticket, resolution_code="answered",
            public_summary="Sorunuz yanitlandi, tesekkurler.",
            actor=_agent(world), expected_version=ticket.version,
        )
    # `eligible`i pencerenin disina tasi.
    s.execute(sa_text(
        "UPDATE tickets SET resolved_at = now() - interval '30 days' "
        " WHERE id = :i"
    ), {"i": eligible.id})
    s.flush()
    s.expire_all()

    summary = ticket_service.auto_close_due_tickets(s)
    s.flush()
    assert summary["closed"] == 1
    assert s.get(Ticket, eligible.id).status == "closed"
    assert s.get(Ticket, fresh.id).status == "resolved"
    assert s.get(Ticket, untouched.id).status == "open"


# =============================================================================
# Outbox teslimati
# =============================================================================

def test_outbox_claim_locks_rows_so_two_dispatchers_cannot_double_send(
    ticket_world, pg_engine
):
    """`FOR UPDATE SKIP LOCKED`: ikinci dispatcher AYNI satiri ALAMAZ."""
    from sqlalchemy.orm import sessionmaker

    from app.services import ticket_delivery_service as delivery

    world = ticket_world
    s = world["session"]
    world["logislot_app"].callback_url = "https://logislot.example.com/hook"
    _create(world)
    s.commit()

    Session = sessionmaker(bind=pg_engine)
    first, second = Session(), Session()
    try:
        claimed_a = delivery.claim_due(first, limit=10, worker_id="a")
        assert len(claimed_a) == 1
        claimed_b = delivery.claim_due(second, limit=10, worker_id="b")
        assert claimed_b == []
    finally:
        first.rollback(); first.close()
        second.rollback(); second.close()
        s.execute(sa_text("TRUNCATE ticket_outbox_events CASCADE"))
        s.commit()


def test_failed_delivery_backs_off_then_dead_letters(ticket_world, monkeypatch):
    from app.services import ticket_delivery_service as delivery

    world = ticket_world
    s = world["session"]
    world["logislot_app"].callback_url = "https://logislot.example.com/hook"
    world["logislot_app"].webhook_key_id = "v1"
    _create(world)
    s.flush()
    row = s.query(TicketOutboxEvent).one()

    monkeypatch.setenv(
        "HERMES_TICKET_WEBHOOK_SECRET__LOGISLOT", "s3cr3t-for-tests"
    )
    monkeypatch.setattr(
        delivery, "validate_callback_url", lambda url: None
    )

    class _Resp:
        status_code = 503

    class _Client:
        def post(self, *a, **k):
            return _Resp()

    result = delivery.deliver_one(
        s, row, application=world["logislot_app"], client=_Client()
    )
    assert result == "retry"
    assert row.status == "pending"
    assert row.attempts == 1
    assert row.last_error_code == "http_503"

    # Kalici 400: retry EDILMEZ, dogrudan dead-letter.
    class _Resp400:
        status_code = 400

    class _Client400:
        def post(self, *a, **k):
            return _Resp400()

    row.status = "in_flight"
    result = delivery.deliver_one(
        s, row, application=world["logislot_app"], client=_Client400()
    )
    assert result == "dead"
    assert row.status == "dead" and row.dead_at is not None


def test_manual_replay_keeps_the_same_event_id(ticket_world):
    from app.services import ticket_delivery_service as delivery

    world = ticket_world
    s = world["session"]
    world["logislot_app"].callback_url = "https://logislot.example.com/hook"
    _create(world)
    s.flush()
    row = s.query(TicketOutboxEvent).one()
    row.status = "dead"
    row.dead_at = row.created_at
    s.flush()

    original = row.event_id
    delivery.replay(s, row, actor=None)
    assert row.status == "pending"
    assert row.event_id == original      # consumer idempotent kalabilsin
    assert row.dead_at is None


def test_outbound_event_types_stay_inside_the_contract(ticket_world):
    world = ticket_world
    s = world["session"]
    world["logislot_app"].callback_url = "https://logislot.example.com/hook"
    ticket = _create(world)
    s.flush()
    ticket_service.add_message(
        s, ticket, body="Bakiyoruz.", visibility="public",
        actor=_agent(world), author_type="agent",
        application=world["logislot_app"],
        source_tenant=world["logislot_src"],
    )
    ticket_service.resolve(
        s, ticket, resolution_code="fixed",
        public_summary="Giderildi ve dogrulandi, tesekkurler.",
        actor=_agent(world), expected_version=ticket.version,
        internal_root_cause="IC BILGI",
        application=world["logislot_app"],
        source_tenant=world["logislot_src"],
    )
    s.flush()

    rows = s.query(TicketOutboxEvent).all()
    assert rows
    for row in rows:
        assert row.event_type in OUTBOUND_EVENT_TYPES
        # Internal icerik zarfin HICBIR yerinde olamaz.
        assert "IC BILGI" not in str(row.payload_json)
        assert "internal_root_cause" not in str(row.payload_json)


# =============================================================================
# Job surecleri: dogrulama kapisi
# =============================================================================

def test_jobs_verify_the_support_tenant_in_their_own_process(
    ticket_world, monkeypatch
):
    """CronJob AYRI bir surectir ve API startup'ini CALISTIRMAZ.

    Regresyon: dispatcher canlida exit 0 ile
    `{"status": "skipped", "reason": "unverified"}` donuyordu — outbox
    hicbir zaman gonderilmiyor, hata da verilmiyordu. Modul durumu
    surec-global oldugu icin is, availability'yi sormadan ONCE
    dogrulamak ZORUNDA.
    """
    from app.jobs import ticket_dispatcher, ticket_maintenance
    from app.services import support_tenant

    # Taze bir surec gibi: durum henuz dogrulanmamis.
    support_tenant._force_state_for_tests("unverified")
    assert not support_tenant.is_available()

    calls = []
    monkeypatch.setattr(
        support_tenant, "ensure_verified",
        lambda: (calls.append(1), support_tenant._force_state_for_tests("ok"))
        and "ok",
    )
    # Isin kendisi calismasin; yalnizca kapiyi olcuyoruz.
    monkeypatch.setattr(
        support_tenant, "support_session",
        lambda: (_ for _ in ()).throw(RuntimeError("stop-after-gate")),
    )

    for job in (ticket_dispatcher, ticket_maintenance):
        calls.clear()
        try:
            job.run_once()
        except RuntimeError as exc:
            assert "stop-after-gate" in str(exc)
        assert calls, f"{job.__name__} dogrulama yapmadan devam etti"

    support_tenant._force_state_for_tests("ok")


def test_ensure_verified_is_idempotent_when_already_ok():
    """Durum zaten `ok` ise DB'ye DOKUNULMAZ (her dakika kosan bir is
    icin gereksiz baglanti acmak istemiyoruz)."""
    from app.services import support_tenant

    support_tenant._force_state_for_tests("ok")
    touched = []
    original = support_tenant.verify_support_tenant
    support_tenant.verify_support_tenant = (
        lambda db: touched.append(1) or ("ok", None)
    )
    try:
        assert support_tenant.ensure_verified() == "ok"
        assert not touched
    finally:
        support_tenant.verify_support_tenant = original
