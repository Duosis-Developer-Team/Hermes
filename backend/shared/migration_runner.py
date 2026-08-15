# =============================================================================
# HERMES PLATFORM - Otoriter migration calistiricisi (WS1)
# =============================================================================
# Tenant cutover'indan ONCE sema degisiklikleri uygulama startup'inda
# yapiliyordu (core-service/app/main.py icinde 13 ad-hoc `_migrate_*`
# fonksiyonu + create_all). Cok podlu bir deployment'ta bu, ayni DDL'i
# es zamanli kosan podlar demektir — tenant cutover'i icin kabul edilemez.
#
# Bu modul iki seyi garanti eder:
#   1) Sema degisiklikleri YALNIZCA burasi uzerinden, versiyonlu Alembic
#      revizyonlariyla uygulanir (auth ve core icin AYRI branch'ler).
#   2) Ayni anda yalnizca TEK bir migration kosar — PostgreSQL session
#      advisory lock'u ile (pod'lar/Job'lar yarissa bile).
#
# Calistirma (K8s Job veya lokal):
#   python -m shared.migration_runner auth
#   python -m shared.migration_runner core
#   python -m shared.migration_runner all      # auth -> core (sirali)
#
# Roller: migration MIGRATOR rolu ile kosar (tablolarin sahibi). Uygulama
# pod'lari NOBYPASSRLS, tablo sahibi OLMAYAN runtime rolunu kullanir.
# Bkz. backend/sql_scripts/roles/README.md
# =============================================================================

from __future__ import annotations

import logging
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

# Servis basina sabit advisory lock anahtari. Deger keyfi ama STABIL
# olmali: ayni anahtari isteyen ikinci kosu birincisi bitene kadar bekler.
ADVISORY_LOCK_KEYS = {
    "auth": 0x48524D53_41555448 & 0x7FFFFFFFFFFFFFFF,  # "HRMSAUTH"
    "core": 0x48524D53_434F5245 & 0x7FFFFFFFFFFFFFFF,  # "HRMSCORE"
}

# Her servisin Alembic script dizini, backend kokune gore.
SCRIPT_LOCATIONS = {
    "auth": ("auth-service", "app/migrations"),
    "core": ("core-service", "app/migrations"),
}


class MigrationError(RuntimeError):
    """Migration uygulanamadi — CD bu noktada DURMALIDIR."""


# =============================================================================
# Baglanti URL cozumu
# =============================================================================

def resolve_database_url(service: str) -> str:
    """Migrator rolunun baglanti URL'ini cozer.

    Oncelik sirasi:
      1) HERMES_{SERVICE}_MIGRATION_DATABASE_URL  (Job'a verilen tam URL)
      2) HERMES_MIGRATION_DATABASE_URL            (tek servisli Job)
      3) Servisin kendi ayarlarindan MIGRATOR kullanicisi ile turetilen URL
      4) Servisin normal runtime URL'i (yalnizca lokal gelistirme/test)

    (4) production'da KULLANILMAMALIDIR; runtime rolu tablo sahibi
    olmadigi icin DDL yetkisi zaten yoktur ve migration hata verir —
    bu, sessiz yanlis-rol kullanimindan iyidir.
    """
    service = service.lower()
    explicit = os.getenv(f"HERMES_{service.upper()}_MIGRATION_DATABASE_URL")
    if explicit:
        return explicit
    generic = os.getenv("HERMES_MIGRATION_DATABASE_URL")
    if generic:
        return generic

    settings = _load_settings(service)
    migrator_user = os.getenv(f"{service.upper()}_DB_MIGRATOR_USER")
    migrator_password = os.getenv(f"{service.upper()}_DB_MIGRATOR_PASSWORD")
    if migrator_user and migrator_password:
        host = getattr(settings, f"{service.upper()}_DB_HOST")
        port = getattr(settings, f"{service.upper()}_DB_PORT")
        name = getattr(settings, f"{service.upper()}_DB_NAME")
        return (
            f"postgresql://{migrator_user}:{migrator_password}"
            f"@{host}:{port}/{name}"
        )
    return settings.database_url


def _load_settings(service: str):
    """Servisin Settings nesnesini import eder (path servis koku olmali)."""
    from app.config import get_settings  # noqa: WPS433 — servise gore cozulur

    return get_settings()


