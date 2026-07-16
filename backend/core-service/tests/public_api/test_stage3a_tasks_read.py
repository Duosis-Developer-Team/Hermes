# =============================================================================
# HERMES - Stage 3A testleri: public tasks read + TAM erisim matrisi
# =============================================================================
# Gercek Postgres uzerinde: musteriler/projeler/gruplar/tasklar seed edilir,
# farkli binding'li client'lar + GERCEK token'larla public endpoint'ler
# uctan uca cagrilir (auth zinciri dahil).
# =============================================================================

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models.api_client import ApiClient, ApiClientAccess
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import Task
from app.models.task_activity import TaskActivityEvent
from app.models.task_comment import TaskComment
from app.models.user_group import UserGroup, UserGroupMember
from app.services import api_client_service as svc

U1, U2, U3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


@pytest.fixture()
def world(pg_session):
    """Erisim matrisinin dunyasi: 2 musteri, 2 proje, 1 aktif grup,
    5 task (1'i arsivli), yorumlar + aktivite."""
    s = pg_session
    # Task tablosunu da temizle (api_* truncate'i conftest'te).
    from sqlalchemy import text as sa_text

    s.execute(
        sa_text(
            "TRUNCATE task_comments, task_activity_events, tasks, "
            "user_group_members, user_groups, projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    c2 = Customer(id=uuid.uuid4(), name="Acme", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True)
    p2 = Project(id=uuid.uuid4(), customer_id=c2.id, name="Mon", is_active=True)
    s.add_all([c1, c2, p1, p2])

    g1 = UserGroup(id=uuid.uuid4(), name="Tech Team", is_active=True)
    s.add(g1)
    s.add_all(
        [
            UserGroupMember(
                id=uuid.uuid4(), group_id=g1.id, user_id=U1, is_active=True
            ),
            # Inaktif uye — grubun gorusune DAHIL DEGIL.
            UserGroupMember(
                id=uuid.uuid4(), group_id=g1.id, user_id=U3, is_active=False
            ),
        ]
    )

    def task(n, tn, ttype, assignee, assigner, cust, proj, **kw):
        base = dict(
            id=uuid.uuid4(),
            task_number=n,
            type_number=tn,
            task_type=ttype,
            title=f"{ttype}-{tn}",
            description="d",
            customer_id=cust.id,
            project_id=proj.id,
            assignee_user_id=assignee,
            assigner_user_id=assigner,
            scheduled_date=date(2026, 7, 1),
            status="pending",
            priority="medium",
        )
        base.update(kw)
        return Task(**base)

    t1 = task(101, 101, "task", U1, U2, c1, p1, priority="high",
              due_date=date(2026, 8, 1))
    t2 = task(102, 5, "issue", U2, U3, c1, p1, status="in_progress")
    t3 = task(103, 102, "task", U3, U3, c2, p2, status="completed",
              priority="low", due_date=date(2026, 7, 20),
              completed_at=datetime.now(timezone.utc),
              completed_by_user_id=U3)
    t4 = task(104, 2, "suggestion", U2, U1, c2, p2, priority="urgent")
    t5 = task(105, 103, "task", U1, U2, c1, p1,
              archived_at=datetime.now(timezone.utc))  # asla gorunmez
    s.add_all([t1, t2, t3, t4, t5])
    s.flush()

    s.add_all(
        [
            TaskComment(
                id=uuid.uuid4(), task_id=t1.id, author_user_id=U2,
                body="visible comment",
            ),
            TaskComment(
                id=uuid.uuid4(), task_id=t1.id, author_user_id=U2,
                body="DELETED SECRET BODY",
                deleted_at=datetime.now(timezone.utc),
            ),
        ]
    )
    s.add_all(
        [
            TaskActivityEvent(
                task_id=t1.id, actor_user_id=U2, event_type="task_created",
                event_data={"title": "x"},
            ),
            TaskActivityEvent(
                task_id=t1.id, actor_user_id=U2, event_type="task_updated",
                event_data={
                    "changes": {
                        "priority": {"from": "low", "to": "high"},
                        # whitelist DISI alan — disari sizmamali:
                        "assignment_batch_id": {"from": None, "to": "xyz"},
                    }
                },
            ),
            TaskActivityEvent(
                task_id=t1.id, actor_user_id=U1,
                event_type="task_status_changed",
                event_data={"from": "pending", "to": "in_progress",
                            "internal_note": "SECRET"},
            ),
        ]
    )
    s.commit()
    return {"c1": c1, "c2": c2, "p1": p1, "p2": p2, "g1": g1}


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


def make_api_client(s, name, bindings, *, client_type="service",
                    bound_user_id=None, scopes=None):
    client = ApiClient(
        name=name,
        client_type=client_type,
        bound_user_id=bound_user_id,
        environment="dev",
        scopes=scopes if scopes is not None else ["tasks:read"],
        status="active",
        created_by=uuid.uuid4(),
    )
    s.add(client)
    s.flush()
    for b_type, target in bindings:
        s.add(
            ApiClientAccess(
                client_id=client.id, access_type=b_type, target_id=target
            )
        )
    plaintext, _row = svc.create_token(
        s, client, expires_at=None, created_by=uuid.uuid4()
    )
    return {"Authorization": f"Bearer {plaintext}"}


def codes(resp):
    return sorted(t["task_code"] for t in resp.json()["data"])


LIST = "/api/public/v1/tasks"


# ── Erisim matrisi ──────────────────────────────────────────────────────


def test_global_sees_all_unarchived(world, public_http, pg_session):
    h = make_api_client(pg_session, "g", [("global", None)])
    r = public_http.get(LIST, headers=h)
    assert r.status_code == 200
    assert codes(r) == ["ISSUE-5", "SUGGESTION-2", "TASK-101", "TASK-102"]


def test_user_binding_sees_assignee_and_assigner_rows(
    world, public_http, pg_session
):
    h = make_api_client(pg_session, "u", [("user", U1)])
    r = public_http.get(LIST, headers=h)
    # U1: T1 assignee, T4 assigner. Arsivli T5 assignee olsa da gorunmez.
    assert codes(r) == ["SUGGESTION-2", "TASK-101"]


def test_group_binding_uses_active_members_only(
    world, public_http, pg_session
):
    h = make_api_client(pg_session, "grp", [("group", world["g1"].id)])
    r = public_http.get(LIST, headers=h)
    # Aktif uye yalniz U1 → T1 + T4; U3 inaktif uye → T3 GORUNMEZ.
    assert codes(r) == ["SUGGESTION-2", "TASK-101"]


def test_customer_binding(world, public_http, pg_session):
    h = make_api_client(pg_session, "cust", [("customer", world["c1"].id)])
    assert codes(public_http.get(LIST, headers=h)) == ["ISSUE-5", "TASK-101"]


def test_project_binding(world, public_http, pg_session):
    h = make_api_client(pg_session, "proj", [("project", world["p2"].id)])
    assert codes(public_http.get(LIST, headers=h)) == [
        "SUGGESTION-2",
        "TASK-102",
    ]


def test_no_binding_fails_closed(world, public_http, pg_session):
    h = make_api_client(pg_session, "empty", [])
    r = public_http.get(LIST, headers=h)
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_user_bound_client_hard_ceiling(world, public_http, pg_session):
    """User-bound client'a yanlislikla musteri binding'i de verilse,
    gorunurluk BOUND USER tabanindan genisleyemez (union'a ragmen user
    tabani sabit; customer binding'i ek satir getirir — bkz. plan; burada
    kritik olan U2'nin gormedigi seyi görememesi degil, baska kullaniciya
    genisleyememesi)."""
    h = make_api_client(
        pg_session,
        "ub",
        [("user", U2)],
        client_type="user",
        bound_user_id=U2,
    )
    r = public_http.get(LIST, headers=h)
    # U2: T1 assigner degil (U2=T1 assigner! evet) → T1, T2 assignee, T4 assignee
    assert codes(r) == ["ISSUE-5", "SUGGESTION-2", "TASK-101"]


def test_missing_scope_403(world, public_http, pg_session):
    h = make_api_client(pg_session, "noscope", [("global", None)], scopes=[])
    r = public_http.get(LIST, headers=h)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"


# ── Detay: 404 varlik ifsasi yok ────────────────────────────────────────


def test_out_of_scope_detail_indistinguishable_from_missing(
    world, public_http, pg_session
):
    h = make_api_client(pg_session, "p2only", [("project", world["p2"].id)])
    out_of_scope = public_http.get(f"{LIST}/TASK-101", headers=h)
    truly_missing = public_http.get(f"{LIST}/TASK-99999", headers=h)
    assert out_of_scope.status_code == truly_missing.status_code == 404
    a, b = out_of_scope.json(), truly_missing.json()
    assert a["error"]["code"] == b["error"]["code"] == "resource_not_found"
    assert a["error"]["message"] == b["error"]["message"]


def test_detail_shape_and_case_insensitive_code(
    world, public_http, pg_session
):
    h = make_api_client(pg_session, "gd", [("global", None)])
    r = public_http.get(f"{LIST}/task-101", headers=h)  # kucuk harf
    assert r.status_code == 200
    body = r.json()
    assert body["task_code"] == "TASK-101"
    assert body["customer"]["name"] == "Vakko"
    assert body["project"]["name"] == "ATM"
    assert body["priority"] == "high"
    # Internal alanlar public semada YOK.
    for forbidden in ("task_number", "type_number", "assignment_batch_id"):
        assert forbidden not in body


def test_malformed_code_is_404(world, public_http, pg_session):
    h = make_api_client(pg_session, "gm", [("global", None)])
    r = public_http.get(f"{LIST}/DROP-TABLE", headers=h)
    assert r.status_code == 404


# ── Filtre / sort / pagination ──────────────────────────────────────────


def test_filters(world, public_http, pg_session):
    h = make_api_client(pg_session, "gf", [("global", None)])
    assert codes(
        public_http.get(LIST, headers=h, params={"status": "pending"})
    ) == ["SUGGESTION-2", "TASK-101"]
    assert codes(
        public_http.get(LIST, headers=h, params={"task_type": "issue"})
    ) == ["ISSUE-5"]
    assert codes(
        public_http.get(
            LIST, headers=h, params={"customer_id": str(world["c2"].id)}
        )
    ) == ["SUGGESTION-2", "TASK-102"]
    assert codes(
        public_http.get(
            LIST,
            headers=h,
            params={"due_from": "2026-07-25", "due_to": "2026-08-05"},
        )
    ) == ["TASK-101"]
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert (
        public_http.get(
            LIST, headers=h, params={"updated_after": future}
        ).json()["data"]
        == []
    )


def test_sort_and_pagination(world, public_http, pg_session):
    h = make_api_client(pg_session, "gs", [("global", None)])
    r = public_http.get(
        LIST, headers=h, params={"sort": "due_date", "limit": 2}
    )
    body = r.json()
    assert body["pagination"] == {
        "limit": 2,
        "offset": 0,
        "count": 2,
        "has_more": True,
    }
    # due_date asc: TASK-102 (07-20), TASK-101 (08-01), sonra null'lar.
    assert [t["task_code"] for t in body["data"]] == ["TASK-102", "TASK-101"]

    r2 = public_http.get(
        LIST, headers=h, params={"sort": "due_date", "limit": 2, "offset": 2}
    )
    assert r2.json()["pagination"]["has_more"] is False
    assert len(r2.json()["data"]) == 2

    bad = public_http.get(LIST, headers=h, params={"sort": "nonsense"})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "validation_error"


# ── Activity: sanitizasyon ──────────────────────────────────────────────


def test_activity_sanitized(world, public_http, pg_session):
    h = make_api_client(pg_session, "ga", [("global", None)])
    r = public_http.get(f"{LIST}/TASK-101/activity", headers=h)
    assert r.status_code == 200
    text = r.text
    # Ham event_data / internal alanlar / whitelist-disi degisiklikler YOK.
    assert "event_data" not in text
    assert "assignment_batch_id" not in text
    assert "SECRET" not in text
    assert "internal_note" not in text

    events = {e["event_type"]: e for e in r.json()["data"]}
    upd = events["task_updated"]
    assert upd["changed_fields"] == ["priority"]  # whitelist'lenen tek alan
    assert "priority" in upd["summary"]
    st = events["task_status_changed"]
    assert st["status_from"] == "pending" and st["status_to"] == "in_progress"
    assert events["task_created"]["summary"] == "created the task"


def test_activity_outside_scope_404(world, public_http, pg_session):
    h = make_api_client(pg_session, "pa", [("project", world["p2"].id)])
    r = public_http.get(f"{LIST}/TASK-101/activity", headers=h)
    assert r.status_code == 404


# ── Comments ────────────────────────────────────────────────────────────


def test_comments_exclude_deleted(world, public_http, pg_session):
    h = make_api_client(pg_session, "gc", [("global", None)])
    r = public_http.get(f"{LIST}/TASK-101/comments", headers=h)
    assert r.status_code == 200
    bodies = [c["body"] for c in r.json()["data"]]
    assert bodies == ["visible comment"]
    assert "DELETED SECRET BODY" not in r.text
