# =============================================================================
# HERMES — Dalga D3: bilgi bankasi / yardim merkezi
# =============================================================================
#   Ajan tum makaleleri gorur (taslak + ekip ici); yazmak yapilandirma ister.
#   Musteri YALNIZ yayinda + musteriye acik makaleyi gorur (digerleri 404).
#   Arama/oneri TR karakter duyarsiz; oy okuyucu basina tek ve degisebilir.
# =============================================================================

import uuid

from .conftest import OTHER_TENANT_ID, THIRD_TENANT_ID

HUB_KB = "/api/v1/core/tickets/kb"
HELP = "/api/v1/core/support/kb"


def _seed(api, world):
    admin = api(world["admin"])
    cat = admin.post(f"{HUB_KB}/categories", json={"name": "Hesap"}).json()
    empty = admin.post(f"{HUB_KB}/categories", json={"name": "Faturalama"}).json()

    def article(**body):
        response = admin.post(f"{HUB_KB}/articles", json={"category_id": cat["id"], **body})
        assert response.status_code == 201, response.text
        return response.json()

    return {
        "cat": cat, "empty": empty,
        "public": article(title="Şifre sıfırlama", summary="Şifrenizi unuttuysanız",
                          body="1. Giriş ekranında **Şifremi unuttum**'a tıklayın.",
                          status="published", audience="public", keywords=["parola", "giriş"]),
        "internal": article(title="İç prosedür: hesap kilidi", body="Yalnız ekip.",
                            status="published", audience="internal"),
        "draft": article(title="Taslak: SSO", body="Henüz hazır değil.", status="draft"),
    }


def test_writing_needs_config_and_agents_see_everything(api, ticket_world):
    assert api(ticket_world["agent_a"]).post(f"{HUB_KB}/articles", json={"title": "x"}).status_code == 403
    seeded = _seed(api, ticket_world)
    agent = api(ticket_world["agent_a"])
    titles = {a["title"] for a in agent.get(f"{HUB_KB}/articles").json()}
    assert {"Şifre sıfırlama", "İç prosedür: hesap kilidi", "Taslak: SSO"} <= titles
    found = agent.get(f"{HUB_KB}/articles", params={"q": "SIFRE"}).json()      # TR katlama
    assert [a["id"] for a in found] == [seeded["public"]["id"]]
    bad = api(ticket_world["admin"]).post(f"{HUB_KB}/articles", json={
        "title": "Bos", "status": "published", "body": "  "})
    assert bad.status_code == 422


def test_customers_see_only_published_public_articles(api, ticket_world):
    seeded = _seed(api, ticket_world)
    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    listed = customer.get(f"{HELP}/articles").json()
    assert [a["id"] for a in listed] == [seeded["public"]["id"]]
    cats = customer.get(f"{HELP}/categories").json()
    assert [c["name"] for c in cats] == ["Hesap"] and cats[0]["article_count"] == 1
    for key in ("internal", "draft"):
        assert customer.get(f"{HELP}/articles/{seeded[key]['id']}").status_code == 404
    assert customer.get(f"{HELP}/articles/{uuid.uuid4()}").status_code == 404


def test_suggestions_views_and_votes(api, ticket_world):
    seeded = _seed(api, ticket_world)
    customer = api(ticket_world["customer"], OTHER_TENANT_ID)
    # Turkce ekler: "parolamı" → kok "parol" anahtar kelime "parola"ya uyar.
    suggested = customer.get(f"{HELP}/suggest", params={"q": "Parolamı hatırlamıyorum"}).json()
    assert [a["id"] for a in suggested] == [seeded["public"]["id"]]
    assert customer.get(f"{HELP}/suggest", params={"q": "fatura kesilmedi"}).json() == []
    suggested = customer.get(f"{HELP}/suggest", params={"q": "sifremi unuttum"}).json()
    assert [a["id"] for a in suggested] == [seeded["public"]["id"]]

    detail = customer.get(f"{HELP}/articles/{seeded['public']['id']}").json()
    assert detail["view_count"] == 1 and detail["my_vote"] is None
    yes = customer.post(f"{HELP}/articles/{detail['id']}/vote", json={"helpful": True}).json()
    assert (yes["helpful_yes"], yes["helpful_no"], yes["my_vote"]) == (1, 0, True)
    no = customer.post(f"{HELP}/articles/{detail['id']}/vote", json={"helpful": False}).json()
    assert (no["helpful_yes"], no["helpful_no"], no["my_vote"]) == (0, 1, False)


def test_unconnected_workspace_has_no_help_center(api, ticket_world):
    _seed(api, ticket_world)
    user = uuid.uuid4()
    ticket_world["grants"][str(user)] = ["tickets.access"]
    assert api(user, THIRD_TENANT_ID).get(f"{HELP}/articles").status_code == 404
