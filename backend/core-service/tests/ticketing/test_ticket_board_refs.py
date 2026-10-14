# =============================================================================
# HERMES — Talep kanbani, musteriye gore numara, talebe bagli efor, sirket logosu
# =============================================================================
#   - "Defacto Ticket-001": numara MUSTERI BASINA ayri sirayla; kanonik
#     TKT-000123 aynen kalir. "Ticket-002" aramasi musteri sirasini bulur.
#   - Kanban sutunu "top kimde": yeni → pending; ajan yaniti → in_progress
#     (durum da otomatik "Islemde"); musteri yaniti → yine pending;
#     cozum → completed. Pano iptali gostermez.
#   - Talep cozulunce girilen efor talebe baglanir; detay toplam saati verir.
#   - Sirket hesabi logosu musteri logosuyla ayni kurallarla.
# =============================================================================

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text as sa_text

from ..conftest import AUTHZ_PROFILES
from .conftest import OTHER_TENANT_ID
from .test_wave_b import HUB, NEW, PORTAL

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _open(api, world, **extra):
    return api(world["customer"], OTHER_TENANT_ID).post(PORTAL, json={**NEW, **extra}).json()


def _hub(api, world, ticket_id):
    return api(world["agent_a"]).get(f"{HUB}/{ticket_id}").json()


def test_numbers_are_per_customer(api, ticket_world):
    s = ticket_world["session"]
    first, second = _open(api, ticket_world), _open(api, ticket_world, title="Ikinci")
    assert (first["customer_ref"], second["customer_ref"]) == ("Acme Ticket-001", "Acme Ticket-002")
    assert first["ticket_number"].startswith("TKT-")                 # kanonik numara aynen

    # Baska musteri kendi sirasina 1'den baslar.
    from app.services import ticket_service
    from app.services.ticket_service import Actor, TicketCreateInput

    other = ticket_service.create_ticket(
        s, application=ticket_world["logislot_app"], source_tenant=ticket_world["logislot_src"],
        group=ticket_world["devops"], route_version=1,
        data=TicketCreateInput(source_ticket_id="ls-1", requester_source_user_id="u1", title="LS",
                               description="d", category="bug", impact="single_user"),
        actor=Actor(type="integration_client", role="requester", id="ls"),
    )
    s.flush()
    assert other.customer_seq == 1
    row = _hub(api, ticket_world, str(other.id))
    assert row["customer_ref"] == "BTA Ticket-001"

    found = api(ticket_world["agent_a"]).get(HUB, params={"queue": "all", "search": "Ticket-002"}).json()["items"]
    assert second["id"] in [t["id"] for t in found]


def test_board_columns_follow_whose_turn_it_is(api, ticket_world):
    agent = api(ticket_world["agent_a"])
    ticket = _open(api, ticket_world)
    def column():
        r = api(ticket_world["agent_a"]).get(HUB, params={"queue": "all", "board": "true"})
        assert r.status_code == 200, r.text
        return {t["id"]: t["board_column"] for t in r.json()["items"]}[ticket["id"]]
    assert column() == "pending"

    agent.post(f"{HUB}/{ticket['id']}/messages", json={"body": "Bakiyoruz.", "visibility": "public"})
    detail = _hub(api, ticket_world, ticket["id"])
    assert detail["status"] == "in_progress" and detail["board_column"] == "in_progress"

    api(ticket_world["customer"], OTHER_TENANT_ID).post(f"{PORTAL}/{ticket['id']}/messages", json={"body": "Hala oluyor"})
    assert column() == "pending"                                      # top yine bizde

    # Yanit + "Islemde" ayni komutta: durum zaten Islemde → hata yok.
    version = _hub(api, ticket_world, ticket["id"])["version"]
    ok = api(ticket_world["agent_a"]).post(f"{HUB}/{ticket['id']}/transition", json={
        "to_status": "in_progress", "expected_version": version, "public_message": "Duzeltiyoruz."})
    assert ok.status_code == 200, ok.text
    assert column() == "in_progress"

    version = _hub(api, ticket_world, ticket["id"])["version"]
    api(ticket_world["agent_a"]).post(f"{HUB}/{ticket['id']}/resolve", json={
        "resolution_code": "fixed", "public_summary": "Duzeldi", "expected_version": version})
    assert column() == "completed"

    cancelled = _open(api, ticket_world, title="Vazgectim")
    gone = api(ticket_world["customer"], OTHER_TENANT_ID).post(
        f"{PORTAL}/{cancelled['id']}/cancel", json={"reason": "Artik gerek yok", "expected_version": cancelled["version"]})
    assert gone.status_code == 200, gone.text
    board_ids = [t["id"] for t in api(ticket_world["agent_a"]).get(
        HUB, params={"queue": "all", "board": "true"}).json()["items"]]
    assert cancelled["id"] not in board_ids


