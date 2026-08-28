# =============================================================================
# HERMES — integration yuzeyinde tek kullanimlik indirme izni
# =============================================================================
# Bu akis, kaynak uygulamanin kullanicisinin TARAYICISINI Hermes'e
# yonlendirmesi icin vardir: o istekte bearer token YOKTUR. Dolayisiyla
# izin token'i TEK BASINA kimlik kanitidir ve buradaki testler o kanitin
# ne kadar dar oldugunu kilitler.
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from .conftest import OTHER_TENANT_ID


@pytest.fixture()
def attach_world(ticket_world, support_settings, monkeypatch, tmp_path):
    """Temiz, ticket'a BAGLI bir ek uretir (yerel depo ile)."""
    from app.models.ticketing import TicketAttachment
    from app.services import ticket_storage

    monkeypatch.setattr(support_settings, "TICKET_ATTACHMENTS_ENABLED", True)
    monkeypatch.setattr(support_settings, "TICKET_STORAGE_BACKEND", "local")
    monkeypatch.setattr(
        support_settings, "TICKET_STORAGE_LOCAL_ROOT", str(tmp_path)
    )
    ticket_storage.reset_storage_cache()

    s = ticket_world["session"]
    store = ticket_storage.get_storage()
    key = "attachments/2026/01/01/" + uuid.uuid4().hex
    store.put(key, b"PNGDATA", content_type="image/png")

    from app.services import ticket_service
    from app.services.ticket_service import Actor, TicketCreateInput

    ticket = ticket_service.create_ticket(
        s,
        application=ticket_world["logislot_app"],
        source_tenant=ticket_world["logislot_src"],
        group=ticket_world["devops"],
        route_version=ticket_world["logislot_route"].route_version,
        data=TicketCreateInput(
            source_ticket_id="ATT-1",
            requester_source_user_id="u-1",
            requester_display_name="Example User",
            title="ek testi",
            description="Ekran goruntusu indirme akisi icin kayit.",
            category="incident", impact="single_user",
        ),
        actor=Actor(
            type="tenant_user", role="requester", id="u-1",
            display_name="Example User", source_user_id="u-1",
        ),
    )
    s.flush()
    att = TicketAttachment(
        id=uuid.uuid4(),
        ticket_id=ticket.id,
        application_id=ticket_world["logislot_app"].id,
        source_tenant_row_id=ticket_world["logislot_src"].id,
        visibility="public",
        uploader_type="integration_client",
        uploader_id="x",
        file_name="ekran.png",
        object_key=key,
        detected_mime_type="image/png",
        size_bytes=7,
        scan_status="clean",
        attached_at=datetime.now(timezone.utc),
    )
    s.add(att)
    s.commit()
    ticket_world["ticket"] = ticket
    ticket_world["attachment"] = att
    yield ticket_world
    ticket_storage.reset_storage_cache()


def _client(support_api, world, scopes=("support:tickets:read",)):
    return support_api(world["logislot_app"], list(scopes))


def _issue(http, world, **over):
    body = {
        "ticket_id": str(world["ticket"].id),
        "source_tenant_id": "bta",
        "application_code": "logislot",
    }
    body.update(over)
    return http.post(
        f"/api/integrations/v1/support/attachments/"
        f"{world['attachment'].id}/download", json=body,
    )


def test_grant_round_trip_streams_the_bytes(support_api, attach_world):
    http, _c, _t = _client(support_api, attach_world)
    r = _issue(http, attach_world)
    assert r.status_code == 200
    url = r.json()["download_url"]
    assert "grant=" in url

    # TARAYICI adimi: Authorization basligi YOK.
    path = url.split("/api/integrations", 1)[1]
    bare = http.__class__(http.app) if hasattr(http, "app") else http
    r2 = http.get("/api/integrations" + path, headers={"Authorization": ""})
    assert r2.status_code == 200
    assert r2.content == b"PNGDATA"
    assert r2.headers["content-disposition"].startswith("attachment;")
    assert r2.headers["x-content-type-options"] == "nosniff"
    # Icerik tarayicida CALISTIRILAMAZ: her zaman octet-stream.
    assert r2.headers["content-type"].startswith("application/octet-stream")


