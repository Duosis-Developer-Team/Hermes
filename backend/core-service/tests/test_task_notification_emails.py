"""
=============================================================================
Sprint 8 — Task atama e-postalari: EKIP BAGLAMI sozlesmesi
=============================================================================
Bir task 4 kisiye atandiginda herkes ayri e-posta alir (dogru, korunur)
ama eskiden her e-posta "yalniz sana atandi" gibi yaziyordu. Bu dosya
yeni sozlesmeyi kilitler:

  - Her aliciya AYRI e-posta (adresler asla tek To/CC'de toplanmaz).
  - Govde atamanin GERCEK kapsamini gosterir (kisi listesi/grup adi).
  - Ayni kullanici cift satirdan gelse bile TEK e-posta alir.
  - Isim sirasi deterministiktir (gorunen ada gore; esitlikte id).
  - Alicilar birbirinin e-POSTA ADRESINI goremez (yalniz gorunen ad).
  - HTML escaping: ozel karakterli basliklar/isimler kacislanir.
  - E-posta gonderilemeyen (adressiz) kullanici digerlerini engellemez.
  - Tum sistem metinleri INGILIZCE.

Gercek e-posta GONDERILMEZ: `_send` kayit altina alinir; kullanici
cozumlemesi (`_resolve_users`) sahte dizinle beslenir.
=============================================================================
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.services import task_notifications as tn

# WS7: bildirim/dizin cozumu tenant baglami ZORUNLU ister.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"


# ─────────────────────────────────────────────────────────────────────────
# Harness
# ─────────────────────────────────────────────────────────────────────────

class _Settings(SimpleNamespace):
    NOTIFICATIONS_ENABLED = True
    NOTIF_MAIL_SENDER = "hermes@example.com"
    NOTIF_NOTIFY_ASSIGNER = True
    APP_BASE_URL = "https://hermes.example.com"


class _Graph(SimpleNamespace):
    is_configured = True


DIRECTORY = {
    "u-assigner": {"full_name": "Gencay COŞKUN", "email": "gencay@x.com"},
    "u-ayse": {"full_name": "Ayşe Yılmaz", "email": "ayse@x.com"},
    "u-mehmet": {"full_name": "Mehmet Kaya", "email": "mehmet@x.com"},
    "u-deniz": {"full_name": "Deniz Demir", "email": "deniz@x.com"},
    "u-zeta": {"full_name": "Zeta Zorlu", "email": "zeta@x.com"},
    # E-posta adresi OLMAYAN kullanici (mevcut urun kurali: atlanir).
    "u-noemail": {"full_name": "Adressiz Kullanıcı", "email": None},
}


def _task(assignee, title="Prepare the weekly report", ttype="task"):
    return {
        "id": f"t-{assignee}",
        "task_code": "TASK-1",
        "task_type": ttype,
        "title": title,
        "description": "desc",
        "customer_name": "Vakko",
        "project_name": "ATM",
        "sub_project_name": None,
        "priority": "high",
        "scheduled_date": "01.08.2026",
        "due_date": "05.08.2026",
        "assignee_user_id": assignee,
        "assigner_user_id": "u-assigner",
    }


@pytest.fixture
def mail(monkeypatch):
    """Gonderimleri yakalar; ayarlari/graf istemcisini sahteler."""
    sent = []

    async def fake_send(sender, to_email, subject, html_body):
        sent.append({"to": to_email, "subject": subject, "html": html_body})

    async def fake_resolve(token, ids, **_kw):
        return {i: DIRECTORY[i] for i in ids if i in DIRECTORY}

    monkeypatch.setattr(tn, "_send", fake_send)
    monkeypatch.setattr(tn, "_resolve_users", fake_resolve)
    monkeypatch.setattr(tn, "get_settings", lambda: _Settings())
    monkeypatch.setattr(tn, "get_graph_client", lambda: _Graph())
    return sent


def _run(coro):
    asyncio.run(coro)


def _notify(tasks, context=None):
    _run(tn.send_assignment_notifications(
        tenant_id=TEST_TENANT_ID,
        token="tok",
        tasks=tasks,
        assigner_user_id="u-assigner",
        assignment_context=context,
    ))


def _assignee_mails(sent):
    return [m for m in sent if m["to"] != "gencay@x.com"]


# ─────────────────────────────────────────────────────────────────────────
# 1) Tek dogrudan atama — kisisel anlatim KORUNUR
# ─────────────────────────────────────────────────────────────────────────

def test_single_direct_assignment_stays_personal(mail):
    _notify(
        [_task("u-ayse")],
        {"direct_user_ids": ["u-ayse"], "group_names": []},
    )
    mails = _assignee_mails(mail)
    assert len(mails) == 1
    m = mails[0]
    assert m["to"] == "ayse@x.com"
    assert m["subject"] == "[Hermes] Task assigned: Prepare the weekly report"
    assert "assigned you the task" in m["html"]
    # Tek kisilik atamada ekip listesi/neden satiri GOSTERILMEZ.
    assert "Assignees" not in m["html"]
    assert "one of the assignees" not in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 2) Dort dogrudan atama — herkes AYNI ekip baglamini gorur
# ─────────────────────────────────────────────────────────────────────────

def test_four_direct_assignees_share_team_context(mail):
    ids = ["u-ayse", "u-mehmet", "u-deniz", "u-zeta"]
    _notify(
        [_task(i) for i in ids],
        {"direct_user_ids": ids, "group_names": []},
    )
    mails = _assignee_mails(mail)
    assert len(mails) == 4                       # herkese AYRI e-posta
    assert len({m["to"] for m in mails}) == 4    # adresler AYRI
    for m in mails:
        assert "to <strong>4 people</strong>" in m["html"]
        for name in ("Ayşe Yılmaz", "Mehmet Kaya", "Deniz Demir", "Zeta Zorlu"):
            assert name in m["html"]
        assert "Assignees (4):" in m["html"]
        assert "because you are one of the assignees" in m["html"]
        # PRIVACY: baska alicilarin e-posta ADRESLERI govdede YOK.
        others = {"ayse@x.com", "mehmet@x.com", "deniz@x.com", "zeta@x.com"}
        others.discard(m["to"])
        for addr in others:
            assert addr not in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 3) Grup atamasi — grup adi + uye listesi + neden satiri
# ─────────────────────────────────────────────────────────────────────────

def test_group_assignment_shows_group_and_members(mail):
    ids = ["u-ayse", "u-mehmet", "u-deniz", "u-zeta"]
    _notify(
        [_task(i) for i in ids],
        {"direct_user_ids": [], "group_names": ["Technical Team"]},
    )
    mails = _assignee_mails(mail)
    assert len(mails) == 4
    for m in mails:
        assert "“Technical Team”" in m["html"]
        assert "Group assignees (4):" in m["html"]
        assert (
            "as a member of the “Technical Team” group" in m["html"]
        )


# ─────────────────────────────────────────────────────────────────────────
# 4) Ayni kullanicinin TEKRARI — tek e-posta, listede tek giris
# ─────────────────────────────────────────────────────────────────────────

def test_duplicate_rows_produce_one_email_and_one_entry(mail):
    _notify(
        [_task("u-ayse"), _task("u-ayse"), _task("u-mehmet")],
        {"direct_user_ids": ["u-ayse", "u-mehmet"], "group_names": []},
    )
    mails = _assignee_mails(mail)
    to_counts = {}
    for m in mails:
        to_counts[m["to"]] = to_counts.get(m["to"], 0) + 1
    assert to_counts == {"ayse@x.com": 1, "mehmet@x.com": 1}
    # Listede Ayse YALNIZ BIR kez gecer (dedup stabil ID ile).
    assert mails[0]["html"].count("Ayşe Yılmaz") == 1


# ─────────────────────────────────────────────────────────────────────────
# 5) Dogrudan + grup birlesimi (bulk modeli destekliyor)
# ─────────────────────────────────────────────────────────────────────────

def test_mixed_direct_and_group(mail):
    ids = ["u-ayse", "u-mehmet", "u-deniz"]
    _notify(
        [_task(i) for i in ids],
        {"direct_user_ids": ["u-ayse"], "group_names": ["Technical Team"]},
    )
    mails = _assignee_mails(mail)
    assert len(mails) == 3
    for m in mails:
        assert "Assigned groups:" in m["html"]
        assert "Technical Team" in m["html"]
        assert "individually selected people" in m["html"]
        assert "because you are one of the assignees" in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 6) E-posta adresi olmayan kullanici — digerleri etkilenmez,
#    ama EKIP listesinde yine gorunur (atamanin gercek hedefi)
# ─────────────────────────────────────────────────────────────────────────

def test_assignee_without_email_skipped_but_listed(mail):
    ids = ["u-ayse", "u-noemail"]
    _notify(
        [_task(i) for i in ids],
        {"direct_user_ids": ids, "group_names": []},
    )
    mails = _assignee_mails(mail)
    assert [m["to"] for m in mails] == ["ayse@x.com"]
    # Adressiz kullanici da atamanin hedefi: listede gorunur.
    assert "Adressiz Kullanıcı" in mails[0]["html"]
    assert "Assignees (2):" in mails[0]["html"]


# ─────────────────────────────────────────────────────────────────────────
# 7) Deterministik isim sirasi (gorunen ada gore)
# ─────────────────────────────────────────────────────────────────────────

def test_names_are_deterministically_ordered(mail):
    # Kasitli karisik giris sirasi.
    ids = ["u-zeta", "u-ayse", "u-mehmet", "u-deniz"]
    _notify(
        [_task(i) for i in ids],
        {"direct_user_ids": ids, "group_names": []},
    )
    html = _assignee_mails(mail)[0]["html"]
    order = [html.index(n) for n in
             ("Ayşe Yılmaz", "Deniz Demir", "Mehmet Kaya", "Zeta Zorlu")]
    assert order == sorted(order)


# ─────────────────────────────────────────────────────────────────────────
# 8) HTML escaping — ozel karakterli baslik/isim kacislanir
# ─────────────────────────────────────────────────────────────────────────

def test_html_escaping_in_title_and_names(mail, monkeypatch):
    evil_dir = dict(DIRECTORY)
    evil_dir["u-ayse"] = {
        "full_name": 'Ayşe <script>alert(1)</script>', "email": "ayse@x.com",
    }

    async def fake_resolve(token, ids, **_kw):
        return {i: evil_dir[i] for i in ids if i in evil_dir}

    monkeypatch.setattr(tn, "_resolve_users", fake_resolve)
    _notify(
        [_task("u-ayse", title='Fix <b>everything</b> & more'),
         _task("u-mehmet", title='Fix <b>everything</b> & more')],
        {"direct_user_ids": ["u-ayse", "u-mehmet"], "group_names": []},
    )
    html = _assignee_mails(mail)[0]["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "Fix <b>everything</b>" not in html
    assert "&lt;b&gt;everything&lt;/b&gt; &amp; more" in html


# ─────────────────────────────────────────────────────────────────────────
# 9) Uzun baslik govdeyi bozmaz; konu Ingilizce sozlesmeyi tasir
# ─────────────────────────────────────────────────────────────────────────

def test_long_title_and_subject_contract(mail):
    long_title = "Very long title " + "x" * 300
    _notify(
        [_task("u-ayse", title=long_title)],
        {"direct_user_ids": ["u-ayse"], "group_names": []},
    )
    m = _assignee_mails(mail)[0]
    assert m["subject"].startswith("[Hermes] Task assigned: Very long title")
    assert "x" * 100 in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 10) Issue tipi kendi adiyla konusur
# ─────────────────────────────────────────────────────────────────────────

def test_issue_type_uses_issue_noun(mail):
    _notify(
        [_task("u-ayse", ttype="issue")],
        {"direct_user_ids": ["u-ayse"], "group_names": []},
    )
    m = _assignee_mails(mail)[0]
    assert m["subject"].startswith("[Hermes] Issue assigned:")
    assert "assigned you the issue" in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 11) Assigner ozeti: ekip baglami + grup adi + Ingilizce
# ─────────────────────────────────────────────────────────────────────────

def test_assigner_summary_for_group(mail):
    ids = ["u-ayse", "u-mehmet"]
    _notify(
        [_task(i) for i in ids],
        {"direct_user_ids": [], "group_names": ["Technical Team"]},
    )
    summaries = [m for m in mail if m["to"] == "gencay@x.com"]
    assert len(summaries) == 1
    m = summaries[0]
    assert m["subject"] == (
        "[Hermes] You assigned a task to 2 people: Prepare the weekly report"
    )
    assert "Technical Team" in m["html"]
    assert "Ayşe Yılmaz" in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 12) Hicbir sistem metni Turkce kalmadi (bu modulde)
# ─────────────────────────────────────────────────────────────────────────

def test_no_turkish_system_text_in_module():
    import inspect
    import re
    src = inspect.getsource(tn)
    code_lines = [
        line for line in src.split("\n")
        if not line.strip().startswith("#")
    ]
    turkish = [
        line.strip()[:70]
        for line in code_lines
        if re.search(r"[ğüşıöçĞÜŞİÖÇ]", line)
    ]
    assert turkish == []


# ─────────────────────────────────────────────────────────────────────────
# 13) Bildirim kapaliyken hicbir sey gonderilmez (mevcut kural korunur)
# ─────────────────────────────────────────────────────────────────────────

def test_disabled_notifications_send_nothing(mail, monkeypatch):
    disabled = _Settings()
    disabled.NOTIFICATIONS_ENABLED = False
    monkeypatch.setattr(tn, "get_settings", lambda: disabled)
    _notify([_task("u-ayse")], {"direct_user_ids": ["u-ayse"], "group_names": []})
    assert mail == []


# ─────────────────────────────────────────────────────────────────────────
# 14) Baglamsiz cagri (eski cagiran) coker mi? — geriye uyumlu
# ─────────────────────────────────────────────────────────────────────────

def test_missing_context_is_backward_compatible(mail):
    _notify([_task("u-ayse"), _task("u-mehmet")], None)
    mails = _assignee_mails(mail)
    assert len(mails) == 2
    # Baglam yoksa bile coklu atama EKIP olarak anlatilir.
    for m in mails:
        assert "2 people" in m["html"]
        assert "Assignees (2):" in m["html"]


# ─────────────────────────────────────────────────────────────────────────
# 15) Mailer kismi hatasi: bir gonderim patlasa da digerleri gider,
#     coroutine ASLA yukari hata sizdirmaz (task islemi korunur)
# ─────────────────────────────────────────────────────────────────────────

def test_mailer_failure_isolates_recipient_and_never_raises(monkeypatch):
    """Izolasyon garantisi GERCEK `_send`in icindedir (per-send
    try/except) — bu test onu baypas ETMEZ: hata graph istemcisinden
    firlatilir, `_send` yutar, dongu diger alicilarla devam eder."""
    calls = {"n": 0}
    delivered = []

    class _FlakyGraph:
        is_configured = True

        async def send_mail(self, *, sender, to_email, subject,
                            html_body, inline_images=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("Graph 503")
            delivered.append(to_email)

    async def fake_resolve(token, ids, **_kw):
        return {i: DIRECTORY[i] for i in ids if i in DIRECTORY}

    monkeypatch.setattr(tn, "get_graph_client", lambda: _FlakyGraph())
    monkeypatch.setattr(tn, "_logo_inline_images", lambda: [])
    monkeypatch.setattr(tn, "_resolve_users", fake_resolve)
    monkeypatch.setattr(tn, "get_settings", lambda: _Settings())

    _notify(
        [_task("u-ayse"), _task("u-mehmet")],
        {"direct_user_ids": ["u-ayse", "u-mehmet"], "group_names": []},
    )
    # Ilk gonderim (Graph 503) dustu; kalan alicilar e-postalarini ALDI
    # ve hicbir istisna disari sizmadi (task islemi zaten tamamlanmisti).
    assert calls["n"] >= 2
    assert delivered


# ─────────────────────────────────────────────────────────────────────────
# 16) Birden fazla grup: "groups" cogul anlatimi + genel guvenli gerekce
# ─────────────────────────────────────────────────────────────────────────

def test_multiple_groups_use_plural_and_generic_reason(mail):
    _notify(
        [_task("u-ayse"), _task("u-mehmet"), _task("u-deniz")],
        {"direct_user_ids": [], "group_names": ["Backend Team", "QA Team"]},
    )
    mails = _assignee_mails(mail)
    assert len(mails) == 3
    for m in mails:
        assert "groups" in m["html"]                      # cogul
        assert "Backend Team" in m["html"] and "QA Team" in m["html"]
        # Coklu grupta uyelik iddiasi YAPILMAZ — guvenli genel gerekce.
        assert "as a member of" not in m["html"]
        assert "one of the assignees" in m["html"]
