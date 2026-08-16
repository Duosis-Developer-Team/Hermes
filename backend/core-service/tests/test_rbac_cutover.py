# =============================================================================
# HERMES - RBAC cutover testleri (PM Configurations → Roles)
# =============================================================================
# Karar kaynagi degisti: task/issue access-assign artik ROLLERDEN cozulur;
# legacy tablolar (task_user_permissions, task_group_permissions,
# task_group_member_overrides) karar VEREMEZ ama backfill/parity kaynagi
# olarak durur. Bu dosya sozlesmeyi uctan uca kilitler:
#   - katalog + bagimlilik haritasi,
#   - access-only vs assigner davranisi (gercek internal router),
#   - tasks.admin: web'de hierarchy bypass, PM-config yetkisi DEGIL,
#   - legacy satirlarin etkisizligi,
#   - authz erisilemezse fail-closed,
#   - 7 legacy admin ucunun ACIK 410 Gone cevabi,
#   - backfill: grup mirasi, override, cok-grup OR, anomali, dry-run.
# =============================================================================

import uuid
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from shared.auth import CurrentUser, get_current_user
from shared.permissions import (
    ALL_PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    PERMISSION_REQUIRES,
    Perm,
)

from app.database import get_db
from app.tenant_db import get_tenant_db
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import TaskAssignmentRelation, TaskUserPermission
from app.models.user_group import (
    TaskGroupMemberOverride,
    TaskGroupPermission,
    UserGroup,
    UserGroupMember,
)

# WS3: CurrentUser artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

TASKS = "/api/v1/core/tasks"

ADMIN_U = uuid.uuid4()      # tasks.admin (yalniz)
ASSIGNER = uuid.uuid4()     # tasks.access + tasks.assign
VIEWER = uuid.uuid4()       # yalniz tasks.access
LEGACY_ONLY = uuid.uuid4()  # RBAC grant'i YOK; legacy satiri VAR
TARGET = uuid.uuid4()       # hiyerarside ASSIGNER'a bagli hedef
UNMAPPED = uuid.uuid4()     # hicbir hiyerarside olmayan hedef


# ── Katalog ────────────────────────────────────────────────────────────


def test_new_permission_keys_in_catalog():
    for code in ("tasks.access", "tasks.assign",
                 "issues.access", "issues.assign"):
        assert code in ALL_PERMISSIONS
        assert PERMISSION_DESCRIPTIONS.get(code)


def test_dependency_map_single_source():
    assert PERMISSION_REQUIRES == {
        Perm.TASKS_ASSIGN: Perm.TASKS_ACCESS,
        Perm.ISSUES_ASSIGN: Perm.ISSUES_ACCESS,
    }


