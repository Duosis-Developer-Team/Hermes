# =============================================================================
# WS1 — Migration cercevesi kapilari (core_db)
# =============================================================================
# Bu dosya, sema otoritesinin gercekten Alembic'te oldugunu MAKINE ile
# dogrular. Uc sinif kapi var:
#
#   1) Yapisal: uygulama startup'i artik DDL kosMAMALI.
#   2) Fonksiyonel: BOS veritabani -> head basarili olmali.
#   3) Idempotency: ayni migration ikinci kez kosunca hicbir sey
#      degismemeli (mevcut hermes-dev verisi ustunde guvenle kosar).
#
# Gercek Postgres gerekir; yoksa testler SKIP olur (foundation testleri
# etkilenmez) — conftest.py'deki TEST_DB_URL ile ayni sunucu kullanilir.
# =============================================================================

import os
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from .conftest import TEST_DB_URL

_ROOT = Path(__file__).resolve().parent.parent          # core-service/
_BACKEND = _ROOT.parent                                  # backend/


# =============================================================================
# 1) Yapisal kapi — startup'ta DDL YOK
# =============================================================================

def test_startup_runs_no_ddl():
    """main.py sema degistiren hicbir ifade icermemeli.

    Cok podlu bir rollout'ta startup DDL'i, ayni ALTER'i yarisan podlar
    demektir. Tenant cutover'i bunu kaldiramaz — bu yuzden yapisal
    olarak yasakliyoruz.
    """
    source = (_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    # Yorum satirlarini at: aciklama metinlerinde "create_all" gecebilir.
    code = "\n".join(
        line for line in source.splitlines()
        if not line.lstrip().startswith("#")
    )
    forbidden = [
        "create_all", "ALTER TABLE", "CREATE INDEX", "CREATE TABLE",
        "CREATE SEQUENCE", "DROP CONSTRAINT", "CREATE TRIGGER",
        "CREATE OR REPLACE FUNCTION",
    ]
    hits = [needle for needle in forbidden if needle in code]
    assert not hits, (
        f"main.py hala DDL iceriyor: {hits}. Sema degisiklikleri "
        "app/migrations/versions/ altina tasinmalidir."
    )


def test_database_module_exposes_no_schema_helpers():
    """init_db/drop_db gibi create_all kisayollari geri gelmemeli."""
    from app import database

    assert not hasattr(database, "init_db")
    assert not hasattr(database, "drop_db")


def test_single_migration_head():
    """Coklu head, hangi semanin gecerli oldugunu belirsizlestirir."""
    from alembic.script import ScriptDirectory

    script = ScriptDirectory(str(_ROOT / "app" / "migrations"))
    heads = script.get_heads()
    assert len(heads) == 1, f"Tek head bekleniyor, bulunan: {heads}"


# =============================================================================
# Yardimci: tek kullanimlik veritabani
# =============================================================================

@pytest.fixture()
def disposable_db():
    """Bu test icin tek kullanimlik bos bir veritabani yaratir."""
    admin_url = TEST_DB_URL
    name = f"hermes_mig_{uuid.uuid4().hex[:12]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT",
                          pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception:  # noqa: BLE001 — DB yoksa/yetki yoksa atla
        admin.dispose()
        pytest.skip("disposable veritabani yaratilamadi")

    yield re.sub(r"/[^/]+$", f"/{name}", admin_url)

    with admin.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = :n"
        ), {"n": name})
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    admin.dispose()


def _run_migration(url: str) -> None:
    import sys

    for path in (str(_ROOT), str(_BACKEND)):
        if path not in sys.path:
            sys.path.insert(0, path)
    from shared.migration_runner import upgrade

    upgrade("core", "head", database_url=url)


def _table_names(url: str) -> set:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            )).scalars().all()
    finally:
        engine.dispose()
    return set(rows)


# =============================================================================
# 2) Fonksiyonel kapi — bos DB -> head
# =============================================================================

def test_fresh_database_upgrades_to_head(disposable_db):
    """BOS veritabani, TUM ORM tablolarini iceren semaya yukselmeli."""
    _run_migration(disposable_db)

    import app.models  # noqa: F401
    from app.database import Base

    produced = _table_names(disposable_db)
    expected = set(Base.metadata.tables.keys())
    missing = expected - produced
    assert not missing, f"migration sonrasi eksik tablo: {sorted(missing)}"
    assert "alembic_version" in produced


