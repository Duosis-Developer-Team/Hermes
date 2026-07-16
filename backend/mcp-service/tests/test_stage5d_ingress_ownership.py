# =============================================================================
# hermes-mcp - Ingress SAHIPLIK MODELI kilidi (CTO karari, Stage 5)
# =============================================================================
# Karar: ayni host icin IKI Ingress kaynagi kullanilir —
#   05-ingress      → uygulama route'lari (/, /api/v1*, /api/public)
#   09-mcp-ingress  → YALNIZCA /mcp + /.well-known/oauth-protected-resource
#
# ingress-nginx (test: v1.9.6) ayni host'a ait birden fazla Ingress'i
# TEK server blogunda birlestirir. Bu guvenlidir, ANCAK sartlar:
#   1) Ayni (host, path) IKI kaynakta tanimlanamaz — cakisirsa controller
#      "en eski kazanir" davranisina duser ve sahiplik belirsizlesir.
#   2) Birlesecek kaynaklar AYNI ingressClassName'i kullanmali.
#   3) Ayni host icin TLS secret'i tutarli olmali (farkli secret = belirsiz
#      sertifika secimi).
# Bu test ucunu de kalici olarak dogrular; ihlal = CI kirmizi.
# =============================================================================

import pathlib

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[3]

MCP_PATHS = {"/mcp", "/.well-known/oauth-protected-resource"}

GROUPS = {
    "dev": ("k8s/05-ingress.yaml", "k8s/09-mcp-ingress.yaml"),
    "test": ("k8s/test/05-ingress.yaml", "k8s/test/09-mcp-ingress.yaml"),
}


def _ingresses(*rel_paths):
    out = []
    for rel in rel_paths:
        for doc in yaml.safe_load_all((REPO / rel).read_text()):
            if doc and doc.get("kind") == "Ingress":
                out.append((rel, doc))
    return out


@pytest.mark.parametrize("env", sorted(GROUPS))
def test_no_duplicate_host_path_ownership(env):
    owner = {}
    for rel, doc in _ingresses(*GROUPS[env]):
        name = doc["metadata"]["name"]
        for rule in doc["spec"]["rules"]:
            for p in rule["http"]["paths"]:
                key = (rule["host"], p["path"])
                assert key not in owner, (
                    f"{env}: {key} hem {owner.get(key)} hem {name} "
                    "tarafindan sahipleniliyor — birlesme belirsiz!"
                )
                owner[key] = name


@pytest.mark.parametrize("env", sorted(GROUPS))
def test_mcp_ingress_owns_only_mcp_paths(env):
    app_rel, mcp_rel = GROUPS[env]

    mcp_owned = {
        p["path"]
        for _, doc in _ingresses(mcp_rel)
        for rule in doc["spec"]["rules"]
        for p in rule["http"]["paths"]
    }
    assert mcp_owned == MCP_PATHS, f"{env}: MCP ingress kapsami kaydi"

    # MCP path'leri uygulama ingress'inde ASLA olmamali.
    app_owned = {
        p["path"]
        for _, doc in _ingresses(app_rel)
        for rule in doc["spec"]["rules"]
        for p in rule["http"]["paths"]
    }
    assert not (app_owned & MCP_PATHS), f"{env}: sahiplik sizmasi"
    # Uygulama tarafi kendi kritik route'larini korur.
    assert {"/", "/api/public"} <= app_owned, f"{env}: app route kaybi"


@pytest.mark.parametrize("env", sorted(GROUPS))
def test_mcp_paths_route_to_mcp_service(env):
    for _, doc in _ingresses(GROUPS[env][1]):
        for rule in doc["spec"]["rules"]:
            for p in rule["http"]["paths"]:
                svc = p["backend"]["service"]["name"]
                assert svc == "hermes-mcp", f"{env}: {p['path']} -> {svc}"


@pytest.mark.parametrize("env", sorted(GROUPS))
def test_shared_host_uses_same_class_and_tls(env):
    """Birlesme sarti: ayni host'u paylasan kaynaklar ayni ingressClass'i
    ve ayni TLS secret'ini kullanir."""
    classes, tls_by_host, hosts_by_res = {}, {}, {}
    for rel, doc in _ingresses(*GROUPS[env]):
        name = doc["metadata"]["name"]
        classes[name] = doc["spec"].get("ingressClassName")
        hosts_by_res[name] = {r["host"] for r in doc["spec"]["rules"]}
        for t in doc["spec"].get("tls", []):
            for h in t["hosts"]:
                prev = tls_by_host.setdefault(h, t["secretName"])
                assert prev == t["secretName"], (
                    f"{env}: {h} icin celisen TLS secret'i"
                )

    names = list(classes)
    shared = hosts_by_res[names[0]] & hosts_by_res[names[1]]
    assert shared, f"{env}: kaynaklar host paylasmiyor (beklenmiyor)"
    assert len(set(classes.values())) == 1, (
        f"{env}: paylasilan host farkli ingressClass'larda — "
        f"{classes} (birlesmez!)"
    )