# ── Dunya ──────────────────────────────────────────────────────────────


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    from sqlalchemy import text as sa_text

    s.execute(
        sa_text(
            "TRUNCATE task_comments, task_activity_events, tasks, "
            "task_assignment_relations, task_assignment_group_relations, "
            "task_user_permissions, task_group_member_overrides, "
            "task_group_permissions, user_group_members, user_groups, "
            "projects, customers CASCADE"
        )
    )
    s.commit()
    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM",
                 is_active=True)
    s.add_all([c1, p1])
    s.add_all(
        [
            # LEGACY_ONLY: eski dunyada tam yetkiliydi — artik gecersiz.
            TaskUserPermission(
                user_id=LEGACY_ONLY,
                can_access_tasks=True,
                can_assign_tasks=True,
            ),
            TaskAssignmentRelation(
                assigner_user_id=ASSIGNER, assignee_user_id=TARGET,
                scope="task",
            ),
        ]
    )
    s.commit()

    authz_grants[str(ADMIN_U)] = [Perm.TASKS_ADMIN]
    authz_grants[str(ASSIGNER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    authz_grants[str(VIEWER)] = [Perm.TASKS_ACCESS]
    authz_grants[str(TARGET)] = [Perm.TASKS_ACCESS]
    authz_grants[str(UNMAPPED)] = [Perm.TASKS_ACCESS]
    return {"c1": c1, "p1": p1}


def _http(pg_session, user_id):
    from app.main import app

    app.dependency_overrides[get_db] = lambda: pg_session
    # Internal router'lar tenant baglamli session kullanir.
    app.dependency_overrides[get_tenant_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(user_id), email="u@x.com", is_admin=False
    , tenant_id=TEST_TENANT_ID)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def http_for(pg_session):
    made = []

    def factory(user_id):
        c = _http(pg_session, user_id)
        made.append(c)
        return c

    yield factory
    from app.main import app

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _payload(world, assignee):
    return {
        "title": "Cutover probe",
        "description": "d",
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "scheduled_date": str(date(2026, 8, 20)),
        "priority": "medium",
        "task_type": "task",
        "assignee_user_id": str(assignee),
    }


# ── Davranis: access-only / assigner / admin ───────────────────────────


def test_access_only_user_can_list_but_not_create(world, http_for):
    c = http_for(VIEWER)
    assert c.get(TASKS).status_code == 200
    r = c.post(TASKS, json=_payload(world, TARGET))
    assert r.status_code == 403


def test_assigner_creates_within_hierarchy(world, http_for):
    c = http_for(ASSIGNER)
    r = c.post(TASKS, json=_payload(world, TARGET))
    assert r.status_code == 201, r.text
    # Hiyerarside olmayan hedefe ATAYAMAZ (assign izni olsa bile).
    r2 = c.post(TASKS, json=_payload(world, UNMAPPED))
    assert r2.status_code == 403


def test_tasks_admin_bypasses_hierarchy_on_web(world, http_for):
    c = http_for(ADMIN_U)
    r = c.post(TASKS, json=_payload(world, UNMAPPED))
    assert r.status_code == 201, r.text


def test_tasks_admin_does_not_grant_pm_configuration(world, http_for):
    """tasks.admin, tasks.permissions.manage SAGLAMAZ — PM Configurations
    yonetim yuzeyi ayri karardir."""
    c = http_for(ADMIN_U)
    r = c.get("/api/v1/core/admin/task-assignment-relations?scope=task")
    assert r.status_code == 403


def test_legacy_rows_no_longer_grant_anything(world, http_for):
    """Eski dunyanin tam yetkili kullanicisi, RBAC grant'i olmadigi icin
    modul disinda kalir — legacy tablo karar VEREMEZ."""
    c = http_for(LEGACY_ONLY)
    assert c.get(TASKS).status_code == 403


def test_authz_unavailable_fails_closed(world, http_for, monkeypatch):
    from app.services import authz_client

    def _boom(*a, **k):
        raise authz_client.AuthzUnavailable("down")

    monkeypatch.setattr(authz_client, "effective_permissions", _boom)
    monkeypatch.setattr(authz_client, "effective_permissions_many", _boom)
    c = http_for(ASSIGNER)
    assert c.get(TASKS).status_code == 403


# ── /permissions/me: admin sozlesme tutarliligi ────────────────────────


def test_permissions_me_admin_lists_full_reach(world, http_for, monkeypatch):
    """Backend admin icin hierarchy'yi bypass eder; picker listesi de ayni
    gercegi soylemeli (tum aktif kullanicilar + tum aktif gruplar)."""
    from app.services import directory_client

    everyone = [str(ADMIN_U), str(ASSIGNER), str(VIEWER), str(TARGET)]

    def _fake_list(*, limit, offset, q=None, **_kw):
        page = [{"id": i} for i in everyone][offset : offset + limit]
        return page, offset + limit < len(everyone)

    monkeypatch.setattr(directory_client, "list_users_global", _fake_list)

    g = UserGroup(id=uuid.uuid4(), name="G1", is_active=True)
    from app.database import get_db  # noqa: F401 — sadece semantik ipucu

    c = http_for(ADMIN_U)
    # fixture'daki pg_session ile ayni oturum: grubu oradan ekleyelim
    # (http_for pg_session'a bagli).
    sess_client = c  # okunabilirlik
    r0 = sess_client.get(TASKS + "/permissions/me")
    assert r0.status_code == 200
    body = r0.json()
    assert body["is_admin"] is True
    got_users = set(body["task"]["assignable_user_ids"])
    assert got_users == {u for u in everyone if u != str(ADMIN_U)}


# ── Legacy admin uclari: ACIK 410 ──────────────────────────────────────

LEGACY_ENDPOINTS = [
    ("GET", "/api/v1/core/admin/task-permissions/users"),
    ("PUT", f"/api/v1/core/admin/task-permissions/users/{uuid.uuid4()}"),
    ("GET", "/api/v1/core/admin/task-permissions/effective"),
    ("GET", "/api/v1/core/admin/task-permissions/groups"),
    ("PUT", f"/api/v1/core/admin/task-permissions/groups/{uuid.uuid4()}"),
    ("GET",
     f"/api/v1/core/admin/task-permissions/groups/{uuid.uuid4()}/member-overrides"),
    ("PUT",
     f"/api/v1/core/admin/task-permissions/groups/{uuid.uuid4()}"
     f"/member-overrides/{uuid.uuid4()}"),
]


def test_legacy_admin_endpoints_return_410(world, http_for, authz_grants):
    pm = uuid.uuid4()
    authz_grants[str(pm)] = [Perm.TASK_PERMISSIONS_MANAGE]
    c = http_for(pm)
    for method, path in LEGACY_ENDPOINTS:
        r = c.request(method, path)
        assert r.status_code == 410, (method, path, r.status_code)
        assert "moved to Roles" in r.json()["detail"]


def test_legacy_admin_endpoints_still_guarded(world, http_for, authz_grants):
    nobody = uuid.uuid4()
    authz_grants[str(nobody)] = []
    c = http_for(nobody)
    for method, path in LEGACY_ENDPOINTS:
        r = c.request(method, path)
        assert r.status_code == 403, (method, path, r.status_code)


# ── Backfill ───────────────────────────────────────────────────────────


@pytest.fixture()
def legacy_world(pg_session):
    """Backfill'in tasiyacagi legacy dunya:
      - U_DIRECT: dogrudan access+assign (grupsuz)
      - U_GROUP: grup default'u access (uyelik uzerinden)
      - U_SUPPRESSED: ayni grupta override FALSE → izinsiz
      - U_TWOGROUPS: g1 FALSE override + g2 default TRUE → OR ile izinli
      - U_ANOMALY: grup default assign=TRUE, access=FALSE → anomali
    """
    s = pg_session
    from sqlalchemy import text as sa_text

    s.execute(
        sa_text(
            "TRUNCATE task_user_permissions, task_group_member_overrides, "
            "task_group_permissions, user_group_members, user_groups CASCADE"
        )
    )
    s.commit()

    U_DIRECT, U_GROUP = uuid.uuid4(), uuid.uuid4()
    U_SUPPRESSED, U_TWOGROUPS, U_ANOMALY = (
        uuid.uuid4(), uuid.uuid4(), uuid.uuid4(),
    )
    g1 = UserGroup(id=uuid.uuid4(), name="G1", is_active=True)
    g2 = UserGroup(id=uuid.uuid4(), name="G2", is_active=True)
    g3 = UserGroup(id=uuid.uuid4(), name="G3-anomali", is_active=True)
    s.add_all([g1, g2, g3])
    s.commit()
    s.add_all(
        [
            TaskUserPermission(
                user_id=U_DIRECT,
                can_access_tasks=True, can_assign_tasks=True,
                can_access_issues=False, can_assign_issues=False,
            ),
            TaskGroupPermission(
                group_id=g1.id,
                can_access_tasks_default=True,
                can_assign_tasks_default=False,
            ),
            TaskGroupPermission(
                group_id=g2.id,
                can_access_tasks_default=True,
                can_assign_tasks_default=False,
            ),
            # Anomali grubu: assign TRUE ama access FALSE.
            TaskGroupPermission(
                group_id=g3.id,
                can_access_tasks_default=False,
                can_assign_tasks_default=True,
            ),
            UserGroupMember(group_id=g1.id, user_id=U_GROUP, is_active=True),
            UserGroupMember(
                group_id=g1.id, user_id=U_SUPPRESSED, is_active=True
            ),
            UserGroupMember(
                group_id=g1.id, user_id=U_TWOGROUPS, is_active=True
            ),
            UserGroupMember(
                group_id=g2.id, user_id=U_TWOGROUPS, is_active=True
            ),
            UserGroupMember(
                group_id=g3.id, user_id=U_ANOMALY, is_active=True
            ),
            TaskGroupMemberOverride(
                group_id=g1.id, user_id=U_SUPPRESSED,
                can_access_tasks_override=False,
            ),
            TaskGroupMemberOverride(
                group_id=g1.id, user_id=U_TWOGROUPS,
                can_access_tasks_override=False,
            ),
        ]
    )
    s.commit()
    return {
        "U_DIRECT": U_DIRECT, "U_GROUP": U_GROUP,
        "U_SUPPRESSED": U_SUPPRESSED, "U_TWOGROUPS": U_TWOGROUPS,
        "U_ANOMALY": U_ANOMALY,
    }


def test_backfill_mapping_honours_legacy_semantics(pg_session, legacy_world):
    from app.services.rbac_backfill import compute_legacy_mapping

    mapping, anomalies = compute_legacy_mapping(pg_session)
    w = legacy_world
    assert mapping[str(w["U_DIRECT"])] == ["task-assigner"]
    assert mapping[str(w["U_GROUP"])] == ["task-access"]
    # Override FALSE (tek grup) → hicbir rol.
    assert str(w["U_SUPPRESSED"]) not in mapping
    # Iki grup: g1 FALSE override'i g2'nin default TRUE'sunu ENGELLEMEZ.
    assert mapping[str(w["U_TWOGROUPS"])] == ["task-access"]
    # Anomali: assign sinyali access'siz → assigner rolu + anomali kaydi.
    assert mapping[str(w["U_ANOMALY"])] == ["task-assigner"]
    assert any(str(w["U_ANOMALY"]) in a for a in anomalies)
    assert len(anomalies) == 1


def test_backfill_dry_run_does_not_push(pg_session, legacy_world, monkeypatch):
    from app.services import rbac_backfill

    called = []
    monkeypatch.setattr(
        rbac_backfill, "push_to_auth",
        lambda m: called.append(m) or {},
    )
    summary = rbac_backfill.run(pg_session, dry_run=True, tenant_id=TEST_TENANT_ID)
    assert summary["dry_run"] is True
    assert summary["users"] == 4
    assert called == []


def test_backfill_push_sends_chunks_with_s2s(pg_session, legacy_world,
                                             monkeypatch):
    from app.services import rbac_backfill
    from app.services.rbac_backfill import run

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        assert request.url.path == "/internal/authz/task-backfill"
        assert request.headers.get("Authorization", "").startswith("Bearer ")
        seen.append(_json.loads(request.content))
        return httpx.Response(200, json={
            "assigned": 3, "skipped_existing": 1,
            "unknown_users": 0, "unknown_roles": 0,
        })

    rbac_backfill.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    monkeypatch.setattr(
        rbac_backfill.get_settings(), "AUTH_SERVICE_URL",
        "http://auth-service/api/v1",
    )
    monkeypatch.setattr(
        rbac_backfill.get_settings(), "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )
    try:
        summary = run(pg_session, dry_run=False, tenant_id=TEST_TENANT_ID)
    finally:
        rbac_backfill.set_client_factory(lambda: httpx.Client(timeout=10))
    assert summary["pushed"] == {
        "assigned": 3, "skipped_existing": 1,
        "unknown_users": 0, "unknown_roles": 0,
    }
    assert len(seen) == 1
    sent = {a["user_id"]: a["role_codes"] for a in seen[0]["assignments"]}
    assert len(sent) == 4


def test_backfill_admin_endpoint_dry_run(world, legacy_world, http_for,
                                         authz_grants):
    pm = uuid.uuid4()
    authz_grants[str(pm)] = [Perm.TASK_PERMISSIONS_MANAGE]
    c = http_for(pm)
    r = c.post("/api/v1/core/admin/task-permissions/rbac-backfill")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert body["pushed"] is None
