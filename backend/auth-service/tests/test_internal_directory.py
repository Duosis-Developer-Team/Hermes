# =============================================================================
# auth-service - Stage 5B-2: internal directory + S2S guard testleri
# =============================================================================
import logging
import uuid

from .conftest import S2S_CURRENT, S2S_NEXT

RESOLVE = "/internal/directory/users/resolve"
LIST = "/internal/directory/users"


def _mk_user(s, name, email, active=True):
    from app.models.user import User

    u = User(
        id=uuid.uuid4(),
        email=email,
        full_name=name,
        hashed_password="x",
        is_active=active,
    )
    s.add(u)
    s.commit()
    return u


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ── S2S kapisi ──────────────────────────────────────────────────────────


def test_missing_and_invalid_credentials_rejected(auth_http):
    r = auth_http.post(RESOLVE, json={"user_ids": []})
    assert r.status_code == 401
    r = auth_http.post(
        RESOLVE, json={"user_ids": []}, headers=_h("wrong-token-123456")
    )
    assert r.status_code == 401
    # Query parametresiyle credential KABUL EDILMEZ.
    r = auth_http.post(
        f"{RESOLVE}?token={S2S_CURRENT}", json={"user_ids": []}
    )
    assert r.status_code == 401


def test_current_and_next_keys_both_work(auth_http):
    for token in (S2S_CURRENT, S2S_NEXT):
        r = auth_http.post(
            RESOLVE, json={"user_ids": []}, headers=_h(token)
        )
        assert r.status_code == 200, token
        assert r.json() == {"users": []}


def test_invalid_attempts_rate_limited(auth_http):
    for _ in range(10):
        auth_http.post(RESOLVE, json={"user_ids": []}, headers=_h("bad"))
    r = auth_http.post(RESOLVE, json={"user_ids": []}, headers=_h("bad"))
    assert r.status_code == 429


def test_s2s_not_accepted_on_normal_endpoints(auth_http):
    """S2S credential'i normal auth yuzeyinde KIMLIK DEGILDIR."""
    r = auth_http.get(
        "/api/v1/auth/users/lookup", headers=_h(S2S_CURRENT)
    )
    assert r.status_code == 401


def test_token_value_never_logged(auth_http, caplog):
    with caplog.at_level(logging.INFO):
        auth_http.post(
            RESOLVE, json={"user_ids": []}, headers=_h(S2S_CURRENT)
        )
        auth_http.post(RESOLVE, json={"user_ids": []}, headers=_h("bad"))
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert S2S_CURRENT not in joined
    assert "bad" not in joined.split()  # deneme degeri de yazilmaz


# ── Batch resolve ───────────────────────────────────────────────────────


def test_batch_resolve_minimal_schema(auth_http, pg_session):
    u1 = _mk_user(pg_session, "Ada Lovelace", "ada@example.com")
    u2 = _mk_user(pg_session, None, "noname@example.com", active=False)
    unknown = str(uuid.uuid4())

    r = auth_http.post(
        RESOLVE,
        json={"user_ids": [str(u1.id), unknown, str(u2.id)]},
        headers=_h(S2S_CURRENT),
    )
    assert r.status_code == 200
    users = r.json()["users"]
    # Bilinmeyen ID sessizce atlanir; girdi sirasi korunur.
    assert [u["id"] for u in users] == [str(u1.id), str(u2.id)]
    assert users[0] == {
        "id": str(u1.id),
        "display_name": "Ada Lovelace",
        "work_email": "ada@example.com",
        "is_active": True,
    }
    # full_name yoksa e-posta display_name olur; inaktif de COZULUR
    # (is_active bayragiyla) — kayit-turevli kimlikler eski olabilir.
    assert users[1]["display_name"] == "noname@example.com"
    assert users[1]["is_active"] is False
    # Yasak alanlar YAPISAL olarak yok.
    for u in users:
        for banned in ("role", "is_admin", "hashed_password",
                       "auth_provider"):
            assert banned not in u


def test_resolve_id_cap(auth_http):
    ids = [str(uuid.uuid4()) for _ in range(501)]
    r = auth_http.post(
        RESOLVE, json={"user_ids": ids}, headers=_h(S2S_CURRENT)
    )
    assert r.status_code == 422


# ── Global liste ────────────────────────────────────────────────────────


def test_global_list_active_only_search_paging(auth_http, pg_session):
    _mk_user(pg_session, "Ada Lovelace", "ada@example.com")
    _mk_user(pg_session, "Alan Turing", "alan@example.com")
    _mk_user(pg_session, "Inactive One", "gone@example.com", active=False)

    r = auth_http.get(LIST, headers=_h(S2S_CURRENT))
    body = r.json()
    assert [u["display_name"] for u in body["users"]] == [
        "Ada Lovelace",
        "Alan Turing",
    ]
    assert body["has_more"] is False

    r = auth_http.get(f"{LIST}?q=alan", headers=_h(S2S_CURRENT))
    assert [u["display_name"] for u in r.json()["users"]] == [
        "Alan Turing"
    ]

    r = auth_http.get(f"{LIST}?limit=1", headers=_h(S2S_CURRENT))
    body = r.json()
    assert len(body["users"]) == 1 and body["has_more"] is True

    r = auth_http.get(f"{LIST}?q=a", headers=_h(S2S_CURRENT))
    assert r.status_code == 422  # min uzunluk 2
