# =============================================================================
# HERMES — Uc yuzeyin izin/izolasyon matrisi (API seviyesi)
# =============================================================================
# `01_HERMES/04 §4-§5` kabul testleri. Gercek dependency zinciri kosar:
# RBAC cozumu sahte auth-service'ten, gorunurluk gercek predicate'lerden,
# veri gercek Postgres'ten gelir. Yalnizca oturum ve DB session'i
# override edilir.
# =============================================================================

import uuid

from app.models.ticketing import Ticket, TicketEvent
from app.services import ticket_service
from app.services.ticket_service import Actor, TicketCreateInput
from app.ticket_contract import EVENT_TICKET_ADMIN_ACCESSED

from .conftest import OTHER_TENANT_ID, THIRD_TENANT_ID

REQUESTER = Actor(
    type="tenant_user", role="requester", id="user-1",
    display_name="Example User", source_user_id="user-1",
)


def _seed_ticket(world, *, requester_id="user-1", app_key="logislot_app",
                 src_key="logislot_src", route_key="logislot_route"):
    s = world["session"]
    ticket = ticket_service.create_ticket(
        s, application=world[app_key], source_tenant=world[src_key],
        group=world["devops"],
        route_version=world[route_key].route_version,
        data=TicketCreateInput(
            source_ticket_id=str(uuid.uuid4()),
            requester_source_user_id=requester_id,
            requester_display_name="Example User",
            title="Kaydetme hatasi var",
            description="Kaydet butonundan sonra islem tamamlanmiyor.",
            category="bug", impact="multiple_users",
        ),
        actor=REQUESTER,
    )
    s.flush()
    return ticket


# =============================================================================
# Yuzey ayrimi
# =============================================================================

def test_hub_is_invisible_to_non_support_tenants(api, ticket_world):
    """Baska bir tenant icin hub ucu VAR DEGILDIR (403 degil, 404).

    403 dondurmek "boyle bir yuzey var ama sana kapali" bilgisini
    sizdirirdi.
    """
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    assert client.get("/api/v1/core/tickets").status_code == 404
    assert client.get(
        "/api/v1/core/tickets/queues"
    ).status_code == 404


def test_portal_is_invisible_inside_the_support_tenant(api, ticket_world):
    client = api(ticket_world["agent_a"])
    assert client.get("/api/v1/core/support/tickets").status_code == 404


def test_context_endpoint_decides_the_surface(api, ticket_world):
    hub = api(ticket_world["agent_a"]).get(
        "/api/v1/core/tickets/context"
    ).json()
    assert hub["surface"] == "hub"
    assert hub["can_create"] is False

    portal = api(ticket_world["customer"], OTHER_TENANT_ID).get(
        "/api/v1/core/tickets/context"
    ).json()
    assert portal["surface"] == "portal"
    assert portal["route"]["configured"] is True
    assert portal["route"]["group_name"] == "DevOps Team"
    assert portal["can_create"] is True


def test_context_reports_missing_route_and_blocks_creation(
    api, ticket_world
):
    from app.services import ticket_routing

    ticket_routing.deactivate_route(
        ticket_world["session"], source_tenant=ticket_world["hermes_src"]
    )
    ticket_world["session"].flush()
    body = api(ticket_world["customer"], OTHER_TENANT_ID).get(
        "/api/v1/core/tickets/context"
    ).json()
    assert body["route"]["configured"] is False
    assert body["can_create"] is False


# =============================================================================
# Hub: izin + kapsam matrisi
# =============================================================================

def test_agent_without_module_permission_is_forbidden(api, ticket_world):
    stranger = uuid.uuid4()
    ticket_world["grants"][str(stranger)] = []
    response = api(stranger).get("/api/v1/core/tickets")
    assert response.status_code == 403


def test_group_member_sees_the_ticket_and_a_non_member_does_not(
    api, ticket_world
):
    ticket = _seed_ticket(ticket_world)

    member = api(ticket_world["agent_a"]).get(
        f"/api/v1/core/tickets/{ticket.id}"
    )
    assert member.status_code == 200
    assert member.json()["ticket_number"].startswith("TKT-")

    outsider = api(ticket_world["agent_b"]).get(
        f"/api/v1/core/tickets/{ticket.id}"
    )
    # Kapsam disi kayit = VAR OLMAYAN kayit.
    assert outsider.status_code == 404


def test_list_is_scoped_to_the_callers_groups(api, ticket_world):
    _seed_ticket(ticket_world)
    member = api(ticket_world["agent_a"]).get(
        "/api/v1/core/tickets"
    ).json()
    assert member["total"] == 1
    outsider = api(ticket_world["agent_b"]).get(
        "/api/v1/core/tickets"
    ).json()
    assert outsider["total"] == 0


