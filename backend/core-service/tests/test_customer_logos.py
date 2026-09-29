"""
=============================================================================
Musteri logosu — yukleme / degistirme / silme / sunma kurallari
=============================================================================
Kilitlenen sozlesmeler:
  1. Yalnizca PNG / JPEG / WEBP; SVG ve bilinmeyen tipler 415.
  2. Beyan edilen tip ile sihirli baytlar eslesmeli (415).
  3. Tavan 256 KB: serviste 413, DB CHECK'inde IntegrityError.
  4. Yazma customers.manage; okuma her dogrulanmis kullanici.
  5. Musteri yok / baska tenant / logo yok -> 404.
  6. GET: ETag (sha256), Cache-Control, nosniff; If-None-Match -> 304.
  7. Musteri listesi/detayi has_logo + logo_etag tasir.
Gercek RLS izolasyonu tests/test_rls_isolation.py'de (NOBYPASSRLS rol).
=============================================================================
"""
import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text
from sqlalchemy.exc import IntegrityError

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm
from app.database import get_db
from app.main import app
from app.models.customer import Customer
from app.models.customer_logo import CUSTOMER_LOGO_MAX_BYTES
from app.services import customer_logo_service as logos
from app.tenant_db import get_tenant_db

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
OTHER_TENANT_ID = "00000000-0000-0000-0000-0000000000b7"
MANAGER = uuid.UUID("00000000-0000-4000-8000-0000000010a1")
MEMBER = uuid.UUID("00000000-0000-4000-8000-0000000010a2")

BASE = "/api/v1/core/customers"

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x01" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00\x10JFIF\x00" + b"\x02" * 64
WEBP = b"RIFF" + (76).to_bytes(4, "little") + b"WEBPVP8 " + b"\x03" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


# =============================================================================
# 1) SAF dogrulama — veritabani yok
# =============================================================================

def test_sniff_recognizes_only_allowed_types():
    assert logos.sniff(PNG) == "image/png"
    assert logos.sniff(JPEG) == "image/jpeg"
    assert logos.sniff(WEBP) == "image/webp"
    assert logos.sniff(SVG) is None
    assert logos.sniff(b"GIF89a....") is None


def test_validate_rules():
    assert logos.validate(PNG, "image/PNG; charset=binary") == "image/png"
    with pytest.raises(logos.LogoRejected):
        logos.validate(SVG, "image/svg+xml")
    with pytest.raises(logos.LogoRejected):
        logos.validate(PNG, "image/jpeg")          # beyan yalani
    with pytest.raises(logos.LogoRejected):
        logos.validate(b"", "image/png")
    with pytest.raises(logos.LogoTooLarge):
        logos.validate(PNG + b"\x00" * CUSTOMER_LOGO_MAX_BYTES, "image/png")


def test_if_none_match_parsing():
    etag = "a" * 64
    assert logos.if_none_match_hits(f'"{etag}"', etag)
    assert logos.if_none_match_hits(f'W/"{etag}"', etag)
    assert logos.if_none_match_hits(f'"x", "{etag}"', etag)
    assert logos.if_none_match_hits("*", etag)
    assert not logos.if_none_match_hits('"other"', etag)
    assert not logos.if_none_match_hits(None, etag)


# =============================================================================
# 2) Veritabani + HTTP
# =============================================================================

@pytest.fixture()
def world(pg_session):
    s = pg_session
    s.execute(sa_text("DELETE FROM customer_logos"))
    s.execute(sa_text(
        "INSERT INTO tenant_registry (tenant_id, slug, status, placement_key, "
        "source_version, provisioned_at, updated_at) VALUES (CAST(:t AS uuid), "
        "'logo-other', 'active', 'shared-default', 1, now(), now()) "
        "ON CONFLICT (tenant_id) DO NOTHING"
    ), {"t": OTHER_TENANT_ID})
    mine = Customer(id=uuid.uuid4(), name="Logo Musteri", is_active=True)
    theirs = Customer(id=uuid.uuid4(), name="Yabanci Musteri", is_active=True,
                      tenant_id=uuid.UUID(OTHER_TENANT_ID))
    s.add_all([mine, theirs])
    s.flush()
    return {"s": s, "mine": mine, "theirs": theirs}


@pytest.fixture()
def http(world, pg_session, authz_grants):
    authz_grants[str(MANAGER)] = [Perm.CUSTOMERS_MANAGE]
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