# =============================================================================
# Advisory lock
# =============================================================================

@contextmanager
def migration_lock(connection, service: str) -> Iterator[None]:
    """Servise ozel session advisory lock'u tutar.

    `pg_advisory_lock` BLOKLAR: ikinci kosu birincinin bitmesini bekler,
    yaris yerine siraya girer. Lock session'a baglidir; baglanti
    kapaninca (veya asagidaki unlock ile) birakilir.
    """
    from sqlalchemy import text

    key = ADVISORY_LOCK_KEYS[service]
    logger.info("migration lock isteniyor", extra={"service": service})
    connection.execute(text("SELECT pg_advisory_lock(:k)"), {"k": key})
    try:
        yield
    finally:
        connection.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        logger.info("migration lock birakildi", extra={"service": service})


# ALTER TABLE, tabloya ACCESS EXCLUSIVE kilidi ister. Uzun suren tek bir
# transaction (orn. unutulmus "idle in transaction" baglanti) migration'i
# SINIRSIZ bekletebilir — ve o sirada ALTER, arkasina normal trafigi de
# kuyruklar; yani "yavas deploy" sessizce "kilitli veritabani"na doner.
# Fail-fast tercih ediyoruz: bekleyip kuyruk buyutmektense hata verip
# CD'yi durdurmak, hem teshis edilebilir hem geri alinabilir.
LOCK_TIMEOUT = os.getenv("HERMES_MIGRATION_LOCK_TIMEOUT", "10s")
STATEMENT_TIMEOUT = os.getenv("HERMES_MIGRATION_STATEMENT_TIMEOUT", "300s")


def migration_connect_args() -> dict:
    """Timeout'lari BAGLANTI acilirken uygular (libpq `options`).

    Neden `SET` DEGIL: SQLAlchemy 2.0'da `connection.execute("SET ...")`
    ortuk bir transaction ACAR. Alembic'in kendi transaction yonetimi
    bunun ustune biner ve baglanti commit edilmeden kapandigi icin TUM
    DDL sessizce geri alinir — migration "basarili" gorunur ama tek bir
    tablo bile yaratilmaz. (Bu tuzaga bir kez dusuldu; testler yakaladi.)

    Baglanti secenegi olarak verilince transaction durumu hic etkilenmez.
    """
    return {
        "options": (
            f"-c lock_timeout={LOCK_TIMEOUT} "
            f"-c statement_timeout={STATEMENT_TIMEOUT}"
        )
    }


# =============================================================================
# Alembic kosumu
# =============================================================================

def _backend_root() -> Path:
    """`backend/` dizini — bu dosya backend/shared/ icinde yasar."""
    return Path(__file__).resolve().parent.parent


def build_alembic_config(service: str, database_url: str):
    """alembic.ini olmadan, programatik Config uretir."""
    from alembic.config import Config

    svc_dir, rel = SCRIPT_LOCATIONS[service]
    script_location = _backend_root() / svc_dir / rel
    if not script_location.is_dir():
        raise MigrationError(
            f"Alembic script dizini bulunamadi: {script_location}"
        )

    cfg = Config()
    cfg.set_main_option("script_location", str(script_location))
    # URL'i Config'e YAZMIYORUZ (loglara/`__repr__`'a sifre sizmasin);
    # env.py bunu attribute uzerinden okur.
    cfg.attributes["database_url"] = database_url
    cfg.attributes["service"] = service
    return cfg


def upgrade(service: str, revision: str = "head",
            database_url: Optional[str] = None) -> None:
    """Tek servisi hedef revizyona yukseltir (advisory lock altinda)."""
    from alembic import command
    from sqlalchemy import create_engine

    service = service.lower()
    if service not in SCRIPT_LOCATIONS:
        raise MigrationError(f"Bilinmeyen servis: {service}")

    url = database_url or resolve_database_url(service)
    cfg = build_alembic_config(service, url)

    engine = create_engine(url, pool_pre_ping=True, future=True)
    try:
        with engine.connect() as lock_conn:
            with migration_lock(lock_conn, service):
                cfg.attributes["connection"] = None
                command.upgrade(cfg, revision)
    finally:
        engine.dispose()
    logger.info("migration tamam", extra={"service": service,
                                          "revision": revision})