def test_admin_override_read_is_audited(api, ticket_world):
    ticket = _seed_ticket(ticket_world)
    s = ticket_world["session"]

    response = api(ticket_world["admin"]).get(
        f"/api/v1/core/tickets/{ticket.id}"
    )
    assert response.status_code == 200
    s.flush()
    audited = s.query(TicketEvent).filter(
        TicketEvent.ticket_id == ticket.id,
        TicketEvent.event_type == EVENT_TICKET_ADMIN_ACCESSED,
    ).count()
    assert audited == 1


def test_respond_permission_is_required_to_post(api, ticket_world):
    ticket = _seed_ticket(ticket_world)
    reader = uuid.uuid4()
    ticket_world["grants"][str(reader)] = ["tickets.access"]
    ticket_world["session"].add_all([])
    # Okuma izni olan ama grup uyeligi olmayan → 404 (kapsam).
    assert api(reader).post(
        f"/api/v1/core/tickets/{ticket.id}/messages",
        json={"body": "deneme", "visibility": "public"},
    ).status_code in (403, 404)

    # Grup uyesi ama yalnizca `tickets.access` → 403 (izin).
    ticket_world["grants"][str(ticket_world["agent_a"])] = [
        "tickets.access"
    ]
    response = api(ticket_world["agent_a"]).post(
        f"/api/v1/core/tickets/{ticket.id}/messages",
        json={"body": "deneme", "visibility": "public"},
    )
    assert response.status_code == 403


def test_version_conflict_is_reported_with_a_machine_readable_code(
    api, ticket_world
):
    ticket = _seed_ticket(ticket_world)
    client = api(ticket_world["agent_a"])
    stale = ticket.version
    assert client.post(
        f"/api/v1/core/tickets/{ticket.id}/messages",
        json={"body": "ilk yanit", "visibility": "public",
              "expected_version": stale},
    ).status_code == 201
    conflict = client.post(
        f"/api/v1/core/tickets/{ticket.id}/messages",
        json={"body": "ikinci", "visibility": "public",
              "expected_version": stale},
    )
    assert conflict.status_code == 409
    assert conflict.headers["X-Error-Code"] == "ticket_version_conflict"


def test_resolve_requires_the_resolve_permission(api, ticket_world):
    ticket = _seed_ticket(ticket_world)
    ticket_world["grants"][str(ticket_world["agent_a"])] = [
        "tickets.access", "tickets.respond",
    ]
    response = api(ticket_world["agent_a"]).post(
        f"/api/v1/core/tickets/{ticket.id}/resolve",
        json={"resolution_code": "fixed",
              "public_summary": "Giderildi ve dogrulandi, tesekkurler.",
              "expected_version": ticket.version},
    )
    assert response.status_code == 403


# =============================================================================
# Musteri portali
# =============================================================================

def test_customer_sees_only_their_own_tickets(api, ticket_world):
    mine = _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer_two"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )

    body = api(ticket_world["customer"], OTHER_TENANT_ID).get(
        "/api/v1/core/support/tickets"
    ).json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == str(mine.id)


def test_view_all_widens_to_the_workspace_but_never_beyond(
    api, ticket_world
):
    _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer_two"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    ticket_world["grants"][str(ticket_world["customer"])] = [
        "tickets.access", "tickets.create", "tickets.view_all",
    ]
    body = api(ticket_world["customer"], OTHER_TENANT_ID).get(
        "/api/v1/core/support/tickets"
    ).json()
    assert body["total"] == 2

    # Baska bir tenant HICBIR sekilde gormez (view_all olsa bile).
    ticket_world["grants"][str(ticket_world["customer"])] = [
        "tickets.access", "tickets.create", "tickets.view_all",
    ]
    other = api(ticket_world["customer"], THIRD_TENANT_ID).get(
        "/api/v1/core/support/tickets"
    ).json()
    assert other["total"] == 0


def test_customer_cannot_read_another_tenants_ticket_by_id(
    api, ticket_world
):
    ticket = _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    response = api(ticket_world["customer"], THIRD_TENANT_ID).get(
        f"/api/v1/core/support/tickets/{ticket.id}"
    )
    assert response.status_code == 404