def _put(client, customer_id, data, ctype, name="logo.png"):
    return client.put(f"{BASE}/{customer_id}/logo", files={"file": (name, data, ctype)})


def test_upload_replace_get_delete_cycle(http, world):
    cid = world["mine"].id
    r = _put(http(MANAGER), cid, PNG, "image/png")
    assert r.status_code == 200, r.text
    assert r.json() == {"has_logo": True, "logo_etag": hashlib.sha256(PNG).hexdigest()}

    g = http(MEMBER).get(f"{BASE}/{cid}/logo")
    assert g.status_code == 200
    assert g.content == PNG
    assert g.headers["content-type"] == "image/png"
    assert g.headers["etag"] == f'"{hashlib.sha256(PNG).hexdigest()}"'
    assert g.headers["cache-control"] == "private, max-age=86400"
    assert g.headers["x-content-type-options"] == "nosniff"

    # Degistirme: satir sayisi 1 kalir, etag/tip degisir.
    r = _put(http(MANAGER), cid, WEBP, "image/webp", name="logo.webp")
    assert r.status_code == 200, r.text
    assert r.json()["logo_etag"] == hashlib.sha256(WEBP).hexdigest()
    count = world["s"].execute(sa_text(
        "SELECT count(*) FROM customer_logos WHERE customer_id = :c"), {"c": cid}).scalar()
    assert count == 1
    g = http(MEMBER).get(f"{BASE}/{cid}/logo")
    assert g.content == WEBP and g.headers["content-type"] == "image/webp"

    d = http(MANAGER).delete(f"{BASE}/{cid}/logo")
    assert d.status_code == 204
    assert http(MEMBER).get(f"{BASE}/{cid}/logo").status_code == 404
    # Idempotent silme.
    assert http(MANAGER).delete(f"{BASE}/{cid}/logo").status_code == 204


def test_jpeg_is_accepted(http, world):
    r = _put(http(MANAGER), world["mine"].id, JPEG, "image/jpeg", name="l.jpg")
    assert r.status_code == 200, r.text


def test_size_cap_is_413(http, world):
    big = PNG + b"\x00" * CUSTOMER_LOGO_MAX_BYTES
    r = _put(http(MANAGER), world["mine"].id, big, "image/png")
    assert r.status_code == 413
    # Tam tavan kabul edilir.
    exact = PNG + b"\x00" * (CUSTOMER_LOGO_MAX_BYTES - len(PNG))
    assert _put(http(MANAGER), world["mine"].id, exact, "image/png").status_code == 200


@pytest.mark.parametrize("data,ctype", [
    (SVG, "image/svg+xml"),                 # SVG hic kabul edilmez
    (SVG, "image/png"),                     # SVG'yi PNG diye gondermek
    (PNG, "image/jpeg"),                    # beyan/icerik uyusmazligi
    (JPEG, "image/webp"),
    (b"GIF89a" + b"\x00" * 32, "image/gif"),
    (PNG, "application/octet-stream"),
])
def test_wrong_or_mismatched_type_is_415(http, world, data, ctype):
    r = _put(http(MANAGER), world["mine"].id, data, ctype)
    assert r.status_code == 415, r.text
    assert world["s"].execute(sa_text("SELECT count(*) FROM customer_logos")).scalar() == 0


def test_empty_file_is_rejected(http, world):
    assert _put(http(MANAGER), world["mine"].id, b"", "image/png").status_code == 415


def test_non_manager_can_read_but_not_write(http, world):
    cid = world["mine"].id
    assert _put(http(MEMBER), cid, PNG, "image/png").status_code == 403
    assert _put(http(MANAGER), cid, PNG, "image/png").status_code == 200
    assert http(MEMBER).delete(f"{BASE}/{cid}/logo").status_code == 403
    assert http(MEMBER).get(f"{BASE}/{cid}/logo").status_code == 200


