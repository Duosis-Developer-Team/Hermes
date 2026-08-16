# =============================================================================
# HERMES PLATFORM - Sema uyumluluk kapisi (WS1)
# =============================================================================
# Sema degisiklikleri artik uygulama startup'inda DEGIL, versiyonlu
# Alembic migration'lariyla (shared/migration_runner.py) uygulanir.
#
# Uygulama pod'unun tek sorumlulugu: KOSTUGU KODUN bekledigi sema
# versiyonu veritabaninda gercekten var mi? Degilse pod acilmaz.
# Bu FAIL-CLOSED bir karardir: yanlis sema uzerinde calisan bir servis,
# tenant cutover'i sirasinda sessizce yanlis veri yazabilir.
#
# CD sirasi bu yuzden zorunludur:  migration Job (bloklayan)  →  rollout.
# =============================================================================

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, Set

logger = logging.getLogger(__name__)


class SchemaCompatibilityError(RuntimeError):
    """Veritabani semasi bu kod surumuyle uyumsuz."""


def _script_head_revisions(service: str) -> Set[str]:
    """Kod tarafindaki head revizyon(lar)ini doner."""
    from alembic.script import ScriptDirectory

    # Yolu BURADA turetmiyoruz. Repo agaci ile konteyner yerlesimi
    # farklidir (`backend/<svc>-service/app/migrations` vs `/app/app/
    # migrations`) ve ikinci bir kopya, ikisinin ayrisabilecegi ikinci bir
    # yer demektir. Nitekim ayristi: migration_runner duzeltildi, buradaki
    # kopya unutuldu ve pod'lar canlida acilmadi
    # ("Path doesn't exist: /app/core-service/app/migrations").
    from .migration_runner import resolve_script_location

    script = ScriptDirectory(str(resolve_script_location(service)))
    return set(script.get_heads())


def db_revision(engine) -> Optional[str]:
    """Veritabanindaki mevcut Alembic revizyonu (yoksa None)."""
    from alembic.migration import MigrationContext

    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def verify_schema_compatibility(service: str, engine) -> str:
    """Sema versiyonunu dogrular; uyumsuzsa hata firlatir.

    Returns:
        Veritabanindaki gecerli revizyon.

    Raises:
        SchemaCompatibilityError: revizyon yok veya koddaki head degil.
    """
    heads = _script_head_revisions(service)
    current = db_revision(engine)

    if current is None:
        raise SchemaCompatibilityError(
            f"{service}: veritabaninda migration versiyonu YOK. "
            "Rollout oncesi migration Job'i calistirilmalidir "
            f"(python -m shared.migration_runner {service})."
        )
    if current not in heads:
        raise SchemaCompatibilityError(
            f"{service}: veritabani revizyonu ({current}) bu kod "
            f"surumunun bekledigi head ile ({', '.join(sorted(heads))}) "
            "eslesmiyor. Migration Job'i calistirilmalidir."
        )
    logger.info("sema uyumlu", extra={"service": service,
                                      "revision": current})
    return current
