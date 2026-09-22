"""
=============================================================================
Kapasite (PM rework P0 / D1+D2) — efor seridi kurallari ve yetki sinirlari
=============================================================================
Kilitlenen sozlesmeler (04-roller §4.1, §7, §8):
  1. BUGUN hicbir zaman eksik degildir; gelecek gun uyari uretmez.
  2. Calisma gunu olmayan, tatil ve izin gunleri 'off' — beklenen 0.
  3. Gecmis calisma gunu + 0 saat = 'missing'; beklenenin alti 'partial'
     (uyari degil); beklenen ve ustu 'complete'.
  4. Kiraci ayari yoksa varsayilan 8 saat / Pzt-Cum (tek kapida).
  5. Kullanici override'i yalniz DOLU alanlari ezer.
  6. Baskasinin haftasi/izni icin worklogs.admin; ayarlar icin users.manage.
=============================================================================
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from shared.auth import CurrentUser, get_current_user
from shared.exceptions import ConflictError, ValidationError
from shared.permissions import Perm
from app.database import get_db
from app.main import app
from app.models.customer import Customer
from app.models.project import Project
from app.models.work_log import WorkLog
from app.models.work_type import WorkType
from app.services import capacity_service as cap
from app.tenant_db import get_tenant_db

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
ADMIN = uuid.UUID("00000000-0000-4000-8000-00000000ca01")
ME = uuid.UUID("00000000-0000-4000-8000-00000000ca02")
OTHER = uuid.UUID("00000000-0000-4000-8000-00000000ca03")

MON = date(2026, 9, 14)          # Pazartesi
NEXT_MON = MON + timedelta(days=7)
H8 = Decimal("8")


# =============================================================================
# 1) SAF hesap — veritabani yok
# =============================================================================

def _week(**over):
    params = dict(week_start=MON, today=NEXT_MON, daily_hours=H8,
                  working_days=(1, 2, 3, 4, 5))
    params.update(over)
    return cap.build_week(**params)


def _day(week, offset):
    return week["days"][offset]


def test_today_is_never_missing_and_future_is_future():
    week = _week(today=MON + timedelta(days=2))     # Carsamba
    assert _day(week, 0)["status"] == "missing"     # Pzt gecmis, 0 saat
    assert _day(week, 1)["status"] == "missing"
    assert _day(week, 2)["status"] == "today"       # bugun: asla eksik
    assert _day(week, 3)["status"] == "future"
    assert week["missing_days"] == [MON, MON + timedelta(days=1)]


def test_weekend_is_off_with_zero_expected():
    week = _week()
    for offset in (5, 6):
        d = _day(week, offset)
        assert d["status"] == "off"
        assert d["is_working_day"] is False
        assert d["expected_hours"] == 0
    assert week["expected_total"] == 40


def test_holiday_and_absence_are_off_not_missing():
    week = _week(
        holidays={MON + timedelta(days=2): "Cumhuriyet Bayrami"},
        absences=[{"id": uuid.uuid4(), "start_date": MON + timedelta(days=3),
                   "end_date": MON + timedelta(days=4), "absence_type": "leave"}],
    )
    wed, thu, fri = _day(week, 2), _day(week, 3), _day(week, 4)
    assert wed["status"] == "off" and wed["is_holiday"] and wed["holiday_name"] == "Cumhuriyet Bayrami"
    assert thu["status"] == "off" and thu["is_absent"] and thu["absence_type"] == "leave"
    assert fri["status"] == "off" and fri["is_absent"]
    assert week["expected_total"] == 16          # yalniz Pzt + Sal
    assert week["missing_days"] == [MON, MON + timedelta(days=1)]


def test_missing_partial_complete_thresholds():
    week = _week(logged_by_day={
        MON: Decimal("8"),
        MON + timedelta(days=1): Decimal("2.5"),
        MON + timedelta(days=2): Decimal("9"),
    })
    assert _day(week, 0)["status"] == "complete"
    assert _day(week, 1)["status"] == "partial"
    assert _day(week, 2)["status"] == "complete"     # fazlasi da tamam
    assert _day(week, 3)["status"] == "missing"
    assert week["logged_total"] == Decimal("19.5")
    assert week["fill_percent"] == 49                # 19.5 / 40


def test_partial_is_not_a_missing_day():
    week = _week(logged_by_day={MON: Decimal("1")})
    assert MON not in week["missing_days"]


def test_week_start_is_normalized_to_monday():
    week = _week(week_start=MON + timedelta(days=3))
    assert week["week_start"] == MON
    assert week["week_end"] == MON + timedelta(days=6)


def test_fill_percent_is_none_when_nothing_expected():
    week = _week(working_days=(6,), today=MON)   # yalniz Cumartesi, hafta gelecekte
    assert week["expected_total"] == 8
    week2 = _week(working_days=(6,), holidays={MON + timedelta(days=5): "x"})
    assert week2["expected_total"] == 0
    assert week2["fill_percent"] is None


def test_working_days_validation():
    assert cap.normalize_working_days([5, 1, 1, 3]) == [1, 3, 5]
    with pytest.raises(ValidationError):
        cap.normalize_working_days([0, 1])
    with pytest.raises(ValidationError):
        cap.normalize_working_days([])
    with pytest.raises(ValidationError):
        cap.normalize_hours(25)
    with pytest.raises(ValidationError):
        cap.normalize_hours(0)


# =============================================================================
# 2) Veritabani — ayar, override, izin, hafta cozumu
# =============================================================================

@pytest.fixture()
def world(pg_session):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE user_absences, user_capacity_overrides, tenant_holidays, "
        "tenant_capacity_settings, work_logs, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    wt = WorkType(id=uuid.uuid4(), name="Development", is_active=True)
    s.add_all([c, p, wt])
    s.commit()
    return {"s": s, "customer": c, "project": p, "work_type": wt}


def _log(world, *, user_id, day, hours):
    world["s"].add(WorkLog(
        user_id=user_id, customer_id=world["customer"].id,
        project_id=world["project"].id, work_type_id=world["work_type"].id,
        date_worked=day, duration_hours=hours, billable_duration_hours=hours,
        description="is",
    ))
    world["s"].flush()


def test_settings_default_when_no_row(world):
    eff = cap.effective_settings(world["s"])
    assert eff["is_default"] is True
    assert eff["daily_expected_hours"] == H8
    assert eff["working_days"] == [1, 2, 3, 4, 5]


def test_settings_upsert_is_singleton(world):
    s = world["s"]
    cap.upsert_settings(s, daily_expected_hours="7.5", working_days=[1, 2, 3, 4],
                        actor_user_id=ADMIN)
    cap.upsert_settings(s, daily_expected_hours="6", working_days=[2, 3],
                        actor_user_id=ADMIN)
    s.flush()
    assert s.execute(sa_text("SELECT count(*) FROM tenant_capacity_settings")).scalar() == 1
    eff = cap.effective_settings(s)
    assert eff["is_default"] is False
    assert eff["daily_expected_hours"] == Decimal("6.00")
    assert eff["working_days"] == [2, 3]


def test_override_only_overrides_filled_fields(world):
    s = world["s"]
    cap.upsert_settings(s, daily_expected_hours="8", working_days=[1, 2, 3, 4, 5],
                        actor_user_id=ADMIN)
    cap.upsert_override(s, user_id=ME, daily_expected_hours="6", actor_user_id=ADMIN)
    eff = cap.user_capacity(s, ME)
    assert eff["daily_expected_hours"] == Decimal("6.00")
    assert eff["working_days"] == [1, 2, 3, 4, 5]     # kiraci varsayilani kaldi
    assert cap.user_capacity(s, OTHER)["daily_expected_hours"] == H8
    with pytest.raises(ValidationError):
        cap.upsert_override(s, user_id=OTHER, actor_user_id=ADMIN)


def test_resolve_week_combines_logs_holidays_absences(world, monkeypatch):
    s = world["s"]
    _log(world, user_id=ME, day=MON, hours=8)
    _log(world, user_id=ME, day=MON + timedelta(days=1), hours=2)
    _log(world, user_id=OTHER, day=MON + timedelta(days=4), hours=8)   # baskasinin
    cap.add_holiday(s, holiday_date=MON + timedelta(days=2), name="Bayram",
                    actor_user_id=ADMIN)
    cap.create_absence(s, user_id=ME, start_date=MON + timedelta(days=3),
                       end_date=MON + timedelta(days=3), actor_user_id=ME)

    week = cap.resolve_week(s, user_id=ME, week_start=MON + timedelta(days=2),
                            today=NEXT_MON)
    statuses = [d["status"] for d in week["days"]]
    assert statuses == ["complete", "partial", "off", "off", "missing", "off", "off"]
    assert week["missing_days"] == [MON + timedelta(days=4)]
    assert week["expected_total"] == 24
    assert week["logged_total"] == 10
    assert week["user_id"] == ME


def test_absence_overlap_is_a_conflict(world):
    s = world["s"]
    cap.create_absence(s, user_id=ME, start_date=MON, end_date=MON + timedelta(days=2),
                       actor_user_id=ME)
    with pytest.raises(ConflictError):
        cap.create_absence(s, user_id=ME, start_date=MON + timedelta(days=2),
                           end_date=MON + timedelta(days=4), actor_user_id=ME)
    # Baska kullanici ayni gunler: serbest.
    cap.create_absence(s, user_id=OTHER, start_date=MON, end_date=MON, actor_user_id=ADMIN)


def test_duplicate_holiday_is_a_conflict(world):
    s = world["s"]
    cap.add_holiday(s, holiday_date=MON, name="A", actor_user_id=ADMIN)
    with pytest.raises(ConflictError):
        cap.add_holiday(s, holiday_date=MON, name="B", actor_user_id=ADMIN)


# =============================================================================
# 3) HTTP — yetki sinirlari
# =============================================================================

@pytest.fixture()
def http(world, pg_session, authz_grants):
    authz_grants[str(ADMIN)] = [Perm.USERS_MANAGE, Perm.WORKLOGS_ADMIN]
    authz_grants[str(ME)] = []
    authz_grants[str(OTHER)] = []
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_tenant_db] = lambda: pg_session
    client = TestClient(app, raise_server_exceptions=False)

    def as_user(user_id):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user_id), email=f"{user_id}@x.com", full_name="U",
            is_admin=False, tenant_id=TEST_TENANT_ID,
        )
        return client

    yield as_user
    for dep in (get_db, get_tenant_db, get_current_user):
        app.dependency_overrides.pop(dep, None)


BASE = "/api/v1/core/capacity"


def test_settings_require_users_manage(http):
    body = {"daily_expected_hours": 7, "working_days": [1, 2, 3, 4]}
    assert http(ME).put(f"{BASE}/settings", json=body).status_code == 403
    r = http(ADMIN).put(f"{BASE}/settings", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["daily_expected_hours"] == "7.00" or float(r.json()["daily_expected_hours"]) == 7
    assert r.json()["working_days"] == [1, 2, 3, 4]
    assert http(ADMIN).get(f"{BASE}/settings").json()["is_default"] is False


def test_settings_reject_bad_working_days(http):
    r = http(ADMIN).put(f"{BASE}/settings",
                        json={"daily_expected_hours": 8, "working_days": [0, 9]})
    assert r.status_code == 422


def test_week_for_other_user_requires_worklogs_admin(http):
    r = http(ME).get(f"{BASE}/week", params={"start": MON.isoformat()})
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] == str(ME)
    assert len(r.json()["days"]) == 7

    r = http(ME).get(f"{BASE}/week", params={"start": MON.isoformat(), "user_id": str(OTHER)})
    assert r.status_code == 403

    r = http(ADMIN).get(f"{BASE}/week", params={"start": MON.isoformat(), "user_id": str(OTHER)})
    assert r.status_code == 200
    assert r.json()["user_id"] == str(OTHER)


def test_absence_self_ok_others_need_admin(http):
    payload = {"start_date": MON.isoformat(), "end_date": MON.isoformat()}
    r = http(ME).post(f"{BASE}/absences", json=payload)
    assert r.status_code == 201, r.text
    mine = r.json()["id"]
    assert r.json()["user_id"] == str(ME)

    r = http(ME).post(f"{BASE}/absences", json={**payload, "user_id": str(OTHER)})
    assert r.status_code == 403

    r = http(ADMIN).post(f"{BASE}/absences", json={**payload, "user_id": str(OTHER)})
    assert r.status_code == 201
    others = r.json()["id"]

    # Baskasinin iznini silmek: ME icin 403, admin icin 204.
    assert http(ME).delete(f"{BASE}/absences/{others}").status_code == 403
    assert http(ME).delete(f"{BASE}/absences/{mine}").status_code == 204
    assert http(ADMIN).delete(f"{BASE}/absences/{others}").status_code == 204

    # Izin yazildiktan sonra hafta o gunu 'off' gosterir.
    http(ME).post(f"{BASE}/absences", json=payload)
    week = http(ME).get(f"{BASE}/week", params={"start": MON.isoformat()}).json()
    assert week["days"][0]["status"] == "off" and week["days"][0]["is_absent"]


def test_holidays_crud_and_conflict(http):
    r = http(ADMIN).post(f"{BASE}/holidays", json={"holiday_date": MON.isoformat(), "name": "Bayram"})
    assert r.status_code == 201, r.text
    hid = r.json()["id"]
    r = http(ADMIN).post(f"{BASE}/holidays", json={"holiday_date": MON.isoformat(), "name": "X"})
    assert r.status_code == 409
    assert http(ME).get(f"{BASE}/holidays").status_code == 403
    assert len(http(ADMIN).get(f"{BASE}/holidays").json()) == 1
    assert http(ADMIN).delete(f"{BASE}/holidays/{hid}").status_code == 204
    assert http(ADMIN).get(f"{BASE}/holidays").json() == []
