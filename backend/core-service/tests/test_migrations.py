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
import shutil
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


# =============================================================================
# Nesne devri (01_adopt_objects.sql) — eklenti filtresi
# =============================================================================
# Bu betik canli bir engelden dogdu: eski Hermes semayi superuser `hermes`
# adina yaratmisti, migrator onlarin sahibi degildi ve migration
# "must be owner of function assign_task_type_number" ile kirildi.
#
# Betigin EN KRITIK parcasi eklenti filtresidir. core_db'de TimescaleDB
# kurulu ve `public` semasinda 100'den fazla fonksiyonu var; onlari
# devretmek eklentiyi ve `pg_dump`'i bozar. Filtre yanlissa hata canlida
# ve geri donusu zor sekilde ortaya cikar — bu yuzden gercek bir eklentiyle
# sinaniyor, taklitle degil.

_ADOPT_SQL = (_REPO_ROOT / "backend" / "sql_scripts" / "roles"
              / "01_adopt_objects.sql")


def _generator_selects(migrator: str):
    """Betikteki iki uretici SELECT'i psql meta-komutlari olmadan doner.

    `\\gexec` bir psql ozelligidir; SQLAlchemy calistiramaz. Ama ASIL
    MANTIK uretici SELECT'tedir — `\\gexec` yalnizca ciktiyi kosar. Testi
    SELECT uzerinde kurmak, psql istemcisine bagimli olmadan tam olarak
    dogru seyi sinar.
    """
    raw = _ADOPT_SQL.read_text(encoding="utf-8")
    # Yorumlari ONCE atiyoruz: aciklama metni de `\gexec` kelimesini
    # geciriyor ve once bolersek yanlis yerden kesiliyor.
    code = "\n".join(ln for ln in raw.splitlines()
                     if not ln.strip().startswith("--"))
    selects = []
    for chunk in code.split("\\gexec")[:2]:
        upper = chunk.upper()
        assert "SELECT" in upper, chunk
        stmt = chunk[upper.index("SELECT"):]
        selects.append(stmt.replace(":migrator_lit", f"'{migrator}'"))
    assert len(selects) == 2, "iki uretici SELECT bekleniyor"
    return selects


def test_adopt_script_transfers_app_objects_but_spares_extensions(pg_engine):
    """Uygulama nesnesi DEVREDILIR, eklenti nesnesi ASLA."""
    from sqlalchemy import text

    migrator = "adopt_test_migrator"
    with pg_engine.connect() as conn:
        conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.exec_driver_sql(
            f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles "
            f"WHERE rolname='{migrator}') THEN CREATE ROLE {migrator}; "
            f"END IF; END $$")
        # Gercek bir eklenti: `public` semasina onlarca fonksiyon koyar.
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS pgcrypto "
                             "WITH SCHEMA public")
        # Uygulama nesnesi — BASKASINA ait (canlidaki `hermes` durumu).
        conn.exec_driver_sql(
            "CREATE OR REPLACE FUNCTION adopt_probe() RETURNS int AS "
            "$$ SELECT 1 $$ LANGUAGE sql")
        conn.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS adopt_probe_tbl (id int)")
        conn.commit()

        generated = []
        for stmt in _generator_selects(migrator):
            generated += [r[0] for r in conn.execute(text(stmt)).all()]

    joined = "\n".join(generated)

    # 1) Uygulama nesneleri devredilmeli.
    assert "adopt_probe()" in joined, joined
    assert "adopt_probe_tbl" in joined, joined

    # 2) Eklenti nesnesi ASLA devredilmemeli. pgcrypto'nun `gen_salt`i
    #    `public`te ve sahibi migrator DEGIL — filtre olmasa listeye girerdi.
    assert "gen_salt" not in joined, (
        "Eklenti fonksiyonu devir listesine girdi — bu, canlida "
        "TimescaleDB'yi bozardi.")
    assert "digest" not in joined, joined