def test_grant_is_single_use(support_api, attach_world):
    http, _c, _t = _client(support_api, attach_world)
    url = _issue(http, attach_world).json()["download_url"]
    path = "/api/integrations" + url.split("/api/integrations", 1)[1]
    assert http.get(path).status_code == 200
    # Ikinci deneme: ayni token bir daha bozdurulamaz.
    assert http.get(path).status_code == 404


def test_expired_grant_is_refused(support_api, attach_world):
    from app.models.ticketing import TicketDownloadGrant

    http, _c, _t = _client(support_api, attach_world)
    url = _issue(http, attach_world).json()["download_url"]
    s = attach_world["session"]
    row = s.query(TicketDownloadGrant).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    s.commit()
    path = "/api/integrations" + url.split("/api/integrations", 1)[1]
    assert http.get(path).status_code == 404


def test_grant_does_not_open_another_attachment(support_api, attach_world):
    """Token bir EKE baglidir; baska bir ek kimligiyle kullanilamaz."""
    http, _c, _t = _client(support_api, attach_world)
    url = _issue(http, attach_world).json()["download_url"]
    token = url.split("grant=", 1)[1]
    other = uuid.uuid4()
    r = http.get(
        f"/api/integrations/v1/support/attachments/{other}/content"
        f"?grant={token}"
    )
    assert r.status_code == 404


def test_another_source_tenant_cannot_request_a_grant(
    support_api, attach_world
):
    http, _c, _t = _client(support_api, attach_world)
    # `hermes` uygulamasinin tenant kimligi LogiSlot kapsaminda YOK.
    r = _issue(http, attach_world, source_tenant_id=OTHER_TENANT_ID)
    assert r.status_code == 404


def test_internal_attachment_is_never_granted(support_api, attach_world):
    s = attach_world["session"]
    attach_world["attachment"].visibility = "internal"
    s.commit()
    http, _c, _t = _client(support_api, attach_world)
    assert _issue(http, attach_world).status_code == 404


def test_unscanned_attachment_is_not_granted(support_api, attach_world):
    s = attach_world["session"]
    attach_world["attachment"].scan_status = "pending_scan"
    s.commit()
    http, _c, _t = _client(support_api, attach_world)
    r = _issue(http, attach_world)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "attachment_not_ready"


def test_read_scope_is_required(support_api, attach_world):
    http, _c, _t = _client(
        support_api, attach_world, scopes=("support:groups:read",)
    )
    r = _issue(http, attach_world)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"


def test_token_is_not_stored_in_plaintext(support_api, attach_world):
    from app.models.ticketing import TicketDownloadGrant

    http, _c, _t = _client(support_api, attach_world)
    url = _issue(http, attach_world).json()["download_url"]
    token = url.split("grant=", 1)[1]
    row = attach_world["session"].query(TicketDownloadGrant).one()
    assert row.token_hash != token
    assert len(row.token_hash) == 64


def test_url_honours_the_tls_terminating_proxy(support_api, attach_world):
    """Adres TARAYICIYA verilir: sema/host proxy'den okunmali.

    Uygulama TLS'i kendisi sonlandirmaz ve uvicorn forwarded basliklarina
    varsayilan olarak guvenmez; duz `request.url` `http` doner ve
    yonlendirme kirilirdi.
    """
    http, _c, _t = _client(support_api, attach_world)
    r = http.post(
        f"/api/integrations/v1/support/attachments/"
        f"{attach_world['attachment'].id}/download",
        json={"ticket_id": str(attach_world["ticket"].id),
              "source_tenant_id": "bta"},
        headers={"X-Forwarded-Proto": "https",
                 "X-Forwarded-Host": "hermes.duosis.com"},
    )
    assert r.status_code == 200
    url = r.json()["download_url"]
    assert url.startswith(
        "https://hermes.duosis.com/api/integrations/v1/support/attachments/"
    ), url
    # Ayni yardimci `upload_url`i da kurar; tek yerde kilitlemek yeterli.
