# =============================================================================
# HERMES — Sirket hesabinin talep akisi (docs/tenant-platform/01, M2)
# =============================================================================
#   Defacto'ya verilen TEK hesap saglayicinin (destek tenant'i) icindedir:
#   hub GORMEZ, portalda saglayicisi kendi tenant'idir; talepleri hub'a
#   "Defacto" musterisi olarak, yoneticinin sectigi ekibe duser. Ekip
#   secilmeden talep acilamaz. Baska musterinin talebini goremez.
#   Hesap bir MUSTERI KAYDINA baglanir (0027): ad/logo musteriden, musteri
#   basina tek sirket hesabi, musteri yeniden adlandirilinca ad izler.
# =============================================================================

import uuid

import pytest
from fastapi.testclient import TestClient

from ..conftest import AUTHZ_PROFILES, TEST_TENANT_ID
from .conftest import OTHER_TENANT_ID
from .test_wave_b import HUB, NEW, PORTAL

COMPANIES = "/api/v1/core/companies"
CONTEXT = "/api/v1/core/tickets/context"


@pytest.fixture()
def defacto(ticket_world):
    from app.models.customer import Customer

    customer = Customer(id=uuid.uuid4(), name="Defacto", is_active=True)
    ticket_world["session"].add(customer)
    ticket_world["session"].flush()
    ticket_world["defacto_customer"] = customer
    account = uuid.uuid4()
    ticket_world["grants"][str(account)] = ["tickets.access", "tickets.create"]
    AUTHZ_PROFILES[str(account)] = {"account_kind": "company", "modules": ["tickets"]}
    ticket_world["grants"][str(ticket_world["admin"])] += ["users.manage"]
    return account


def _company_client(account, pg_session):
    from app.main import app
    from app.routers.ticket_deps import get_support_db
    from shared.auth import CurrentUser, get_current_user

    app.dependency_overrides[get_support_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(account), email="destek@defacto.com.tr", tenant_id=TEST_TENANT_ID, account_kind="company",
    )
    return TestClient(app, raise_server_exceptions=False)