def test_work_logged_on_a_ticket_is_linked_and_summed(api, ticket_world):
    from app.models.customer import Customer
    from app.models.project import Project
    from app.models.work_type import WorkType
    from app.schemas.work_log import WorkLogCreate
    from app.services.work_log_service import WorkLogService

    s = ticket_world["session"]
    ticket = _open(api, ticket_world)
    c = Customer(id=uuid.uuid4(), name=f"Defacto {uuid.uuid4().hex[:5]}", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="Destek", is_active=True)
    wt = WorkType(id=uuid.uuid4(), name=f"Destek {uuid.uuid4().hex[:5]}", is_active=True)
    s.add_all([c, p, wt])
    s.flush()
    svc = WorkLogService(s)
    base = dict(customer_id=c.id, project_id=p.id, work_type_id=wt.id, date_worked=date.today())
    linked = svc.create(WorkLogCreate(**base, duration_hours=Decimal("1.5"),
                                      description="Acme Ticket-001\nKaydetme hatasi",
                                      ticket_id=uuid.UUID(ticket["id"])), ticket_world["agent_a"])
    assert linked.ticket_id == uuid.UUID(ticket["id"])
    svc.create(WorkLogCreate(**base, duration_hours=Decimal("0.5"), description="ek",
                             ticket_id=uuid.UUID(ticket["id"])), ticket_world["agent_a"])
    stray = svc.create(WorkLogCreate(**base, duration_hours=Decimal("1"), description="yok",
                                     ticket_id=uuid.uuid4()), ticket_world["agent_a"])
    assert stray.ticket_id is None                                    # var olmayan talep → bag duser
    detail = _hub(api, ticket_world, ticket["id"])
    assert (detail["logged_hours"], detail["log_count"]) == (2.0, 2)


@pytest.fixture()
def company(ticket_world):
    account = uuid.uuid4()
    AUTHZ_PROFILES[str(account)] = {"account_kind": "company", "modules": ["tickets"]}
    ticket_world["grants"][str(ticket_world["admin"])] += ["users.manage"]
    return account


def test_company_logo_follows_logo_rules(api, ticket_world, company):
    from app.main import app
    from app.tenant_db import get_tenant_db

    s = ticket_world["session"]
    s.execute(sa_text("DELETE FROM company_logos"))
    admin = api(ticket_world["admin"])
    app.dependency_overrides[get_tenant_db] = lambda: s
    url = f"/api/v1/core/companies/{company}/logo"
    put = admin.put(url, files={"file": ("defacto.png", PNG, "image/png")})
    assert put.status_code == 200 and put.json()["has_logo"] is True
    etag = put.json()["logo_etag"]
    assert admin.get("/api/v1/core/companies/logos").json()["logos"] == {str(company): etag}
    got = admin.get(url)
    assert got.status_code == 200 and got.content == PNG
    assert admin.get(url, headers={"If-None-Match": f'"{etag}"'}).status_code == 304

    svg = admin.put(url, files={"file": ("x.svg", b"<svg/>", "image/svg+xml")})
    assert svg.status_code == 415
    person = uuid.uuid4()
    assert admin.put(f"/api/v1/core/companies/{person}/logo",
                     files={"file": ("a.png", PNG, "image/png")}).status_code == 404
    assert api(ticket_world["agent_a"]).put(url, files={"file": ("a.png", PNG, "image/png")}).status_code == 403
    admin = api(ticket_world["admin"])
    assert admin.delete(url).status_code == 204
    assert admin.get(url).status_code == 404
    app.dependency_overrides.pop(get_tenant_db, None)
