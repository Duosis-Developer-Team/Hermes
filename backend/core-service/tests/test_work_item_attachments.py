"""
=============================================================================
PM rework P2.3 — F1 is kalemine ek dosya
=============================================================================
Ticket ek altyapisi (oturum → karantina → sniff/allowlist → tarama →
temiz → yetkili stream) ayni; sahiplik `work_item_id`. Kilitler:
  - katilimci yukler, temiz dosya ANINDA baglanir, liste/indirme calisir
  - gorunurlugu olmayan 404; ilgisi olmayan (yalniz proje uyesi) 403
  - allowlist disi icerik `rejected` → BAGLANMAZ, indirilemez (409)
  - is kalemi eki hub/portal serializer'ina GIRMEZ (ticket_id NULL)
  - cikarma sahipligi koparir; ozellik kapaliyken 503
=============================================================================
"""
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from app.config import get_settings
from app.database import get_db
from app.tenant_db import get_tenant_db
from app.main import app
from app.models.customer import Customer
from app.models.project import Project
from app.models.project_membership import ProjectMembership
from app.models.ticketing import TicketAttachment
from app.models.work_item import RoutingRelation
from app.services import ticket_storage

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

REPORTER = uuid.UUID("00000000-0000-4000-8000-00000000c501")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000c502")
MEMBER = uuid.UUID("00000000-0000-4000-8000-00000000c503")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000c504")

BASE = "/api/v1/core/tasks"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture()
def world(pg_session, authz_grants, monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "TICKET_ATTACHMENTS_ENABLED", True)
    monkeypatch.setattr(settings, "TICKET_STORAGE_BACKEND", "local")
    monkeypatch.setattr(settings, "TICKET_STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(settings, "TICKET_SCANNER_MODE", "disabled_dev_only")
    ticket_storage.get_storage(force_reload=True)
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE ticket_attachments, work_item_notifications, work_item_participants, "
        "work_item_code_aliases, work_item_comments, work_item_events, work_items, "
        "routing_relations, project_memberships, tasks, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    s.add_all([c, p])
    s.commit()
    s.add_all([
        ProjectMembership(project_id=p.id, user_id=MEMBER, member_role="viewer", is_active=True),
        RoutingRelation(assigner_user_id=REPORTER, assignee_user_id=WORKER, scope="task"),
    ])
    s.commit()
    authz_grants[str(REPORTER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    for uid in (WORKER, MEMBER, STRANGER):
        authz_grants[str(uid)] = [Perm.TASKS_ACCESS]
    yield {"s": s, "customer": c, "project": p, "settings": settings}
    ticket_storage.get_storage(force_reload=True)


@pytest.fixture()
def http(world, pg_session):
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_tenant_db] = lambda: pg_session

    def _as(user_id):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user_id), email=f"{user_id}@x.com", full_name="U",
            is_admin=False, tenant_id=TEST_TENANT_ID,
        )
        return TestClient(app, raise_server_exceptions=False)

    yield _as
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _create(http, world):
    res = http(REPORTER).post(BASE, json={
        "customer_id": str(world["customer"].id), "project_id": str(world["project"].id),
        "title": "Ekli is", "description": "d", "assignee_user_id": str(WORKER),
        "scheduled_date": date.today().isoformat(), "priority": "medium", "task_type": "task",
    })
    assert res.status_code == 201, res.text
    return res.json()


def _upload(http, uid, item_id, *, data=PNG, name="ekran.png", mime="image/png"):
    ses = http(uid).post(
        f"{BASE}/{item_id}/attachments",
        params={"file_name": name, "size_bytes": len(data), "declared_mime_type": mime},
    )
    assert ses.status_code == 201, ses.text
    up = http(uid).post(
        f"{BASE}/{item_id}/attachments/{ses.json()['id']}/content",
        content=data, headers={"Content-Type": "application/octet-stream"},
    )
    return ses.json(), up


