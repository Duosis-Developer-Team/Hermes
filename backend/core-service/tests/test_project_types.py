"""
=============================================================================
Proje turleri + jenerik proje logosu (0016)
=============================================================================
Kilitlenen sozlesmeler:
  1. Renk ve glif SABIT sozlukten; sunucu ile frontend sozlugu birebir.
  2. Tur CRUD: ad tenant icinde buyuk/kucuk harf duyarsiz tekil (409),
     gecersiz renk 422, yazma projects.manage, okuma herkes.
  3. Proje: tur + glif kaydedilir, yanit tur adi ve RENGINI tasir;
     bilinmeyen glif reddedilir, bilinmeyen/baska tenant'in turu 404.
  4. Tur rengi degisince o turdeki projelerin yaniti yeni rengi tasir
     (jenerik logo istemcide tur renginden cizilir).
  5. Kullanimdaki tur silinemez (409); bos tur silinir.
  6. DB: projects.project_type_id composite FK, ON DELETE SET NULL yalniz
     proje kolonunu bosaltir; tur silinince proje kaybolmaz.
=============================================================================
"""
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm
from app.database import get_db
from app.main import app
from app.models.project import Project
from app.models.project_type import ProjectType
from app.project_type_catalog import LOGO_GLYPHS, PROJECT_TYPE_COLORS
from app.schemas.project_type import ProjectTypeColor
from app.tenant_db import get_tenant_db

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
OTHER_TENANT_ID = "00000000-0000-0000-0000-0000000000b9"
MANAGER = uuid.UUID("00000000-0000-4000-8000-0000000030a1")
MEMBER = uuid.UUID("00000000-0000-4000-8000-0000000030a2")
TYPES = "/api/v1/core/project-types"
PROJECTS = "/api/v1/core/projects"

REPO = Path(__file__).resolve().parents[3]
FRONTEND = REPO / "frontend" / "src" / "features" / "projectTypes"


# =============================================================================
# 1) Sozluk paritesi — veritabani yok
# =============================================================================

def _frontend_keys(filename, const):
    src = (FRONTEND / filename).read_text(encoding="utf-8")
    block = src[src.index(f"export const {const}"):]
    block = block[:block.index("\n}\n")]
    # Ust duzey anahtarlar: 4 bosluk girintili `key:` ya da `'key':`.
    return re.findall(r"^    '?([a-z0-9-]+)'?: ", block, flags=re.M)


def test_color_catalog_matches_frontend_palette():
    assert tuple(_frontend_keys("palette.js", "PROJECT_TYPE_PALETTE")) == PROJECT_TYPE_COLORS
    # Sema Literal'i de ayni liste (OpenAPI'de listelenen renkler).
    assert ProjectTypeColor.__args__ == PROJECT_TYPE_COLORS


def test_glyph_catalog_matches_frontend_glyphs():
    assert tuple(_frontend_keys("glyphs.js", "LOGO_GLYPHS")) == LOGO_GLYPHS


# =============================================================================
# 2) Veritabani + HTTP
# =============================================================================

@pytest.fixture()
def world(pg_session):
    s = pg_session
    s.execute(sa_text("UPDATE projects SET project_type_id = NULL, logo_glyph = NULL"))
    s.execute(sa_text("DELETE FROM project_types"))
    s.execute(sa_text(
        "INSERT INTO tenant_registry (tenant_id, slug, status, placement_key, "
        "source_version, provisioned_at, updated_at) VALUES (CAST(:t AS uuid), "
        "'project-type-other', 'active', 'shared-default', 1, now(), now()) "
        "ON CONFLICT (tenant_id) DO NOTHING"
    ), {"t": OTHER_TENANT_ID})
    theirs = ProjectType(name="Yabanci", color="red", tenant_id=uuid.UUID(OTHER_TENANT_ID))
    s.add(theirs)
    s.flush()
    return {"s": s, "theirs": theirs}


@pytest.fixture()
def http(world, pg_session, authz_grants):
    authz_grants[str(MANAGER)] = [Perm.PROJECTS_MANAGE]
    authz_grants[str(MEMBER)] = []
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


def _mine(client):
    # Testler superuser ile baglanir (RLS asilir): yalniz bu tenant'inkiler.
    return [t for t in client.get(TYPES).json() if t["name"] != "Yabanci"]


