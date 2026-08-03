# =============================================================================
# HERMES - Stage 3C testleri: user-bound task write'lari + idempotency
# =============================================================================
# GERCEK izin zinciri calisir: bound user'in RBAC izinleri (cutover) +
# hiyerarsi eslesmesi seed edilir; internal kurallar (atama dogrulama,
# durum gecisleri, activity event'leri) public yuzeyden dogrulanir.
# =============================================================================

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models.api_client import ApiIdempotencyKey
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import (
    Task,
    TaskAssignmentRelation,
    TaskUserPermission,
)

from .test_stage3a_tasks_read import make_api_client

BU = uuid.uuid4()  # bound user (assigner)
AS = uuid.uuid4()  # assignee
OUT = uuid.uuid4()  # hiyerarside olmayan kullanici
NOACCESS = uuid.uuid4()  # task erisimi olmayan kullanici

WRITE_SCOPES = [
    "tasks:read",
    "tasks:write",
    "tasks:comment",
    "tasks:complete",
]


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    from sqlalchemy import text as sa_text

    s.execute(
        sa_text(
            "TRUNCATE task_comments, task_activity_events, tasks, "
            "task_assignment_relations, task_user_permissions, "
            "projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True)
    s.add_all([c1, p1])

    # RBAC cutover: izinler rollerden (authz_grants). NOACCESS'e BILEREK
    # legacy access=True satiri birakiyoruz — RBAC grant'i olmadigi icin
    # yine erisimsiz kalmali (legacy tablolar artik karar VEREMEZ).
    s.add_all(
        [
            TaskUserPermission(
                user_id=NOACCESS,
                can_access_tasks=True,
                can_assign_tasks=True,
            ),
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=AS, scope="task"
            ),
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=NOACCESS, scope="task"
            ),
        ]
    )
    s.commit()
    authz_grants[str(BU)] = ["tasks.access", "tasks.assign"]
    authz_grants[str(AS)] = ["tasks.access"]
    # NOACCESS ve OUT: grant YOK.
    return {"c1": c1, "p1": p1}


@pytest.fixture()
def public_http(pg_session):
    from app.main import app

    public_app = next(
        r.app for r in app.routes if getattr(r, "path", "") == "/api/public"
    )
    public_app.dependency_overrides[get_db] = lambda: pg_session
    http = TestClient(app, raise_server_exceptions=False)
    yield http
    public_app.dependency_overrides.pop(get_db, None)


def bound_client(pg_session, user_id, name=None, scopes=None):
    return make_api_client(
        pg_session,
        name or f"ub-{uuid.uuid4().hex[:6]}",
        [("user", user_id)],
        client_type="user",
        bound_user_id=user_id,
        scopes=scopes if scopes is not None else WRITE_SCOPES,
    )


def create_payload(world, **overrides):
    base = {
        "title": "Public API task",
        "description": "created via public api",
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "assignee_user_id": str(AS),
        "scheduled_date": "2026-07-20",
        "priority": "high",
        "task_type": "task",
    }
    base.update(overrides)
    return base


CREATE = "/api/public/v1/tasks"


# ── Client-type ve scope kapilari ───────────────────────────────────────


def test_service_client_with_write_scope_rejected(
    world, public_http, pg_session
):
    """Amendment: service client, write scope'u OLSA BILE yazamaz."""
    h = make_api_client(
        pg_session, "svc-w", [("global", None)], scopes=WRITE_SCOPES
    )
    r = public_http.post(CREATE, headers=h, json=create_payload(world))
    assert r.status_code == 403
    body = r.json()["error"]
    assert body["code"] == "resource_access_denied"
    assert "user-bound" in body["message"]


def test_user_bound_without_scope_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU, scopes=["tasks:read"])
    r = public_http.post(CREATE, headers=h, json=create_payload(world))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"


def test_bound_user_without_hermes_assign_permission_rejected(
    world, public_http, pg_session
):
    """Scope var ama Hermes izni yok → internal kural devrede."""
    h = bound_client(pg_session, AS)  # AS'in can_assign_tasks=False
    r = public_http.post(
        CREATE,
        headers=h,
        json=create_payload(world, assignee_user_id=str(BU)),
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "resource_access_denied"


def test_assignee_outside_hierarchy_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers=h,
        json=create_payload(world, assignee_user_id=str(OUT)),
    )
    assert r.status_code == 403


def test_assignee_without_access_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers=h,
        json=create_payload(world, assignee_user_id=str(NOACCESS)),
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"


def test_invalid_customer_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers=h,
        json=create_payload(world, customer_id=str(uuid.uuid4())),
    )
    assert r.status_code == 404