def current_revision(service: str,
                     database_url: Optional[str] = None) -> Optional[str]:
    """DB'deki mevcut revizyonu doner (yoksa None)."""
    from sqlalchemy import create_engine
    from alembic.migration import MigrationContext

    url = database_url or resolve_database_url(service.lower())
    engine = create_engine(url, pool_pre_ping=True, future=True)
    try:
        with engine.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()


# =============================================================================
# CLI
# =============================================================================

def _prepare_sys_path(service: str) -> None:
    """Servisin `app` paketini import edilebilir hale getirir."""
    svc_dir, _ = SCRIPT_LOCATIONS[service]
    root = _backend_root()
    for candidate in (str(root / svc_dir), str(root)):
        if candidate not in sys.path:
            sys.path.insert(0, candidate)


def _run_single(service: str, revision: str) -> int:
    """Tek servisi BU process icinde yukseltir."""
    _prepare_sys_path(service)
    print(f"→ {service}: migration basliyor (hedef={revision})", flush=True)
    try:
        upgrade(service, revision)
    except Exception as exc:  # noqa: BLE001 — CD'yi durdurmak icin
        # Sifre/URL asla yazdirilmaz; yalniz hata tipi ve mesaji.
        print(f"FATAL: {service} migration BASARISIZ: "
              f"{type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1
    print(f"✅ {service}: migration tamam "
          f"(revision={current_revision(service)})", flush=True)
    return 0


def main(argv: Optional[list] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = list(argv if argv is not None else sys.argv[1:])
    target = (args[0] if args else "all").lower()
    revision = args[1] if len(args) > 1 else "head"

    services = ["auth", "core"] if target == "all" else [target]
    for svc in services:
        if svc not in SCRIPT_LOCATIONS:
            print(f"FATAL: bilinmeyen migration hedefi: {svc}",
                  file=sys.stderr)
            return 2

    if len(services) == 1:
        return _run_single(services[0], revision)

    # `all`: her servis AYRI bir process'te kosar. Iki servisin de kendi
    # `app` paketi vardir; tek process'te ikisini import etmek, ilk
    # import edilenin digerini golgelemesi demektir (auth'un `app`i
    # cache'te kalir, core'un migration modulu bulunamaz). Ayri process
    # bu karisikligi YAPISAL olarak imkansiz kilar.
    import subprocess

    env = dict(os.environ)
    for svc in services:
        result = subprocess.run(
            [sys.executable, "-m", "shared.migration_runner", svc, revision],
            cwd=str(_backend_root()),
            env=env,
        )
        if result.returncode != 0:
            return result.returncode
        if svc == "auth":
            # Ilk tenant'in kimligi auth_db'de URETILIR (0003). core'un
            # backfill'i ayni degeri kullanmak zorunda — iki veritabani
            # arasinda tek dogruluk kaynagi budur. Kodda UUID uydurmak
            # veya core'da ikinci bir tenant uretmek, verinin iki farkli
            # tenant'a bolunmesi demekti.
            tenant_id = _read_initial_tenant_id()
            if tenant_id:
                env["HERMES_INITIAL_TENANT_ID"] = tenant_id
                print(f"→ ilk tenant kimligi core'a aktarildi: {tenant_id}",
                      flush=True)
    return 0


def _read_initial_tenant_id() -> Optional[str]:
    """auth_db'den ilk tenant'in UUID'sini okur (yoksa None)."""
    from sqlalchemy import create_engine, text

    slug = os.getenv("HERMES_INITIAL_TENANT_SLUG", "duosis")
    try:
        url = resolve_database_url("auth")
    except Exception:  # noqa: BLE001 — ayarlar cozulemezse sessiz gec
        return None

    engine = create_engine(url, pool_pre_ping=True, future=True)
    try:
        with engine.connect() as conn:
            value = conn.execute(
                text("SELECT id FROM tenants WHERE slug = :s"),
                {"s": slug},
            ).scalar()
            return str(value) if value else None
    except Exception:  # noqa: BLE001 — tablo henuz yoksa (eski revizyon)
        return None
    finally:
        engine.dispose()


if __name__ == "__main__":  # pragma: no cover — CLI
    raise SystemExit(main())