def test_type_crud_and_rules(http):
    m = http(MANAGER)
    r = m.post(TYPES, json={"name": "  Destek  ", "color": "blue"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Destek" and body["color"] == "blue" and body["project_count"] == 0

    # Ad buyuk/kucuk harf duyarsiz tekil.
    assert m.post(TYPES, json={"name": "destek", "color": "red"}).status_code == 409
    # Renk sozluk disi → 422.
    assert m.post(TYPES, json={"name": "Talep", "color": "#ff0000"}).status_code == 422
    assert m.post(TYPES, json={"name": "Talep", "color": "amber"}).status_code == 201

    tid = body["id"]
    r = m.put(f"{TYPES}/{tid}", json={"color": "red"})
    assert r.status_code == 200 and r.json()["color"] == "red" and r.json()["name"] == "Destek"
    assert m.put(f"{TYPES}/{tid}", json={"name": "TALEP"}).status_code == 409
    assert [t["name"] for t in _mine(http(MEMBER))] == ["Destek", "Talep"]


def test_member_reads_but_cannot_write(http):
    assert http(MEMBER).get(TYPES).status_code == 200
    assert http(MEMBER).post(TYPES, json={"name": "X", "color": "blue"}).status_code == 403
    tid = http(MANAGER).post(TYPES, json={"name": "X", "color": "blue"}).json()["id"]
    assert http(MEMBER).put(f"{TYPES}/{tid}", json={"color": "red"}).status_code == 403
    assert http(MEMBER).delete(f"{TYPES}/{tid}").status_code == 403


def test_project_type_and_glyph_follow_type_color(http):
    m = http(MANAGER)
    tid = m.post(TYPES, json={"name": "Destek", "color": "red"}).json()["id"]
    r = m.post(PROJECTS, json={"name": "L3", "project_type_id": tid, "logo_glyph": "lv3"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["project_type_name"] == "Destek" and p["project_type_color"] == "red"
    assert p["logo_glyph"] == "lv3"

    # Tur rengi sariya → projenin yaniti sari (logo yeniden cizilir).
    m.put(f"{TYPES}/{tid}", json={"color": "yellow"})
    got = m.get(f"{PROJECTS}/{p['id']}").json()
    assert got["project_type_color"] == "yellow" and got["logo_glyph"] == "lv3"

    # Glif kaldirilabilir; tur kaldirilabilir.
    got = m.put(f"{PROJECTS}/{p['id']}", json={"logo_glyph": None, "project_type_id": None}).json()
    assert got["logo_glyph"] is None and got["project_type_id"] is None and got["project_type_color"] is None


def test_project_rejects_unknown_glyph_and_type(http):
    # Baska tenant'in turu: uretimde RLS onu "yok" gosterir (404); testler
    # RLS'i asan superuser'la kostugu icin bunu DB testi kanitlar (asagida).
    m = http(MANAGER)
    r = m.post(PROJECTS, json={"name": "P", "logo_glyph": "not-a-glyph"})
    assert r.status_code == 400, r.text
    assert m.post(PROJECTS, json={"name": "P", "project_type_id": str(uuid.uuid4())}).status_code == 404


def test_type_in_use_cannot_be_deleted(http):
    m = http(MANAGER)
    tid = m.post(TYPES, json={"name": "Proje", "color": "teal"}).json()["id"]
    pid = m.post(PROJECTS, json={"name": "Kurulum", "project_type_id": tid}).json()["id"]
    assert [t["project_count"] for t in _mine(m) if t["id"] == tid] == [1]
    r = m.delete(f"{TYPES}/{tid}")
    assert r.status_code == 409 and "1 project" in r.json()["detail"]
    m.put(f"{PROJECTS}/{pid}", json={"project_type_id": None})
    assert m.delete(f"{TYPES}/{tid}").status_code == 204
    assert m.delete(f"{TYPES}/{tid}").status_code == 404


def test_db_fk_is_composite_and_set_null_keeps_project(world):
    s = world["s"]
    fk = s.execute(sa_text(
        "SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con "
        "JOIN pg_class c ON c.oid = con.conrelid "
        "WHERE c.relname = 'projects' AND con.contype = 'f' "
        "AND pg_get_constraintdef(con.oid) LIKE '%project_type_id%'"
    )).scalar()
    assert "(tenant_id, project_type_id)" in fk
    assert "SET NULL (project_type_id)" in fk

    t = ProjectType(name="Gecici", color="blue")
    s.add(t)
    s.flush()
    p = Project(id=uuid.uuid4(), name="Kalici", is_active=True, project_type_id=t.id, logo_glyph="general")
    s.add(p)
    s.flush()
    # DB seviyesinde silme (API 409 verir; FK davranisi yine de guvenli).
    s.execute(sa_text("DELETE FROM project_types WHERE id = :i"), {"i": t.id})
    row = s.execute(sa_text(
        "SELECT name, project_type_id, logo_glyph, tenant_id FROM projects WHERE id = :i"
    ), {"i": p.id}).one()
    assert row.name == "Kalici" and row.project_type_id is None
    assert row.logo_glyph == "general" and str(row.tenant_id) == TEST_TENANT_ID


def test_cross_tenant_type_reference_is_rejected_by_db(world):
    """Baska tenant'in turu composite FK nedeniyle REFERANS bile edilemez."""
    from sqlalchemy.exc import IntegrityError
    s = world["s"]
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            s.add(Project(id=uuid.uuid4(), name="Sizinti", is_active=True,
                          project_type_id=world["theirs"].id))
            s.flush()
