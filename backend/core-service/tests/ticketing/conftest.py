# =============================================================================
# HERMES — Ticket Hub test dunyasi
# =============================================================================
# Gercek Postgres uzerinde, gercek sema ile calisir (conftest'teki
# `pg_session`). Uc yuzeyin de ayni veriye baktigi, farkli kapilardan
# gectigi bir dunya kurar:
#
#   hub_client         → Duosis support tenant'inda agent/admin
#   portal_client      → baska bir Hermes tenant'inda musteri
#   integration_client → `hsi_` service token'i ile LogiSlot
#
# Support tenant'i testte `TEST_TENANT_ID`dir: boylece `pg_session`in
# damgaladigi satirlarla canonical kayitlar ayni tenant'ta yasar.
# =============================================================================

import uuid

import pytest
from fastapi.testclient import TestClient

from ..conftest import TEST_TENANT_ID

OTHER_TENANT_ID = "00000000-0000-0000-0000-0000000000b2"
THIRD_TENANT_ID = "00000000-0000-0000-0000-0000000000c3"


@pytest.fixture()
def support_settings(monkeypatch):
    """Support tenant'i test tenant'ina sabitler ve modulu ACIK sayar."""
    from app.config import get_settings
    from app.services import support_tenant

    settings = get_settings()
    monkeypatch.setattr(settings, "SUPPORT_TICKETS_ENABLED", True)
    monkeypatch.setattr(
        settings, "HERMES_SUPPORT_TENANT_ID", TEST_TENANT_ID
    )
    monkeypatch.setattr(settings, "PUBLIC_API_ENV", "dev")
    monkeypatch.setattr(settings, "TICKET_ATTACHMENTS_ENABLED", False)
    support_tenant._force_state_for_tests("ok")
    yield settings
    support_tenant._force_state_for_tests("unverified")


@pytest.fixture()
def ticket_world(pg_session, support_settings, authz_grants):
    """Temiz ticket dunyasi: uygulama, kaynak tenant, route, grup."""
    from sqlalchemy import text as sa_text

    from app.models.user_group import UserGroup, UserGroupMember
    from app.services import ticket_routing

    s = pg_session
    s.execute(sa_text(
        "TRUNCATE ticket_delivery_attempts, ticket_outbox_events, "
        "ticket_events, ticket_attachments, ticket_resolutions, "
        "ticket_messages, tickets, ticket_idempotency_records, "
        "support_audit_events, support_integration_tokens, "
        "support_integration_clients, support_ticket_routes, "
        "support_source_tenants, support_applications, "
        "user_group_members, user_groups CASCADE"
    ))
    s.execute(sa_text("DELETE FROM tenant_counters"))
    s.commit()

    devops = UserGroup(id=uuid.uuid4(), name="DevOps Team", is_active=True)
    platform = UserGroup(id=uuid.uuid4(), name="Platform Team",
                         is_active=True)
    s.add_all([devops, platform])
    s.flush()

    agent_a = uuid.uuid4()      # DevOps uyesi
    agent_b = uuid.uuid4()      # Platform uyesi (DevOps'u GOREMEZ)
    admin = uuid.uuid4()        # tickets.admin
    customer = uuid.uuid4()     # portal kullanicisi
    customer_two = uuid.uuid4() # ayni tenant, baska requester

    s.add_all([
        UserGroupMember(group_id=devops.id, user_id=agent_a,
                        is_active=True),
        UserGroupMember(group_id=platform.id, user_id=agent_b,
                        is_active=True),
    ])

    hermes_app = ticket_routing.ensure_application(
        s, code="hermes", display_name="Hermes", environment="dev"
    )
    logislot_app = ticket_routing.ensure_application(
        s, code="logislot", display_name="LogiSlot", environment="dev"
    )
    hermes_src = ticket_routing.ensure_source_tenant(
        s, application=hermes_app, source_tenant_id=OTHER_TENANT_ID,
        display_name="Acme",
    )
    logislot_src = ticket_routing.ensure_source_tenant(
        s, application=logislot_app, source_tenant_id="bta",
        display_name="BTA",
    )
    hermes_route = ticket_routing.set_route(
        s, source_tenant=hermes_src, group=devops,
        actor_type="support_agent", actor_id=str(admin),
    )
    logislot_route = ticket_routing.set_route(
        s, source_tenant=logislot_src, group=devops,
        actor_type="support_agent", actor_id=str(admin),
    )
    s.commit()

    authz_grants[str(agent_a)] = [
        "tickets.access", "tickets.respond", "tickets.resolve",
        "tickets.assign",
    ]
    authz_grants[str(agent_b)] = ["tickets.access", "tickets.respond"]
    authz_grants[str(admin)] = ["tickets.admin", "tickets.config.manage"]
    authz_grants[str(customer)] = ["tickets.access", "tickets.create"]
    authz_grants[str(customer_two)] = ["tickets.access", "tickets.create"]

    return {
        "session": s,
        "devops": devops,
        "platform": platform,
        "agent_a": agent_a,
        "agent_b": agent_b,
        "admin": admin,
        "customer": customer,
        "customer_two": customer_two,
        "hermes_app": hermes_app,
        "logislot_app": logislot_app,
        "hermes_src": hermes_src,
        "logislot_src": logislot_src,
        "hermes_route": hermes_route,
        "logislot_route": logislot_route,
        "grants": authz_grants,
    }


def _current_user(user_id, tenant_id):
    from shared.auth import CurrentUser

    return CurrentUser(
        id=str(user_id), email=f"{user_id}@example.com",
        tenant_id=str(tenant_id),
    )


@pytest.fixture()
def api(ticket_world, pg_session):
    """Internal (tenant-oturumlu) yuzeyler icin istemci fabrikasi.

    `get_support_db` ve `get_current_user` override edilir; RBAC cozumu
    ise GERCEK zincirden (sahte authz upstream) gecer — yani izin
    kararlari testte de auth-service cevabina baglidir.
    """
    from app.main import app
    from app.routers.ticket_deps import get_support_db
    from shared.auth import get_current_user

    def as_user(user_id, tenant_id=TEST_TENANT_ID) -> TestClient:
        app.dependency_overrides[get_support_db] = lambda: pg_session
        app.dependency_overrides[get_current_user] = (
            lambda: _current_user(user_id, tenant_id)
        )
        return TestClient(app)

    yield as_user
    app.dependency_overrides.clear()


@pytest.fixture()
def support_api(ticket_world, pg_session):
    """Integration alt-uygulamasi icin istemci + gercek `hsi_` token'i."""
    from app.main import app
    from app.services import support_integration_service as integration
    from app.support_api.deps import get_support_db as support_db

    sub = next(
        r.app for r in app.routes
        if getattr(r, "path", "") == "/api/integrations"
    )
    sub.dependency_overrides[support_db] = lambda: pg_session

    def make(application, scopes):
        client = integration.create_client(
            pg_session, application=application,
            name=f"client-{uuid.uuid4().hex[:8]}", scopes=scopes,
        )
        token, _row = integration.issue_token(pg_session, client)
        pg_session.commit()
        http = TestClient(app)
        http.headers.update({"Authorization": f"Bearer {token}"})
        return http, client, token

    yield make
    sub.dependency_overrides.clear()