def test_participant_uploads_clean_file_and_it_is_attached(http, world):
    item = _create(http, world)
    ses, up = _upload(http, WORKER, item["id"])
    assert up.status_code == 200, up.text
    assert up.json()["scan_status"] == "clean" and up.json()["mime_type"] == "image/png"
    listed = http(REPORTER).get(f"{BASE}/{item['id']}/attachments").json()
    assert [a["id"] for a in listed] == [ses["id"]]
    # Proje uyesi (viewer) gorur ve indirir.
    dl = http(MEMBER).get(f"{BASE}/{item['id']}/attachments/{ses['id']}/download")
    assert dl.status_code == 200 and dl.content == PNG
    assert dl.headers["content-disposition"].startswith("attachment;")
    assert dl.headers["x-content-type-options"] == "nosniff"
    # Olay akisinda iz var.
    events = [e["event_type"] for e in http(REPORTER).get(f"{BASE}/{item['id']}/activity").json()]
    assert "attachment_added" in events
    # Satir: is kalemine bagli, ticket'a DEGIL, internal DEGIL.
    row = world["s"].get(TicketAttachment, uuid.UUID(ses["id"]))
    assert row.work_item_id == uuid.UUID(item["id"]) and row.ticket_id is None
    assert row.visibility == "public" and row.attached_at is not None


def test_visibility_and_contributor_rules(http, world):
    item = _create(http, world)
    # Goremeyen → 404 (varligi sizmaz).
    assert http(STRANGER).post(
        f"{BASE}/{item['id']}/attachments", params={"file_name": "a.png", "size_bytes": 10},
    ).status_code == 404
    assert http(STRANGER).get(f"{BASE}/{item['id']}/attachments").status_code == 404
    # Yalniz uye (ilgisi yok) → 403 yukleyemez ama listeyi gorur.
    assert http(MEMBER).post(
        f"{BASE}/{item['id']}/attachments", params={"file_name": "a.png", "size_bytes": 10},
    ).status_code == 403
    assert http(MEMBER).get(f"{BASE}/{item['id']}/attachments").status_code == 200


def test_rejected_content_is_never_attached_nor_downloadable(http, world):
    item = _create(http, world)
    ses, up = _upload(http, WORKER, item["id"], data=b"MZ\x90\x00" + b"\x00" * 32, name="x.png")
    assert up.status_code == 200, up.text
    assert up.json()["scan_status"] == "rejected"
    assert http(REPORTER).get(f"{BASE}/{item['id']}/attachments").json() == []
    dl = http(REPORTER).get(f"{BASE}/{item['id']}/attachments/{ses['id']}/download")
    assert dl.status_code == 409


def test_work_item_attachment_never_leaks_into_ticket_surfaces(http, world):
    """Hub/portal serializer'lari ticket_id ile yukler; is kalemi eki
    (ticket_id NULL) o kumeye YAPISAL olarak giremez."""
    from app.services.ticket_serializers import load_attachments
    item = _create(http, world)
    _upload(http, WORKER, item["id"])
    s = world["s"]
    assert s.query(TicketAttachment).filter(TicketAttachment.work_item_id.isnot(None)).count() == 1
    assert load_attachments(s, uuid.uuid4(), include_internal=True) == []
    assert s.query(TicketAttachment).filter(TicketAttachment.ticket_id.isnot(None)).count() == 0


def test_detach_breaks_ownership_and_stops_download(http, world):
    item = _create(http, world)
    ses, _ = _upload(http, WORKER, item["id"])
    res = http(WORKER).delete(f"{BASE}/{item['id']}/attachments/{ses['id']}")
    assert res.status_code == 200 and res.json() == []
    assert http(WORKER).get(f"{BASE}/{item['id']}/attachments/{ses['id']}/download").status_code == 404
    row = world["s"].get(TicketAttachment, uuid.UUID(ses["id"]))
    assert row.work_item_id is None and row.attached_at is None and row.expires_at is not None


def test_feature_disabled_is_503_and_max_files_enforced(http, world, monkeypatch):
    item = _create(http, world)
    monkeypatch.setattr(world["settings"], "TICKET_ATTACHMENT_MAX_FILES", 1)
    _upload(http, WORKER, item["id"])
    ses, up = _upload(http, WORKER, item["id"], name="ikinci.png")
    assert up.status_code == 400 and "Too many" in up.json()["detail"]
    monkeypatch.setattr(world["settings"], "TICKET_ATTACHMENTS_ENABLED", False)
    res = http(WORKER).post(
        f"{BASE}/{item['id']}/attachments", params={"file_name": "a.png", "size_bytes": 10},
    )
    assert res.status_code == 503
