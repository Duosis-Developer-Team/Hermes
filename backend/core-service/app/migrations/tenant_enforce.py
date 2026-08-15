# =============================================================================
# HERMES core-service — ENFORCE fazi: kisitlar + FORCE ROW LEVEL SECURITY
# =============================================================================
# Bu modul cutover'in geri donusu zor noktasidir (runbook §7). Buraya
# kadar her sey additive'di; burada:
#
#   1. `tenant_id` NOT NULL olur;
#   2. GLOBAL benzersizlikler TENANT-QUALIFIED hale gelir;
#   3. tenant-owned tablolar arasi FK'ler (tenant_id, id) uzerinden
#      COMPOSITE hale gelir — A'daki bir satir B'deki bir satiri
#      referans EDEMEZ;
#   4. her tenant tablosunda RLS ENABLE + FORCE + politika;
#   5. runtime rolune EN AZ yetki verilir.
#
# TEK KAYNAK ILKESI: tablo listesi, FK listesi ve unique listesi ELLE
# TUTULMAZ — PostgreSQL katalogundan ve `TenantOwnedMixin`den turetilir.
# Elle tutulan bir liste, yeni bir tablonun/FK'nin sessizce politika
# disinda kalmasi demekti (17_RISK_REGISTER §1: en kritik risk).
#
# BILINCLI KAPSAM SINIRI: yalnizca BUGUN VAR OLAN benzersizlik kurallari
# tenant-qualified hale getirilir. Bugun olmayan bir kural (orn.
# "musteri adi benzersiz olsun") EKLENMEZ: bu bir urun davranisi
# degisikligi olurdu ve mevcut veride cakisma varsa migration'i
# patlatirdi. Pack §4 matrisindeki bu tur satirlar backlog'dadir.
# =============================================================================

from __future__ import annotations

import logging
from typing import List, Tuple

from sqlalchemy import text

logger = logging.getLogger("hermes.migrations.enforce")

# RLS yardimcilarinin yasadigi kontrollu sema. `public` DEGIL: fonksiyon
# arama yolunun ele gecirilmesini zorlastirir.
SECURITY_SCHEMA = "hermes_sec"

# Tenant tablosu olmasina RAGMEN global benzersizligi KORUNAN kolonlar.
# api_tokens.token_hash: kimlik dogrulama, tenant BILINMEDEN once hash
# ile arama yapar (05_POSTGRES_RLS §7). Global benzersizlik burada bir
# guvenlik ozelligidir — iki tenant'ta ayni hash olamaz.
GLOBALLY_UNIQUE = {("api_tokens", "uq_api_tokens_hash")}


def _tenant_tables() -> Tuple[str, ...]:
    from app.models.mixins import tenant_owned_tables

    return tenant_owned_tables()


# =============================================================================
# 1) tenant_id NOT NULL
# =============================================================================

def enforce_not_null(conn) -> None:
    """Backfill dogrulanmis olmali; NULL kalan satir varsa DURUR."""
    for table in _tenant_tables():
        remaining = conn.execute(text(
            f"SELECT count(*) FROM {table} WHERE tenant_id IS NULL"
        )).scalar() or 0
        if remaining:
            raise RuntimeError(
                f"{table}: {remaining} satirda tenant_id NULL — enforce "
                "fazi calistirilamaz (once 0004 backfill)."
            )
        conn.execute(text(
            f"ALTER TABLE {table} ALTER COLUMN tenant_id SET NOT NULL"
        ))


# =============================================================================
# 2) Benzersizlikler tenant-qualified
# =============================================================================