def test_fresh_database_has_type_number_trigger(disposable_db):
    """Production paritesi: per-type numaralandirma trigger'i kurulmali."""
    _run_migration(disposable_db)

    engine = create_engine(disposable_db)
    try:
        with engine.connect() as conn:
            found = conn.execute(text(
                "SELECT 1 FROM pg_trigger "
                "WHERE tgname = 'trg_assign_type_number'"
            )).first()
    finally:
        engine.dispose()
    assert found is not None


# =============================================================================
# 3) Idempotency kapisi — ikinci kosu hicbir sey degistirmemeli
# =============================================================================

def test_migration_is_idempotent_and_preserves_rows(disposable_db):
    """Var olan veri ustunde ikinci kosu: satirlar ve kodlar AYNEN kalir.

    hermes-dev veritabani migration'i birden fazla kez gorebilir
    (retry, yeniden deploy). Task kodlarinin (TASK-56 gibi) yeniden
    numaralanmasi kabul edilemez.
    """
    _run_migration(disposable_db)

    engine = create_engine(disposable_db)
    customer_id = uuid.uuid4()
    project_id = uuid.uuid4()
    # Enforce fazindan sonra tenant_id ZORUNLUDUR — bu testin veri
    # kurulumu da gercek uretim davranisini yansitir.
    tenant_id = uuid.uuid4()
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenant_registry (tenant_id, slug, status, "
                "placement_key, source_version, provisioned_at, "
                "updated_at) VALUES (:t, 'idem-test', 'active', "
                "'shared-default', 1, now(), now())"
            ), {"t": tenant_id})
            conn.execute(text(
                "INSERT INTO customers (id, tenant_id, name, is_active, "
                "created_at) VALUES (:id, :t, 'Musteri', true, now())"
            ), {"id": customer_id, "t": tenant_id})
            conn.execute(text(
                "INSERT INTO projects (id, tenant_id, customer_id, name, "
                "is_active, created_at) "
                "VALUES (:id, :t, :cid, 'Proje', true, now())"
            ), {"id": project_id, "t": tenant_id, "cid": customer_id})
            for title, ttype in (("Gorev", "task"), ("Talep", "suggestion")):
                conn.execute(text(
                    "INSERT INTO tasks (id, tenant_id, customer_id, "
                    "project_id, title, assignee_user_id, "
                    "assigner_user_id, scheduled_date, task_type, "
                    "priority, status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :t, :cid, :pid, :ttl, "
                    "gen_random_uuid(), gen_random_uuid(), current_date, "
                    ":tt, 'medium', 'pending', now(), now())"
                ), {"t": tenant_id, "cid": customer_id, "pid": project_id,
                    "ttl": title, "tt": ttype})

        snapshot_sql = text(
            "SELECT task_type, task_number, type_number FROM tasks "
            "ORDER BY task_number"
        )
        with engine.connect() as conn:
            before = conn.execute(snapshot_sql).all()

        _run_migration(disposable_db)      # ikinci kosu
        _run_migration(disposable_db)      # ucuncu kosu

        with engine.connect() as conn:
            after = conn.execute(snapshot_sql).all()
            count = conn.execute(
                text("SELECT count(*) FROM tasks")
            ).scalar()
    finally:
        engine.dispose()

    assert count == 2
    assert before == after, (
        "migration tekrar kosunca task numaralari degisti — mevcut "
        "task kodlari bozulur"
    )


# =============================================================================
# 4) Sema uyumluluk kapisi
# =============================================================================

def test_schema_guard_rejects_unmigrated_database(disposable_db):
    """Migration kosMAMIS bir DB'ye karsi pod acilmamali."""
    import sys

    for path in (str(_ROOT), str(_BACKEND)):
        if path not in sys.path:
            sys.path.insert(0, path)
    from shared.schema_guard import (
        SchemaCompatibilityError, verify_schema_compatibility,
    )

    engine = create_engine(disposable_db)
    try:
        with pytest.raises(SchemaCompatibilityError):
            verify_schema_compatibility("core", engine)

        _run_migration(disposable_db)
        # head revizyon adi degistikce test kirilmasin.
        from alembic.script import ScriptDirectory

        heads = ScriptDirectory(
            str(_ROOT / "app" / "migrations")
        ).get_heads()
        assert verify_schema_compatibility("core", engine) in heads
    finally:
        engine.dispose()