def test_customer_detail_never_contains_internal_content(
    api, ticket_world
):
    ticket = _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    s = ticket_world["session"]
    agent = Actor(
        type="support_agent", role="agent",
        id=str(ticket_world["agent_a"]),
        display_name="agent@duosis.com", user_id=ticket_world["agent_a"],
    )
    ticket_service.add_message(
        s, ticket, body="GIZLI IC NOT", visibility="internal",
        actor=agent, author_type="agent",
    )
    ticket_service.resolve(
        s, ticket, resolution_code="fixed",
        public_summary="Musteriye gorunen cozum ozeti burada.",
        actor=agent, expected_version=ticket.version,
        internal_root_cause="GIZLI KOK NEDEN",
    )
    s.flush()

    body = api(ticket_world["customer"], OTHER_TENANT_ID).get(
        f"/api/v1/core/support/tickets/{ticket.id}"
    ).json()
    raw = str(body)
    assert "GIZLI IC NOT" not in raw
    assert "GIZLI KOK NEDEN" not in raw
    assert "internal_root_cause" not in raw
    assert all(m["author_type"] != "system" for m in body["messages"])
    # Agent gorunumunde IKISI de var.
    agent_body = api(ticket_world["agent_a"]).get(
        f"/api/v1/core/tickets/{ticket.id}"
    ).json()
    assert "GIZLI IC NOT" in str(agent_body)
    assert agent_body["resolution"]["internal_root_cause"] == (
        "GIZLI KOK NEDEN"
    )


def test_customer_cannot_post_an_internal_note(api, ticket_world):
    """Musteri semasinda `visibility` alani YOKTUR; gondermek 422'dir."""
    ticket = _seed_ticket(
        ticket_world, requester_id=str(ticket_world["customer"]),
        app_key="hermes_app", src_key="hermes_src",
        route_key="hermes_route",
    )
    response = api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"/api/v1/core/support/tickets/{ticket.id}/messages",
        json={"body": "gizli", "visibility": "internal"},
    )
    assert response.status_code == 422


def test_portal_create_requires_a_route(api, ticket_world):
    from app.services import ticket_routing

    ticket_routing.deactivate_route(
        ticket_world["session"], source_tenant=ticket_world["hermes_src"]
    )
    ticket_world["session"].flush()
    response = api(ticket_world["customer"], OTHER_TENANT_ID).post(
        "/api/v1/core/support/tickets",
        json={"title": "Kaydetme hatasi",
              "description": "Kaydet butonu calismiyor ve hata veriyor.",
              "category": "bug", "impact": "single_user"},
    )
    assert response.status_code == 409
    assert response.headers["X-Error-Code"] == "route_missing"


def test_portal_create_is_idempotent(api, ticket_world):
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    payload = {
        "title": "Kaydetme hatasi",
        "description": "Kaydet butonu calismiyor ve hata veriyor.",
        "category": "bug", "impact": "single_user",
        "source_ticket_id": str(uuid.uuid4()),
    }
    headers = {"Idempotency-Key": "portal-key-0001"}
    first = client.post(
        "/api/v1/core/support/tickets", json=payload, headers=headers
    )
    assert first.status_code == 201
    second = client.post(
        "/api/v1/core/support/tickets", json=payload, headers=headers
    )
    assert second.status_code == 201
    assert second.headers.get("Idempotency-Replayed") == "true"
    assert first.json()["id"] == second.json()["id"]
    assert ticket_world["session"].query(Ticket).count() == 1


def test_same_key_with_a_different_payload_conflicts(api, ticket_world):
    client = api(ticket_world["customer"], OTHER_TENANT_ID)
    base = {
        "title": "Kaydetme hatasi",
        "description": "Kaydet butonu calismiyor ve hata veriyor.",
        "category": "bug", "impact": "single_user",
    }
    headers = {"Idempotency-Key": "portal-key-0002"}
    assert client.post(
        "/api/v1/core/support/tickets", json=base, headers=headers
    ).status_code == 201
    changed = dict(base, title="Baska bir baslik burada")
    response = client.post(
        "/api/v1/core/support/tickets", json=changed, headers=headers
    )
    assert response.status_code == 409
    assert response.headers["X-Error-Code"] == "idempotency_conflict"


def test_customer_without_create_permission_is_forbidden(api, ticket_world):
    ticket_world["grants"][str(ticket_world["customer"])] = [
        "tickets.access"
    ]
    response = api(ticket_world["customer"], OTHER_TENANT_ID).post(
        "/api/v1/core/support/tickets",
        json={"title": "Kaydetme hatasi",
              "description": "Kaydet butonu calismiyor ve hata veriyor.",
              "category": "bug", "impact": "single_user"},
    )
    assert response.status_code == 403


# =============================================================================
# Integration API
# =============================================================================

def test_integration_requires_a_bearer_token(support_api, ticket_world):
    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:groups:read"]
    )
    http.headers.pop("Authorization")
    response = http.get("/api/integrations/v1/support/routing-groups")
    assert response.status_code == 401
    body = response.json()["error"]
    assert body["code"] == "unauthorized"
    assert "correlation_id" in body and "retryable" in body


def test_integration_scope_is_enforced(support_api, ticket_world):
    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:tickets:read"]
    )
    response = http.get("/api/integrations/v1/support/routing-groups")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "insufficient_scope"