def _setup_support(api, world, account, **extra):
    r = api(world["admin"]).put(f"{COMPANIES}/{account}/support", json={
        "customer_id": str(world["defacto_customer"].id), "group_id": str(world["devops"].id), **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_company_needs_a_support_team_before_opening_requests(api, ticket_world, defacto):
    s = ticket_world["session"]
    company = _company_client(defacto, s)
    ctx = company.get(CONTEXT).json()
    assert ctx["surfaces"] == ["portal"]                       # hub YOK
    assert len(ctx["providers"]) == 1 and ctx["providers"][0]["tenant_id"] == TEST_TENANT_ID
    assert ctx["can_create"] is False
    blocked = company.post(PORTAL, json=NEW)
    assert blocked.status_code == 409

    out = _setup_support(api, ticket_world, defacto)
    assert out == {"account_id": str(defacto), "display_name": "Defacto",
                   "customer_id": str(ticket_world["defacto_customer"].id), "customer_name": "Defacto",
                   "group_id": str(ticket_world["devops"].id), "group_name": "DevOps Team", "configured": True}
    company = _company_client(defacto, s)
    assert company.get(CONTEXT).json()["can_create"] is True


def test_company_requests_reach_the_hub_as_their_own_customer(api, ticket_world, defacto):
    s = ticket_world["session"]
    _setup_support(api, ticket_world, defacto)
    acme = api(ticket_world["customer"], OTHER_TENANT_ID).post(PORTAL, json=NEW).json()
    company = _company_client(defacto, s)
    created = company.post(PORTAL, json={**NEW, "title": "Magaza ekrani acilmiyor"})
    assert created.status_code == 201, created.text
    ticket = created.json()

    mine = company.get(PORTAL).json()["items"]
    assert [t["id"] for t in mine] == [ticket["id"]]            # Acme'nin talebi gorunmez
    assert company.get(f"{PORTAL}/{acme['id']}").status_code == 404
    assert company.get(HUB).status_code == 404                  # hub yok
    assert company.get(f"{HUB}/{ticket['id']}").status_code == 404

    hub = api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()
    assert hub["source_tenant"]["display_name"] == "Defacto"
    assert hub["assigned_group"]["name"] == "DevOps Team"


def test_support_setup_is_for_company_accounts_and_admins_only(api, ticket_world, defacto):
    person = uuid.uuid4()
    ticket_world["grants"][str(person)] = ["tickets.access"]
    r = api(ticket_world["admin"]).put(f"{COMPANIES}/{person}/support", json={
        "customer_id": str(ticket_world["defacto_customer"].id), "group_id": str(ticket_world["devops"].id)})
    assert r.status_code == 404                                  # kisi hesabi musteri yapilamaz
    assert api(ticket_world["agent_a"]).put(f"{COMPANIES}/{defacto}/support", json={
        "customer_id": str(ticket_world["defacto_customer"].id), "group_id": str(ticket_world["devops"].id)}).status_code == 403
    _setup_support(api, ticket_world, defacto)
    listing = api(ticket_world["admin"]).get(f"{COMPANIES}/support").json()
    assert listing["provider"] is True
    assert [(i["display_name"], i["configured"]) for i in listing["items"]] == [("Defacto", True)]
    # Sirket hesabi bu yonetim ucuna giremez.
    assert _company_client(defacto, ticket_world["session"]).get(f"{COMPANIES}/support").status_code == 404


def test_assigned_customers_are_listed_even_without_requests(api, ticket_world, defacto):
    _setup_support(api, ticket_world, defacto)
    url = "/api/v1/core/tickets/helpdesk/my-customers"
    mine = {c["display_name"]: c for c in api(ticket_world["agent_a"]).get(url).json()}
    assert mine["Defacto"]["kind"] == "company" and mine["Defacto"]["open_count"] == 0
    assert mine["Defacto"]["team"]["name"] == "DevOps Team"
    assert mine["Acme"]["kind"] == "workspace" and mine["BTA"]["kind"] == "integration"

    # Baska ekibin ajani bu musterileri GORMEZ (route onun ekibine degil).
    other = [c["display_name"] for c in api(ticket_world["agent_b"]).get(url).json()]
    assert "Defacto" not in other

    company = _company_client(defacto, ticket_world["session"])
    assert company.post(PORTAL, json=NEW).status_code == 201
    mine = {c["display_name"]: c for c in api(ticket_world["agent_a"]).get(url).json()}
    assert (mine["Defacto"]["open_count"], mine["Defacto"]["total_count"]) == (1, 1)
    # Listede musteriye gore suzme (ayni kapsam kurali).
    rows = api(ticket_world["agent_a"]).get(
        HUB, params={"queue": "all", "source_tenant_row_id": mine["Defacto"]["id"]}).json()["items"]
    assert [r["source_tenant"]["display_name"] for r in rows] == ["Defacto"]


def test_company_is_linked_to_one_customer_and_follows_its_name(api, ticket_world, defacto):
    from app.models.customer import Customer
    from app.schemas.customer import CustomerUpdate
    from app.services.customer_service import CustomerService

    s = ticket_world["session"]
    customer = ticket_world["defacto_customer"]
    _setup_support(api, ticket_world, defacto)
    ticket = _company_client(defacto, s).post(PORTAL, json=NEW).json()
    assert ticket["customer_ref"] == "Defacto Ticket-001"
    hub = api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()
    assert hub["source_tenant"]["customer_id"] == str(customer.id)        # logo + is kalemi varsayilani

    # Musteri basina tek sirket hesabi; pasif ya da olmayan musteri secilemez.
    other = uuid.uuid4()
    AUTHZ_PROFILES[str(other)] = {"account_kind": "company", "modules": ["tickets"]}
    taken = api(ticket_world["admin"]).put(f"{COMPANIES}/{other}/support", json={"customer_id": str(customer.id)})
    assert taken.status_code == 409
    gone = api(ticket_world["admin"]).put(f"{COMPANIES}/{other}/support", json={"customer_id": str(uuid.uuid4())})
    assert gone.status_code == 422
    # Ekip secmeden de baglanir (talep acamaz ama ad/logo musteriden gelir).
    acme = Customer(id=uuid.uuid4(), name="Acme Lojistik", is_active=True)
    s.add(acme)
    s.flush()
    linked = api(ticket_world["admin"]).put(f"{COMPANIES}/{other}/support", json={"customer_id": str(acme.id)})
    assert linked.status_code == 200 and linked.json()["configured"] is False
    assert linked.json()["display_name"] == "Acme Lojistik"

    CustomerService(s).update(customer.id, CustomerUpdate(name="DeFacto Retail"))
    s.flush()
    renamed = api(ticket_world["agent_a"]).get(f"{HUB}/{ticket['id']}").json()
    assert renamed["customer_ref"] == "DeFacto Retail Ticket-001"
    assert renamed["source_tenant"]["display_name"] == "DeFacto Retail"