def test_internal_only_fields_rejected(world, public_http, pg_session):
    """extra=forbid: internal alanlar kabul EDILMEZ."""
    h = bound_client(pg_session, BU)
    payload = create_payload(world)
    payload["task_number"] = 999
    r = public_http.post(CREATE, headers=h, json=payload)
    assert r.status_code == 422


# ── Basarili create + takip eden akislar ────────────────────────────────


def _create_ok(public_http, h, world, **overrides):
    r = public_http.post(
        CREATE, headers=h, json=create_payload(world, **overrides)
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_create_success_shape(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    body = _create_ok(public_http, h, world)
    assert body["task_code"].startswith("TASK-")
    assert body["status"] == "pending"
    assert body["assigner_user_id"] == str(BU)
    assert body["customer"]["name"] == "Vakko"
    for forbidden in ("task_number", "type_number", "assignment_batch_id"):
        assert forbidden not in body
    # Activity event'i internal service tarafindan yazildi.
    r = public_http.get(
        f"{CREATE}/{body['task_code']}/activity", headers=h
    )
    assert r.status_code == 200
    assert r.json()["data"][0]["event_type"] == "task_created"


def test_comment_flow(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    created = _create_ok(public_http, h, world)
    code = created["task_code"]
    r = public_http.post(
        f"{CREATE}/{code}/comments",
        headers=h,
        json={"body": "  public api comment  "},
    )
    assert r.status_code == 201, r.text
    assert r.json()["author_user_id"] == str(BU)
    # Yorum + activity gorunur.
    r = public_http.get(f"{CREATE}/{code}/comments", headers=h)
    assert len(r.json()["data"]) == 1
    r = public_http.get(f"{CREATE}/{code}/activity", headers=h)
    assert "comment_added" in {e["event_type"] for e in r.json()["data"]}


def test_status_lifecycle_accept_complete_reopen_reject(
    world, public_http, pg_session
):
    assigner = bound_client(pg_session, BU, name="assigner-c")
    assignee = bound_client(pg_session, AS, name="assignee-c")
    code = _create_ok(public_http, assigner, world)["task_code"]
    url = f"{CREATE}/{code}"

    # pending → complete atlamasi internal kuralca engelli.
    r = public_http.post(f"{url}/complete", headers=assignee)
    assert r.status_code == 400

    # accept → in_progress (assignee).
    r = public_http.post(
        f"{url}/status", headers=assignee, json={"action": "accept"}
    )
    assert r.status_code == 200 and r.json()["status"] == "in_progress"

    # complete.
    r = public_http.post(f"{url}/complete", headers=assignee)
    assert r.status_code == 200 and r.json()["status"] == "completed"
    assert r.json()["completed_at"] is not None

    # reopen (completed → in_progress).
    r = public_http.post(
        f"{url}/status", headers=assignee, json={"action": "reopen"}
    )
    assert r.status_code == 200 and r.json()["status"] == "in_progress"

    # reject.
    r = public_http.post(
        f"{url}/status", headers=assignee, json={"action": "reject"}
    )
    assert r.status_code == 200 and r.json()["status"] == "rejected"

    # reopen (rejected → pending).
    r = public_http.post(
        f"{url}/status", headers=assignee, json={"action": "reopen"}
    )
    assert r.status_code == 200 and r.json()["status"] == "pending"

    # in_progress degilken reopen → invalid_request.
    r = public_http.post(
        f"{url}/status", headers=assignee, json={"action": "reopen"}
    )
    assert r.status_code == 400


def test_unrelated_user_cannot_change_status(
    world, public_http, pg_session, authz_grants
):
    assigner = bound_client(pg_session, BU, name="a2")
    code = _create_ok(public_http, assigner, world)["task_code"]
    # OUT kullanicisi ERISIMLI ama gorunurluk disinda → 404 (ifsa yok).
    authz_grants[str(OUT)] = ["tasks.access"]
    outsider = bound_client(pg_session, OUT, name="outsider")
    r = public_http.post(
        f"{CREATE}/{code}/status", headers=outsider, json={"action": "accept"}
    )
    assert r.status_code == 404


def test_update_task_and_out_of_scope_404(world, public_http, pg_session):
    assigner = bound_client(pg_session, BU, name="a3")
    code = _create_ok(public_http, assigner, world)["task_code"]
    r = public_http.patch(
        f"{CREATE}/{code}",
        headers=assigner,
        json={"title": "Renamed via API", "priority": "urgent"},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Renamed via API"
    assert r.json()["task_code"] == code  # kod degismez

    # Yasak alan → 422.
    r = public_http.patch(
        f"{CREATE}/{code}", headers=assigner, json={"task_code": "TASK-1"}
    )
    assert r.status_code == 422

    # Olmayan / kapsam disi kod → ayni 404.
    r1 = public_http.patch(
        f"{CREATE}/TASK-99999", headers=assigner, json={"title": "x"}
    )
    assert r1.status_code == 404


# ── Idempotency ─────────────────────────────────────────────────────────


def _count_tasks(pg_session, title):
    return (
        pg_session.query(Task).filter(Task.title == title).count()
    )


def test_idempotent_replay_creates_single_task(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU)
    h_key = {**h, "Idempotency-Key": "create-abc-123"}
    payload = create_payload(world, title="Idem Task")

    r1 = public_http.post(CREATE, headers=h_key, json=payload)
    assert r1.status_code == 201
    assert "idempotency-replayed" not in {
        k.lower() for k in r1.headers.keys()
    }

    r2 = public_http.post(CREATE, headers=h_key, json=payload)
    assert r2.status_code == 201
    assert r2.headers.get("Idempotency-Replayed") == "true"
    assert r2.json() == r1.json()  # ayni yanit govdesi
    assert _count_tasks(pg_session, "Idem Task") == 1  # TEK is kaydi


def test_same_key_different_payload_conflicts(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU)
    h_key = {**h, "Idempotency-Key": "conflict-key-1"}
    assert (
        public_http.post(
            CREATE, headers=h_key, json=create_payload(world, title="A")
        ).status_code
        == 201
    )
    r = public_http.post(
        CREATE, headers=h_key, json=create_payload(world, title="B")
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"


def test_invalid_key_format_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers={**h, "Idempotency-Key": "bad!"},  # kisa + gecersiz karakter
        json=create_payload(world),
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_request"


def test_in_flight_key_conflicts(world, public_http, pg_session):
    """Yarisan istek simulasyonu: rezervasyon satiri (response_status NULL)
    varken ayni anahtar 409 `idempotency_request_in_progress` doner (retry
    guvenli — mesaj bunu acikca soyler) → ayni is kaydi iki kez OLUSAMAZ."""
    h = bound_client(pg_session, BU, name="inflight")
    from app.models.api_client import ApiClient

    client_row = (
        pg_session.query(ApiClient)
        .filter(ApiClient.name == "inflight")
        .first()
    )
    payload = create_payload(world, title="Race Task")
    # Hash'i ENDPOINT ile birebir ayni sekilde hesapla (pydantic dump).
    import json as _json

    from app.public_api.idempotency import canonical_hash
    from app.public_api.schemas.resources import PublicTaskCreate

    normalized = _json.loads(
        PublicTaskCreate(**payload).model_dump_json()
    )
    pg_session.add(
        ApiIdempotencyKey(
            client_id=client_row.id,
            key="race-key-0001",
            request_hash=canonical_hash(
                client_row.id, "POST", "/v1/tasks", normalized
            ),
        )
    )
    pg_session.commit()

    r = public_http.post(
        CREATE,
        headers={**h, "Idempotency-Key": "race-key-0001"},
        json=payload,
    )
    assert r.status_code == 409
    err = r.json()["error"]
    # Onayli 3C follow-up: stabil kod + acikca retry-edilebilir mesaj.
    assert err["code"] == "idempotency_request_in_progress"
    assert "safe to retry" in err["message"]
    assert "replayed" in err["message"]
    assert _count_tasks(pg_session, "Race Task") == 0


def test_failed_business_logic_releases_reservation(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU)
    h_key = {**h, "Idempotency-Key": "retry-after-fail"}
    bad = create_payload(world, assignee_user_id=str(OUT))  # 403 alir
    assert public_http.post(CREATE, headers=h_key, json=bad).status_code == 403
    # Anahtar serbest kaldi → duzeltilmis istek ayni anahtarla calisir.
    good = create_payload(world, title="Retry OK")
    r = public_http.post(CREATE, headers=h_key, json=good)
    assert r.status_code == 201
    assert _count_tasks(pg_session, "Retry OK") == 1


def test_snapshot_contains_no_secrets(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    public_http.post(
        CREATE,
        headers={**h, "Idempotency-Key": "snapshot-check"},
        json=create_payload(world, title="Snap"),
    )
    row = (
        pg_session.query(ApiIdempotencyKey)
        .filter(ApiIdempotencyKey.key == "snapshot-check")
        .first()
    )
    dump = str(row.response_body)
    assert "hms_" not in dump
    assert "Authorization" not in dump
    assert row.response_status == 201


# ── OpenAPI dokumantasyonu ──────────────────────────────────────────────


def test_openapi_documents_write_endpoints(world, public_http, pg_session):
    schema = public_http.get("/api/public/v1/openapi.json").json()
    post_tasks = schema["paths"]["/v1/tasks"]["post"]
    assert post_tasks["security"] == [{"ApiToken": []}]
    assert "tasks:write" in post_tasks["description"]
    param_names = [p["name"] for p in post_tasks.get("parameters", [])]
    assert "Idempotency-Key" in param_names
