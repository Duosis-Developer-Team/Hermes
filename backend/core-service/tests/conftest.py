# =============================================================================
# HERMES core-service tests - shared fixtures
# =============================================================================
# Onemli: env degiskenleri APP IMPORT'UNDAN ONCE ayarlanmalidir —
# shared/auth.py modul yuklenirken JWT_PUBLIC_KEY yoksa sys.exit(1) yapar.
# DB'ye BAGLANILMAZ: TestClient lifespan calistirmaz (context manager
# olarak kullanilmadigi surece), create_engine lazy'dir.
# =============================================================================

import os
import sys

# core-service koku (`app` paketi) + backend koku (`shared` paketi —
# Docker'da image'a kopyalanir; lokalde backend/shared'ten cozulur.
# NOT: core-service/shared BOS bir klasordur, backend koku ONCE gelmeli
# ki gercek `shared` paketi onu golgede biraksin).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.dirname(_ROOT)
for _p in (_ROOT, _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# shared/auth.py'nin modul-yuklenme kontrolu icin dummy anahtar (yalnizca
# saklanir; testler JWT dogrulamasi yapmaz). DEBUG bilerek AYARLANMAZ —
# default False, internal OpenAPI hardening'i bu modda test ediyoruz.
os.environ.setdefault("JWT_PUBLIC_KEY", "test-only-not-a-real-key")
