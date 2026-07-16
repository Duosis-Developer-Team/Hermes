# =============================================================================
# hermes-mcp - konfigurasyon (yalnizca env; dosya/DB yok)
# =============================================================================
# HERMES_PUBLIC_API_BASE tek upstream'dir (onayli egress kurali): kod
# hicbir istekte baska host'a cikamaz; base yalniz deployment'ta belirir.
# k8s Service dogrulandi: core-service portu 80 -> targetPort 8001.
# =============================================================================

import os

from . import __version__

SERVER_NAME = "hermes-mcp"
SERVER_VERSION = __version__

PUBLIC_API_BASE = os.environ.get(
    "HERMES_PUBLIC_API_BASE", "http://core-service/api/public/v1"
).rstrip("/")

# tools/list gorunurluk cache'i (ASLA yetkilendirme degil — onayli kural:
# kisa tutulur, gercek yetki HER cagrida Public API'de dogrulanir).
SCOPE_CACHE_TTL_SECONDS = float(
    os.environ.get("MCP_SCOPE_CACHE_TTL_SECONDS", "15")
)

# Liste araclari icin sayfa sinirlari (onayli D5-5).
DEFAULT_LIMIT = 25
MAX_LIMIT = 50

UPSTREAM_TIMEOUT_SECONDS = float(
    os.environ.get("MCP_UPSTREAM_TIMEOUT_SECONDS", "15")
)