def test_migrations_path_is_derived_in_exactly_one_place():
    """Yol turetimi TEK yerde olmali — `resolve_script_location`.

    Bu test bir hatadan degil, hatanin TEKRARINDAN dogdu. Konteyner
    yerlesimi sorunu once `migration_runner`da duzeltildi; `schema_guard`
    yolu KENDI kopyasiyla kuruyordu ve unutuldu. Migration gecti ama
    pod'lar acilmadi:

        CommandError: Path doesn't exist: '/app/core-service/app/migrations'

    Ikinci bir kopya, iki yerlesimin ayrisabilecegi ikinci bir yerdir.
    Yeni bir modul yolu elle kurarsa bu test kirilir.
    """
    shared = _REPO_ROOT / "backend" / "shared"
    offenders = []
    for path in sorted(shared.glob("*.py")):
        if path.name == "migration_runner.py":
            continue          # turetimin OTORITER yeri burasi
        # Yorumlari at: aciklama metinleri yollari ORNEK olarak anar,
        # bu bir ihlal degildir. Ihlal, KODUN yolu kurmasidir.
        code = "\n".join(ln for ln in path.read_text(encoding="utf-8").splitlines()
                         if not ln.lstrip().startswith("#"))
        if "SCRIPT_LOCATIONS" in code or "app/migrations" in code:
            offenders.append(path.name)
    assert not offenders, (
        f"{offenders} migration yolunu kendisi turetiyor. "
        "`migration_runner.resolve_script_location()` kullanin — o, repo ve "
        "image yerlesimlerini birlikte bilir ve kimlik kanitini dogrular."
    )


def _repo_head_revision(service: str) -> str:
    """Servisin head revizyonunu REPO'dan turetir.

    Sabit yazmak cazip ama yanlis: her mesru migration testi kirardi ve
    zamanla "guncelle gecsin" refleksine donusurdu. Head, zincirin
    kendisinden hesaplanir — tek kaynak.
    """
    import re as _re

    vdir = (_REPO_ROOT / "backend" / f"{service}-service" / "app"
            / "migrations" / "versions")
    revisions, parents = set(), set()
    for f in vdir.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        rev = _re.search(r'^revision = "([^"]+)"', text, _re.M)
        down = _re.search(r'^down_revision = "([^"]+)"', text, _re.M)
        if rev:
            revisions.add(rev.group(1))
        if down:
            parents.add(down.group(1))
    heads = revisions - parents
    assert len(heads) == 1, f"{service}: tek head bekleniyor, bulunan {heads}"
    return heads.pop()


@pytest.mark.parametrize("service", ["core", "auth"])
def test_schema_guard_resolves_head_in_image_layout(tmp_path, service):
    """Sema muhafizi KONTEYNER yerlesiminde de head'i okuyabilmeli.

    Pod'lar canlida tam burada acilmadi: guard repo yerlesimini varsayip
    `/app/core-service/app/migrations` ariyordu; image'da migration'lar
    `/app/app/migrations`tadir.

    NEDEN SUBPROCESS: bu testin ilk hali `_backend_root`u monkeypatch
    ediyordu ve HATAYI YAKALAYAMIYORDU — eski kod o fonksiyonu hic
    cagirmiyor, `Path(__file__)`den gidiyordu ve repo agacinda dogru
    dizini buluyordu. Yani test, uretimde patlayan kodu yesil gosteriyordu.
    Tek durust yol, konteyner dosya duzenini GERCEKTEN kurup importu
    izole bir process'te yapmaktir — Dockerfile ne kopyaliyorsa o.
    """
    import subprocess
    import sys

    root = tmp_path / "imgroot"
    (root).mkdir()
    shutil.copytree(_REPO_ROOT / "backend" / "shared", root / "shared")
    shutil.copytree(_REPO_ROOT / "backend" / f"{service}-service" / "app",
                    root / "app")
    # Konteynerde `<svc>-service/` diye bir dizin YOKTUR.
    assert not (root / f"{service}-service").exists()

    proc = subprocess.run(
        [sys.executable, "-c",
         "from shared.schema_guard import _script_head_revisions;"
         f"print(sorted(_script_head_revisions('{service}'))[0])"],
        cwd=str(root),
        env={**os.environ, "HERMES_SERVICE": service,
             "PYTHONPATH": str(root),
             "JWT_PUBLIC_KEY": "test-only-not-a-real-key"},
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"guard konteyner yerlesiminde head okuyamadi:\n{proc.stderr[-800:]}")
    assert _repo_head_revision(service) in proc.stdout, proc.stdout


# =============================================================================
# Ortam adresleri — yanlis hostname LOGIN'I TAMAMEN KAPATIR
# =============================================================================
# Tenant cozumu Host basligina bakar; eslesme yoksa fail-closed 404
# `workspace_not_found` doner. Yani `INITIAL_TENANT_HOSTNAME` yanlissa
# ortamda hic kimse giris YAPAMAZ — ne parola ne SSO. Canlida tam olarak
# bu oldu: hermes-dev ConfigMap'ine test ortaminin adresi yazilmisti.