def test_unknown_and_cross_tenant_customer_is_404(http, world):
    s = world["s"]
    theirs = world["theirs"].id
    # Diger tenant'in musterisinin gercekten bir logosu olsun.
    s.execute(sa_text(
        "INSERT INTO customer_logos (id, tenant_id, customer_id, content, "
        "content_type, etag, updated_at) VALUES (gen_random_uuid(), "
        "CAST(:t AS uuid), :c, :b, 'image/png', :e, now())"
    ), {"t": OTHER_TENANT_ID, "c": theirs, "b": PNG,
        "e": hashlib.sha256(PNG).hexdigest()})
    s.flush()

    for cid in (theirs, uuid.uuid4()):
        assert http(MEMBER).get(f"{BASE}/{cid}/logo").status_code == 404
        assert _put(http(MANAGER), cid, PNG, "image/png").status_code == 404
        assert http(MANAGER).delete(f"{BASE}/{cid}/logo").status_code == 404
    # Diger tenant'in logosu yerinde kaldi.
    assert s.execute(sa_text(
        "SELECT count(*) FROM customer_logos WHERE customer_id = :c"), {"c": theirs}).scalar() == 1
    # Kendi musterisi logosuzken de 404 (ayni zarf).
    r = http(MEMBER).get(f"{BASE}/{world['mine'].id}/logo")
    assert r.status_code == 404 and "detail" in r.json()


def test_etag_conditional_get_returns_304(http, world):
    cid = world["mine"].id
    etag = _put(http(MANAGER), cid, PNG, "image/png").json()["logo_etag"]
    r = http(MEMBER).get(f"{BASE}/{cid}/logo", headers={"If-None-Match": f'"{etag}"'})
    assert r.status_code == 304
    assert r.content == b""
    assert r.headers["etag"] == f'"{etag}"'
    assert r.headers["cache-control"] == "private, max-age=86400"
    r = http(MEMBER).get(f"{BASE}/{cid}/logo", headers={"If-None-Match": '"stale"'})
    assert r.status_code == 200 and r.content == PNG


def test_list_and_detail_carry_logo_meta(http, world):
    cid = world["mine"].id
    rows = {c["id"]: c for c in http(MEMBER).get(BASE, params={"limit": 500}).json()}
    assert rows[str(cid)]["has_logo"] is False
    assert rows[str(cid)]["logo_etag"] is None

    etag = _put(http(MANAGER), cid, PNG, "image/png").json()["logo_etag"]
    rows = {c["id"]: c for c in http(MEMBER).get(BASE, params={"limit": 500}).json()}
    assert rows[str(cid)]["has_logo"] is True
    assert rows[str(cid)]["logo_etag"] == etag

    detail = http(MEMBER).get(f"{BASE}/{cid}").json()
    assert detail["has_logo"] is True and detail["logo_etag"] == etag
    updated = http(MANAGER).put(f"{BASE}/{cid}", json={"name": "Yeni Ad"}).json()
    assert updated["has_logo"] is True and updated["logo_etag"] == etag


def test_customer_delete_cascades_to_logo(http, world):
    cid = world["mine"].id
    assert _put(http(MANAGER), cid, PNG, "image/png").status_code == 200
    assert http(MANAGER).delete(f"{BASE}/{cid}").status_code == 204
    assert world["s"].execute(sa_text(
        "SELECT count(*) FROM customer_logos WHERE customer_id = :c"), {"c": cid}).scalar() == 0


def test_db_check_rejects_oversize_and_svg(world):
    s = world["s"]
    cid = world["mine"].id
    insert = sa_text(
        "INSERT INTO customer_logos (id, tenant_id, customer_id, content, "
        "content_type, etag, updated_at) VALUES (gen_random_uuid(), "
        "CAST(:t AS uuid), :c, :b, :ct, :e, now())"
    )
    cases = [
        (b"\x00" * (CUSTOMER_LOGO_MAX_BYTES + 1), "image/png"),
        (SVG, "image/svg+xml"),
        (b"", "image/png"),
    ]
    for data, ctype in cases:
        nested = s.begin_nested()
        with pytest.raises(IntegrityError):
            s.execute(insert, {"t": TEST_TENANT_ID, "c": cid, "b": data, "ct": ctype,
                               "e": "a" * 64})
        nested.rollback()


def test_db_enforces_one_logo_per_customer(world):
    s = world["s"]
    cid = world["mine"].id
    insert = sa_text(
        "INSERT INTO customer_logos (id, tenant_id, customer_id, content, "
        "content_type, etag, updated_at) VALUES (gen_random_uuid(), "
        "CAST(:t AS uuid), :c, :b, 'image/png', :e, now())"
    )
    s.execute(insert, {"t": TEST_TENANT_ID, "c": cid, "b": PNG, "e": "a" * 64})
    nested = s.begin_nested()
    with pytest.raises(IntegrityError):
        s.execute(insert, {"t": TEST_TENANT_ID, "c": cid, "b": PNG, "e": "b" * 64})
    nested.rollback()