def convert_unique_constraints(conn) -> List[str]:
    """Her GLOBAL benzersizligin basina `tenant_id` ekler.

    Neden kritik: bugun `user_groups.name` global benzersiz. Iki farkli
    sirketin ikisinin de "Backend" adli bir grubu olamazdi — ve daha
    kotusu, cakisma mesaji baska bir tenant'ta o adin KULLANILDIGINI
    sizdirirdi.

    Katalogdan turetilir; bicimi (constraint mi, kismi index mi,
    ifadeli index mi) korunur.
    """
    converted: List[str] = []
    tables = set(_tenant_tables())

    # --- UNIQUE CONSTRAINT'ler ---
    rows = conn.execute(text(
        "SELECT c.relname AS table_name, con.conname, "
        "       pg_get_constraintdef(con.oid) AS definition "
        "FROM pg_constraint con "
        "JOIN pg_class c ON c.oid = con.conrelid "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND con.contype = 'u'"
    )).mappings().all()

    for row in rows:
        table, name, definition = (
            row["table_name"], row["conname"], row["definition"]
        )
        if table not in tables or (table, name) in GLOBALLY_UNIQUE:
            continue
        # "UNIQUE (a, b)" → kolon listesi
        columns = definition[definition.index("(") + 1:
                             definition.rindex(")")]
        if "tenant_id" in [c.strip() for c in columns.split(",")]:
            continue  # zaten donusturulmus (idempotent)
        conn.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {name}"))
        conn.execute(text(
            f"ALTER TABLE {table} ADD CONSTRAINT {name} "
            f"UNIQUE (tenant_id, {columns})"
        ))
        converted.append(f"{table}.{name}")

    # --- UNIQUE INDEX'ler (constraint'e bagli olmayanlar) ---
    index_rows = conn.execute(text(
        "SELECT i.tablename, i.indexname, i.indexdef "
        "FROM pg_indexes i "
        "WHERE i.schemaname = 'public' "
        "  AND i.indexdef LIKE 'CREATE UNIQUE%' "
        "  AND i.indexname NOT LIKE '%_pkey' "
        "  AND NOT EXISTS ("
        "      SELECT 1 FROM pg_constraint con "
        "      WHERE con.conname = i.indexname)"
    )).mappings().all()

    for row in index_rows:
        table, name, definition = (
            row["tablename"], row["indexname"], row["indexdef"]
        )
        if table not in tables or (table, name) in GLOBALLY_UNIQUE:
            continue
        body_start = definition.index("(")
        body_end = definition.index(")", body_start)
        columns = definition[body_start + 1:body_end]
        if "tenant_id" in [c.strip() for c in columns.split(",")]:
            continue
        # Kismi index'in WHERE'i korunur (orn. yalnizca 'global' bindings).
        where_clause = ""
        tail = definition[body_end + 1:]
        if " WHERE " in tail:
            where_clause = " WHERE " + tail.split(" WHERE ", 1)[1]
        conn.execute(text(f"DROP INDEX {name}"))
        conn.execute(text(
            f"CREATE UNIQUE INDEX {name} ON {table} "
            f"(tenant_id, {columns}){where_clause}"
        ))
        converted.append(f"{table}.{name} (index)")

    return converted


# =============================================================================
# 3) Tenant-tutarli COMPOSITE foreign key'ler
# =============================================================================

_DELETE_ACTIONS = {
    "a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE",
    "n": "SET NULL", "d": "SET DEFAULT",
}


def convert_foreign_keys(conn) -> List[str]:
    """tenant-owned → tenant-owned FK'leri (tenant_id, id)'ye tasir.

    Bu, uygulama bir hata yapip BASKA bir tenant'in UUID'sini yazmaya
    calissa bile veritabaninin reddetmesini saglar (04_DATA_MODEL §5).
    RLS "goremezsin" der; composite FK "referans bile veremezsin" der.

    Onkosul: her ebeveyn tabloda `UNIQUE (tenant_id, id)`.
    """
    tables = set(_tenant_tables())
    converted: List[str] = []

    # Ebeveyn tarafi icin (tenant_id, id) benzersizligi.
    #
    # DROP+CREATE YAPILMAZ: bu kisit bir kez composite FK'ler tarafindan
    # referans alindiktan sonra dusurulEMEZ (DependentObjectsStillExist).
    # Ikinci kez kosan bir migration Job'i (retry, yeniden deploy) aksi
    # halde patlardi. Yalnizca YOKSA yaratiyoruz.
    existing = {
        row[0]
        for row in conn.execute(text(
            "SELECT con.conname FROM pg_constraint con "
            "JOIN pg_class c ON c.oid = con.conrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND con.contype = 'u'"
        )).all()
    }
    for table in sorted(tables):
        if f"uq_{table}_tenant_id" in existing:
            continue
        conn.execute(text(
            f"ALTER TABLE {table} ADD CONSTRAINT uq_{table}_tenant_id "
            "UNIQUE (tenant_id, id)"
        ))

    rows = conn.execute(text(
        "SELECT con.conname, "
        "       child.relname  AS child_table, "
        "       parent.relname AS parent_table, "
        "       con.confdeltype, "
        "       pg_get_constraintdef(con.oid) AS definition "
        "FROM pg_constraint con "
        "JOIN pg_class child  ON child.oid  = con.conrelid "
        "JOIN pg_class parent ON parent.oid = con.confrelid "
        "JOIN pg_namespace n  ON n.oid = child.relnamespace "
        "WHERE n.nspname = 'public' AND con.contype = 'f'"
    )).mappings().all()

    for row in rows:
        child, parent = row["child_table"], row["parent_table"]
        if child not in tables or parent not in tables:
            continue
        definition = row["definition"]
        if "tenant_id" in definition:
            continue  # zaten composite (idempotent)

        # "FOREIGN KEY (col) REFERENCES parent(id) ON DELETE X"
        child_cols = definition[definition.index("(") + 1:
                                definition.index(")")]
        ref_part = definition[definition.index("REFERENCES"):]
        parent_cols = ref_part[ref_part.index("(") + 1:
                               ref_part.index(")")]
        if parent_cols.strip() != "id":
            continue  # yalnizca PK referanslari donusturulur

        # NULL yapilabilir bir cocuk kolonu composite FK'de MATCH SIMPLE
        # ile calisir: kolonlardan biri NULL ise kisit uygulanmaz —
        # istedigimiz davranis budur (orn. work_logs.task_id opsiyonel).
        delete_action = _DELETE_ACTIONS.get(row["confdeltype"], "NO ACTION")
        # ON DELETE SET NULL, composite FK'de TUM kolonlari NULL yapmaya
        # calisir — tenant_id NOT NULL oldugu icin bu patlar. Bu FK'leri
        # SET NULL yerine, yalnizca cocuk kolonunu NULL'layacak sekilde
        # kisitliyoruz.
        if delete_action == "SET NULL":
            action_sql = f"ON DELETE SET NULL ({child_cols})"
        else:
            action_sql = f"ON DELETE {delete_action}"

        name = row["conname"]
        conn.execute(text(
            f"ALTER TABLE {child} DROP CONSTRAINT {name}"
        ))
        conn.execute(text(
            f"ALTER TABLE {child} ADD CONSTRAINT {name} "
            f"FOREIGN KEY (tenant_id, {child_cols}) "
            f"REFERENCES {parent}(tenant_id, id) {action_sql}"
        ))
        converted.append(f"{child}.{name} → {parent}")

    return converted