_DEV_HOST = "84.247.180.172"
_TEST_HOST = "hermes.duosis.com"


def _configmap_value(path, key):
    import re as _re
    text = (_REPO_ROOT / path).read_text(encoding="utf-8")
    m = _re.search(rf'^\s*{key}:\s*"?([^"\n]+)"?\s*$', text, _re.M)
    return m.group(1).strip() if m else None


def test_dev_configmap_does_not_carry_test_hostname():
    """dev ConfigMap'i test ortaminin adresini TASIYAMAZ."""
    value = _configmap_value("k8s/01-configmap.yaml", "INITIAL_TENANT_HOSTNAME")
    assert value, "dev ConfigMap'inde INITIAL_TENANT_HOSTNAME yok"
    assert value != _TEST_HOST, (
        f"dev ConfigMap'i test adresini ({_TEST_HOST}) tasiyor. Tenant "
        "cozumu Host'a bakar; dev'e bu adresle GELINMEZ ve login tamamen "
        "kapanir (workspace_not_found)."
    )
    assert value == _DEV_HOST, (
        f"dev icin beklenen adres {_DEV_HOST}, bulunan: {value}")


def test_test_configmap_does_not_carry_dev_hostname():
    """Simetrik kapi: test ConfigMap'i de dev adresini tasiyamaz.

    `k8s/test/01-configmap.yaml` bu calismada DEGISTIRILMEDI; burasi
    yalnizca ileride tenant anahtarlari oraya eklenirse yanlis ortamin
    adresinin kopyalanmasini engeller.
    """
    value = _configmap_value("k8s/test/01-configmap.yaml",
                             "INITIAL_TENANT_HOSTNAME")
    if value is None:
        pytest.skip("test ConfigMap'inde tenant anahtari yok (beklenen)")
    assert value != _DEV_HOST, (
        f"test ConfigMap'i dev adresini ({_DEV_HOST}) tasiyor.")


# =============================================================================
# Platform duzlemi ingress'te yayinlanmis mi
# =============================================================================
# Router, frontend ve ingress UC AYRI yerde ayni yol onekini tekrar eder.
# Ingress'te kural yoksa istek frontend'in nginx'ine duser ve POST icin
# 405 doner — Platform Console tarayicidan ERISILEMEZ olur. Kod, testler
# ve rollout kusursuzken canlida tam olarak boyle bulundu.

def test_platform_api_prefix_is_consistent_across_layers():
    """Router · frontend · ingress ayni oneki kullanmali."""
    import re as _re

    router_src = (_REPO_ROOT / "backend" / "auth-service" / "app" / "routers"
                  / "platform_admin.py").read_text(encoding="utf-8")
    m = _re.search(r'APIRouter\(prefix="([^"]+)"', router_src)
    assert m, "platform router prefix'i okunamadi"
    prefix = m.group(1)                       # ornek: /api/platform/v1

    api_src = (_REPO_ROOT / "frontend" / "src" / "api" / "platformApi.js"
               ).read_text(encoding="utf-8")
    assert f"'{prefix}'" in api_src, (
        f"frontend BASE'i router prefix'i ({prefix}) ile uyusmuyor")

    ingress = (_REPO_ROOT / "k8s" / "05-ingress.yaml").read_text(encoding="utf-8")
    # Ingress oneki daha KISA olabilir (Prefix eslesmesi), ama router
    # yolunu KAPSAMALI.
    paths = _re.findall(r'^\s*- path:\s*(\S+)', ingress, _re.M)
    covering = [p for p in paths if prefix.startswith(p) and p != "/"]
    assert covering, (
        f"k8s/05-ingress.yaml '{prefix}' yolunu kapsayan bir kural "
        f"icermiyor (bulunanlar: {paths}). Kural olmadan istek frontend'e "
        "duser ve Platform Console erisilemez olur."
    )
    # En spesifik kapsayan kural auth-service'e gitmeli.
    best = max(covering, key=len)
    block = ingress.split(f"- path: {best}", 1)[1][:400]
    assert "auth-service" in block, (
        f"'{best}' kurali auth-service'e yonlenmiyor — platform duzlemi "
        "auth-service'te yasar.")