# =============================================================================
# Image yerlesimi — "repoda calisir, konteynerde patlar" sinifi
# =============================================================================
# Bu testler CANLI bir hatadan dogdu. Migration Job'i tek image'la
# `migration_runner all` kosuyordu; repo agacinda
# `backend/auth-service/app/migrations` var oldugu icin her sey yesildi.
# Konteynerde ise Dockerfile `<svc>/app/` -> `./app/` kopyaladigindan o
# yol HIC yok ve rollout durdu. Yerel testler bu farki goremiyordu.

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _dockerfile(service: str) -> str:
    return (_REPO_ROOT / "backend" / f"{service}-service" / "Dockerfile"
            ).read_text(encoding="utf-8")


@pytest.mark.parametrize("service", ["auth", "core"])
def test_dockerfile_stamps_its_service_identity(service):
    """Her image kim oldugunu SOYLEMELI.

    Konteynerde iki servisin migration dizini de ayni yola duser
    (`/app/app/migrations`); ad ayirt edilemez. `HERMES_SERVICE` damgasi,
    runner'in "bu dizin gercekten bu servise mi ait?" sorusunu
    cevaplayabilmesinin TEK yoludur. Damga dusesse runner image
    yerlesimini reddeder ve migration hic kosmaz.
    """
    assert f"ENV HERMES_SERVICE={service}" in _dockerfile(service)


def test_image_layout_rejected_when_identity_mismatches(tmp_path, monkeypatch):
    """Yanlis image'da kosum sessizce KABUL EDILMEMELI.

    En tehlikeli senaryo: core image'inda `auth` hedefi kosulur, runner
    `/app/app/migrations`'i bulur ve CORE'un semasini AUTH veritabanina
    uygular. Geri donusu yok. Bu yuzden kimlik kaniti yoksa hata veririz —
    tahmin etmeyiz.
    """
    from shared import migration_runner as mr

    # Image yerlesimini taklit et: koke dogrudan `app/migrations`.
    (tmp_path / "app" / "migrations").mkdir(parents=True)
    monkeypatch.setattr(mr, "_backend_root", lambda: tmp_path)

    # 1) Damga YOK -> reddet
    monkeypatch.delenv("HERMES_SERVICE", raising=False)
    with pytest.raises(mr.MigrationError, match="REDDEDILDI"):
        mr.resolve_script_location("auth")

    # 2) Damga BASKA servis -> reddet
    monkeypatch.setenv("HERMES_SERVICE", "core")
    with pytest.raises(mr.MigrationError, match="REDDEDILDI"):
        mr.resolve_script_location("auth")

    # 3) Damga DOGRU -> kabul
    monkeypatch.setenv("HERMES_SERVICE", "auth")
    assert mr.resolve_script_location("auth") == tmp_path / "app" / "migrations"


def test_migration_job_runs_each_service_with_its_own_image():
    """Job tek image'a `all` dedirtMEMELI — canlida boyle kirilmisti."""
    import yaml

    raw = (_REPO_ROOT / "k8s" / "07-migration-job.yaml").read_text(
        encoding="utf-8")
    # Sablon degiskenlerini YAML'in anlayacagi hale getir.
    doc = yaml.safe_load(raw.replace("${", "").replace("}", ""))
    spec = doc["spec"]["template"]["spec"]

    steps = [(c["image"], c["command"][-1])
             for c in spec.get("initContainers", []) + spec["containers"]]

    assert not any(cmd == "all" for _, cmd in steps), (
        "`all` hedefi tek image'da iki servisin migration'inin bulundugunu "
        "varsayar; hicbir image ikisini de tasimaz."
    )
    for image, target in steps:
        assert f"hermes-{target}-service" in image, (
            f"'{target}' migration'i {image} ile kosuyor — o image bu "
            "servisin migration'larini tasimaz."
        )

    # auth ONCE kosmali: ilk tenant auth_db'de uretilir, core backfill'i
    # o UUID'yi kullanir.
    assert steps[0][1] == "auth" and steps[-1][1] == "core"

    # core, tenant kimligini auth_db'den sorgular -> auth URL'i sart.
    core_env = {e["name"] for e in spec["containers"][0]["env"]}
    assert "HERMES_AUTH_MIGRATION_DATABASE_URL" in core_env