def test_group_catalog_exposes_no_member_identities(
    support_api, ticket_world
):
    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:groups:read"]
    )
    response = http.get("/api/integrations/v1/support/routing-groups")
    assert response.status_code == 200
    body = response.json()
    assert body["catalog_version"]
    names = {item["name"] for item in body["items"]}
    assert {"DevOps Team", "Platform Team"} <= names
    for item in body["items"]:
        assert set(item) == {
            "id", "name", "description", "member_count", "updated_at",
        }
    # ETag ile ikinci istek govdesiz doner.
    etag = response.headers["ETag"]
    assert http.get(
        "/api/integrations/v1/support/routing-groups",
        headers={"If-None-Match": etag},
    ).status_code == 304


def test_integration_create_and_replay(support_api, ticket_world):
    http, _client, _token = support_api(
        ticket_world["logislot_app"],
        ["support:tickets:write", "support:tickets:read"],
    )
    source_ticket_id = str(uuid.uuid4())
    payload = {
        "contract_version": "1.0",
        "source_ticket_id": source_ticket_id,
        "source_tenant": {"id": "bta", "slug": "bta",
                          "display_name": "BTA"},
        "route": {"group_id": str(ticket_world["devops"].id),
                  "route_version":
                      ticket_world["logislot_route"].route_version},
        "requester": {"id": "user-1042", "display_name": "Example User",
                      "email": "user@example.com"},
        "title": "Randevu kaydinda hata",
        "description": "Kaydet butonundan sonra islem tamamlanmiyor.",
        "category": "bug", "impact": "multiple_users",
    }
    headers = {"Idempotency-Key": "logislot-key-0001"}
    created = http.post(
        "/api/integrations/v1/support/tickets", json=payload,
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["ticket_number"].startswith("TKT-")
    assert body["assigned_group"]["name"] == "DevOps Team"

    replay = http.post(
        "/api/integrations/v1/support/tickets", json=payload,
        headers=headers,
    )
    # Yanit kaybolan bir retry AYNI ticket'i doner (200 + replay basligi).
    assert replay.status_code == 200
    assert replay.headers["Idempotency-Replayed"] == "true"
    assert replay.json()["ticket_id"] == body["ticket_id"]


def test_integration_cannot_touch_another_applications_tenant(
    support_api, ticket_world
):
    """LogiSlot token'i, Hermes uygulamasinin kaynak tenant'ini GOREMEZ."""
    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:tickets:write"]
    )
    payload = {
        "contract_version": "1.0",
        "source_ticket_id": str(uuid.uuid4()),
        # Bu kimlik HERMES uygulamasinin tenant'idir.
        "source_tenant": {"id": OTHER_TENANT_ID},
        "route": {"group_id": str(ticket_world["devops"].id)},
        "requester": {"id": "user-1042"},
        "title": "Baskasinin tenant'i",
        "description": "Bu istek reddedilmelidir cunku tenant eslesmez.",
        "category": "bug", "impact": "single_user",
    }
    response = http.post(
        "/api/integrations/v1/support/tickets", json=payload
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "source_tenant_unknown"


def test_integration_snapshot_hides_internal_content(
    support_api, ticket_world
):
    ticket = _seed_ticket(ticket_world, requester_id="user-1042")
    s = ticket_world["session"]
    agent = Actor(
        type="support_agent", role="agent",
        id=str(ticket_world["agent_a"]), display_name="agent@duosis.com",
        user_id=ticket_world["agent_a"],
    )
    ticket_service.add_message(
        s, ticket, body="GIZLI IC NOT", visibility="internal",
        actor=agent, author_type="agent",
    )
    s.commit()

    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:tickets:read"]
    )
    response = http.get(
        f"/api/integrations/v1/support/tickets/{ticket.id}"
        f"?source_tenant_id=bta&requester_id=user-1042"
    )
    assert response.status_code == 200
    assert "GIZLI IC NOT" not in response.text
    assert "internal" not in response.json()


def test_integration_requester_scope_is_enforced(support_api, ticket_world):
    ticket = _seed_ticket(ticket_world, requester_id="user-1042")
    ticket_world["session"].commit()
    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:tickets:read"]
    )
    other = http.get(
        f"/api/integrations/v1/support/tickets/{ticket.id}"
        f"?source_tenant_id=bta&requester_id=someone-else"
    )
    assert other.status_code == 404


def test_capabilities_endpoint_is_public_and_content_free(
    support_api, ticket_world
):
    http, _client, _token = support_api(
        ticket_world["logislot_app"], ["support:groups:read"]
    )
    http.headers.pop("Authorization")
    body = http.get(
        "/api/integrations/v1/support/capabilities"
    ).json()
    assert body["contract_version"] == "1.0"
    assert "support:tickets:write" in body["scopes"]
    assert body["signature"]["encoding"] == "lowercase-hex"