def test_env_settings_read_by_code_are_wired_into_manifests():
    """Kodun okudugu her HERMES_* ayari bir Deployment'ta BAGLI olmali.

    Bu test canli bir hatadan dogdu: `HERMES_ALLOW_WORKSPACE_PATH`
    ConfigMap'te vardi, kod da `os.getenv` ile okuyordu — ama hicbir
    Deployment onu pod'a baglamamisti. Ayar bastan beri ETKISIZDI ve
    yeni bir tenant'a ulasilamiyordu; istek sessizce varsayilan host
    eslesmesine dusuyordu. ConfigMap'e anahtar eklemek TEK BASINA
    hicbir sey yapmaz.
    """
    import re as _re

    manifests = "\n".join(
        f.read_text(encoding="utf-8")
        for f in (_REPO_ROOT / "k8s").rglob("*.yaml")
    )

    # Kodun GERCEKTEN okudugu ayarlar.
    read: set = set()
    for svc in ("auth-service", "core-service"):
        for f in (_REPO_ROOT / "backend" / svc / "app").rglob("*.py"):
            src = f.read_text(encoding="utf-8")
            read |= set(_re.findall(r'os\.getenv\(\s*"(HERMES_[A-Z0-9_]+)"', src))
            read |= set(_re.findall(r'os\.environ\[\s*"(HERMES_[A-Z0-9_]+)"', src))

    # Yalnizca CD/Job tarafindan verilenler haric (pod ortaminda yasamaz).
    runtime_only = {
        "HERMES_INITIAL_TENANT_ID",       # migration adimlari arasi aktarim
        "HERMES_MIGRATION_LOCK_TIMEOUT",  # migration ayari (varsayilanli)
        "HERMES_MIGRATION_STATEMENT_TIMEOUT",
        "HERMES_SERVICE",                 # Dockerfile ENV damgasi
        "HERMES_BOOTSTRAP_ADMIN_PASSWORD",  # tek seferlik bootstrap
    }
    unwired = sorted(
        name for name in read - runtime_only
        if f"key: {name}" not in manifests and f"name: {name}" not in manifests
    )
    assert not unwired, (
        f"Kod su ayar(lar)i okuyor ama hicbir manifest pod'a baglamiyor: "
        f"{unwired}. ConfigMap'e anahtar yazmak yetmez — Deployment'ta "
        "`env:` girdisi olmadan uygulama o degeri HIC gormez."
    )


def test_workflow_files_are_valid_yaml_and_complete():
    """CI is akislari GECERLI YAML olmali ve gerekli kapilari icermeli.

    Bu test bir hatadan dogdu: `cd-test.yml`'a yaptigim bir duzenleme,
    bir adimi shell BLOGUNUN ICINE dusurdu ve YAML'i kirdi. GitHub
    gecersiz bir is akisi icin adi yerine DOSYA YOLUNU gosterip her
    push'ta kirmizi bir kosu uretir — ve o dal ARTIK DEPLOY ETMEZ.
    Sessiz degil ama kolayca "baska bir sey kirilmis" diye okunur;
    hermes-test iki commit boyunca guncellenmedi.

    Yerelde `yaml.safe_load` ile dogrulamak saniyeler suruyor; CI'a
    bagimli kalmak yerine burada kilitleniyor.
    """
    import yaml

    wf_dir = _REPO_ROOT / ".github" / "workflows"
    files = sorted(wf_dir.glob("*.yml"))
    assert files, "is akisi dosyasi bulunamadi"

    for f in files:
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:  # noqa: PERF203
            raise AssertionError(f"{f.name} GECERSIZ YAML: {exc}") from exc

        assert doc.get("name"), f"{f.name}: `name` yok (GitHub yolu gosterir)"
        assert doc.get("jobs"), f"{f.name}: job yok"

        # Sema kapisi: migration adimi OLMADAN deploy, migrate edilmemis
        # bir veritabanina pod cikarir.
        text = f.read_text(encoding="utf-8")
        if "set image" in text:
            assert "run-migration-job.sh" in text, (
                f"{f.name}: deploy ediyor ama migration kapisi YOK"
            )
            assert "post-deploy-tenant-smoke.sh" in text, (
                f"{f.name}: deploy ediyor ama tenant duman testi YOK"
            )

        # Her `run:` bloğu bir ADIM seviyesinde olmali; shell blogunun
        # icine dusmus bir adim YAML'i sessizce bozar.
        for job in doc["jobs"].values():
            for step in job.get("steps", []):
                assert isinstance(step, dict), f"{f.name}: bozuk adim: {step!r}"
