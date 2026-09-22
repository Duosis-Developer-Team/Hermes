"""
=============================================================================
PM rework A6 — talep → is (ticket → work item)
=============================================================================
Hub agent'i gordugu bir ticket'tan is kalemi acar; is `origin_type=
'ticket'` ile kaynagina baglidir, ticket detayinda listelenir. Ticket
olay kumesine dokunulmaz (sozlesme donmus). Kapsam disi ticket → 404;
`tickets.respond` yoksa 403; is tarafinda `tasks.access` gerekir.
=============================================================================
"""
import uuid
from datetime import date

from app.models.customer import Customer
from app.models.project import Project
from app.models.work_item import WorkItem
from app.services import ticket_service
from app.services.ticket_service import Actor, TicketCreateInput

from .conftest import OTHER_TENANT_ID

REQUESTER = Actor(
    type="tenant_user", role="requester", id="user-1",
    display_name="Example User", source_user_id="user-1",
)

HUB = "/api/v1/core/tickets"


def _item(world, item_id) -> WorkItem:
    # `api` fixture'i yalniz ticket bagimliliklarini override eder; is
    # kalemi dogrudan oturumdan okunur.
    world["session"].expire_all()
    return world["session"].get(WorkItem, uuid.UUID(item_id))


def _seed_ticket(world):
    s = world["session"]
    ticket = ticket_service.create_ticket(
        s, application=world["logislot_app"], source_tenant=world["logislot_src"],
        group=world["devops"], route_version=world["logislot_route"].route_version,
        data=TicketCreateInput(
            source_ticket_id=str(uuid.uuid4()), requester_source_user_id="user-1",
            requester_display_name="Example User", title="Kaydetme hatasi var",
            description="Kaydet butonundan sonra islem tamamlanmiyor.",
            category="bug", impact="multiple_users",
        ),
        actor=REQUESTER,
    )
    s.flush()
    return ticket


def _seed_project(world):
    s = world["session"]
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    s.add_all([c, p])
    s.commit()
    return c, p


def test_agent_creates_work_item_from_ticket(api, ticket_world):
    ticket = _seed_ticket(ticket_world)
    customer, project = _seed_project(ticket_world)
    grants = ticket_world["grants"]
    grants[str(ticket_world["agent_a"])] = grants[str(ticket_world["agent_a"])] + ["tasks.access"]
    client = api(ticket_world["agent_a"])

    res = client.post(f"{HUB}/{ticket.id}/work-items", json={
        "project_id": str(project.id), "due_date": "2026-12-31", "priority": "high",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert len(body["work_items"]) == 1
    ref = body["work_items"][0]
    assert ref["title"] == "Kaydetme hatasi var"
    assert ref["item_key"].startswith("TASK-")
    assert ref["owner_user_id"] == str(ticket_world["agent_a"])
    assert ref["status"] == "pending"

    # Is kalemi kaynagini tasir; aciklama ticket'tan turedi.
    item = _item(ticket_world, ref["id"])
    assert item.origin_type == "ticket" and item.origin_ref_id == ticket.id
    assert "Kaydet butonundan" in item.description
    assert item.project.customer_id == customer.id
    assert item.due_date == date(2026, 12, 31) and item.priority == "high"
    assert item.reporter_user_id == ticket_world["agent_a"]

    # Listeleme ucu ve detay ayni kumeyi verir.
    listed = client.get(f"{HUB}/{ticket.id}/work-items").json()
    assert [w["id"] for w in listed] == [ref["id"]]
    assert client.get(f"{HUB}/{ticket.id}").json()["work_items"][0]["id"] == ref["id"]

    # Ticket olay kumesine yeni olay EKLENMEDI (sozlesme donmus).
    audit = client.get(f"{HUB}/{ticket.id}/audit").json()
    assert all("work_item" not in e["event_type"] for e in audit)


def test_out_of_scope_ticket_is_404_and_task_access_is_required(api, ticket_world):
    ticket = _seed_ticket(ticket_world)
    _, project = _seed_project(ticket_world)
    grants = ticket_world["grants"]
    # agent_b DevOps kuyrugunu goremez → 404 (varligi sizmaz).
    grants[str(ticket_world["agent_b"])] = grants[str(ticket_world["agent_b"])] + ["tasks.access"]
    res = api(ticket_world["agent_b"]).post(f"{HUB}/{ticket.id}/work-items", json={"project_id": str(project.id)})
    assert res.status_code == 404
    # agent_a is modulune erisimsiz → 403 (ticket gorunur ama is acilamaz).
    res = api(ticket_world["agent_a"]).post(f"{HUB}/{ticket.id}/work-items", json={"project_id": str(project.id)})
    assert res.status_code == 403
    # Baska tenant'tan hub ucu yok → 404.
    res = api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{HUB}/{ticket.id}/work-items", json={"project_id": str(project.id)}
    )
    assert res.status_code == 404


def test_unknown_project_is_404_and_explicit_fields_win(api, ticket_world):
    ticket = _seed_ticket(ticket_world)
    _, project = _seed_project(ticket_world)
    grants = ticket_world["grants"]
    grants[str(ticket_world["agent_a"])] = grants[str(ticket_world["agent_a"])] + ["tasks.access"]
    client = api(ticket_world["agent_a"])
    assert client.post(f"{HUB}/{ticket.id}/work-items", json={"project_id": str(uuid.uuid4())}).status_code == 404
    # issue turu ayri izin scope'u ister (issues.access) → 403; task acilir.
    res = client.post(f"{HUB}/{ticket.id}/work-items", json={"project_id": str(project.id), "task_type": "issue"})
    assert res.status_code == 403
    res = client.post(f"{HUB}/{ticket.id}/work-items", json={
        "project_id": str(project.id), "title": "Ozel baslik", "description": "Ozel aciklama",
        "task_type": "task",
    })
    assert res.status_code == 201, res.text
    ref = res.json()["work_items"][0]
    assert ref["title"] == "Ozel baslik" and ref["item_key"].startswith("TASK-")
    assert _item(ticket_world, ref["id"]).description == "Ozel aciklama"