# =============================================================================
# 4) RLS: helper fonksiyon + ENABLE/FORCE + politika
# =============================================================================

def install_security_helpers(conn) -> None:
    """Tenant baglamini okuyan STABLE fonksiyon.

    Kontrollu bir semada ve SABIT `search_path` ile yasar: politikalar
    bu fonksiyona her satirda basvurdugu icin, arama yolu ele gecirilirse
    tum izolasyon duserdi.

    `NULLIF(..., '')` onemli: ayarlanmamis GUC bos string doner;
    `''::uuid` hata verirdi. Bos → NULL → `tenant_id = NULL` her zaman
    FALSE → sifir satir. Yani "context yok" = "veri yok".
    """
    conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SECURITY_SCHEMA}"))
    conn.execute(text(
        f"CREATE OR REPLACE FUNCTION {SECURITY_SCHEMA}"
        ".app_current_tenant_id() RETURNS uuid "
        "LANGUAGE sql STABLE "
        f"SET search_path = {SECURITY_SCHEMA}, pg_catalog "
        "AS $$ SELECT NULLIF("
        "current_setting('app.tenant_id', true), '')::uuid $$"
    ))


def enable_row_level_security(conn) -> List[str]:
    """Her tenant tablosunda RLS'i ACAR ve ZORLAR.

    FORCE kritik: FORCE olmadan tablo SAHIBI politikadan muaftir ve
    migration rolu (sahip) her seyi gorurdu. Uygulama rolu zaten
    NOBYPASSRLS ve sahip degil (bkz. sql_scripts/roles/00_roles.sql).

    Politika hem USING (okuma) hem WITH CHECK (yazma) tasir; "tenant
    yok" icin permissive bir dal ASLA yazilmaz.
    """
    applied: List[str] = []
    for table in _tenant_tables():
        policy = f"{table}_tenant_isolation"
        conn.execute(text(
            f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"
        ))
        conn.execute(text(
            f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"
        ))
        conn.execute(text(f"DROP POLICY IF EXISTS {policy} ON {table}"))
        conn.execute(text(
            f"CREATE POLICY {policy} ON {table} "
            f"USING (tenant_id = {SECURITY_SCHEMA}.app_current_tenant_id()) "
            "WITH CHECK (tenant_id = "
            f"{SECURITY_SCHEMA}.app_current_tenant_id())"
        ))
        applied.append(table)
    return applied


# =============================================================================
# 5) Runtime rol yetkileri
# =============================================================================

def grant_runtime_role(conn, role_name: str) -> None:
    """Uygulama rolune EN AZ yetki. Rol yoksa sessizce gecer.

    (Rol, `sql_scripts/roles/00_roles.sql` ile operatör tarafindan
    kurulur; migration rol YARATMAZ — sifre yonetimi migration'in isi
    degildir.)
    """
    exists = conn.execute(
        text("SELECT 1 FROM pg_roles WHERE rolname = :r"),
        {"r": role_name},
    ).first()
    if exists is None:
        logger.info("runtime rol yok, grant atlandi: %s", role_name)
        return

    conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {role_name}"))
    conn.execute(text(
        f"GRANT USAGE ON SCHEMA {SECURITY_SCHEMA} TO {role_name}"
    ))
    conn.execute(text(
        f"GRANT EXECUTE ON FUNCTION {SECURITY_SCHEMA}"
        f".app_current_tenant_id() TO {role_name}"
    ))
    conn.execute(text(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES "
        f"IN SCHEMA public TO {role_name}"
    ))
    conn.execute(text(
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public "
        f"TO {role_name}"
    ))


# =============================================================================
# Genel giris noktasi
# =============================================================================

def apply_enforce(conn, *, runtime_role: str = "hermes_core_app") -> dict:
    """Enforce fazinin tamami — sirasi ONEMLIDIR."""
    enforce_not_null(conn)
    uniques = convert_unique_constraints(conn)
    fks = convert_foreign_keys(conn)
    install_security_helpers(conn)
    tables = enable_row_level_security(conn)
    grant_runtime_role(conn, runtime_role)

    report = {
        "tables_with_rls": len(tables),
        "unique_constraints_converted": len(uniques),
        "foreign_keys_converted": len(fks),
    }
    logger.info("enforce tamam: %s", report)
    return report
