"""core_db — mevcut tum is verisinin ilk tenant'a backfill'i

Revision ID: 0004_tenant_backfill
Revises: 0003_tenant_expand
Create Date: 2026-08-15

BACKFILL fazi (runbook §5). Mevcut Hermes is verisinin TAMAMI ilk
(Duosis) tenant'ina yazilir. Hicbir PK degismez, hicbir satir silinmez,
hicbir iliski bozulmaz.

TENANT KIMLIGI NEREDEN GELIR: `HERMES_INITIAL_TENANT_ID` ortam
degiskeninden. Bu deger auth_db'de 0003_initial_tenant tarafindan BIR
kez uretilir; `shared/migration_runner.py` `all` hedefinde auth'u once
kosar, uretilen kimligi okur ve core kosumuna gecirir. Kodda UUID
UYDURULMAZ ve iki veritabani ayni degeri paylasir.

Degisken yoksa ve doldurulacak satir varsa migration BASARISIZ olur —
yanlis bir tenant'a yazmaktansa durmak dogrudur.

IDEMPOTENT: yalnizca `tenant_id IS NULL` satirlara yazar. Ikinci kosu
sifir satir gunceller.
"""
import os

from alembic import op
from sqlalchemy import text

revision = "0004_tenant_backfill"
down_revision = "0003_tenant_expand"
branch_labels = None
depends_on = None

# Sayac isim alanlari — global sequence'larin tenant'li karsiligi.
COUNTER_KEYS = ("task", "issue", "suggestion")


def _tables():
    from app.models.mixins import tenant_owned_tables

    return tenant_owned_tables()


def _resolve_tenant_id(conn):
    """Ilk tenant kimligini cozer: env → mevcut registry kaydi."""
    env_value = (os.getenv("HERMES_INITIAL_TENANT_ID") or "").strip()
    if env_value:
        return env_value
    # Tekrar kosumlarda env verilmemis olabilir; registry zaten
    # doldurulmussa oradan devam ederiz (tek tenant varsa belirsizlik yok).
    rows = conn.execute(
        text("SELECT tenant_id FROM tenant_registry")
    ).scalars().all()
    if len(rows) == 1:
        return str(rows[0])
    return None


def upgrade() -> None:
    conn = op.get_bind()
    tables = _tables()

    pending = 0
    for table in tables:
        pending += conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE tenant_id IS NULL")
        ).scalar() or 0

    tenant_id = _resolve_tenant_id(conn)

    if tenant_id is None:
        if pending == 0:
            # Bos kurulum (taze DB): doldurulacak bir sey yok.
            print("ℹ️  backfill: doldurulacak satir yok, atlaniyor",
                  flush=True)
            return
        raise RuntimeError(
            "HERMES_INITIAL_TENANT_ID verilmedi ama doldurulmasi gereken "
            f"{pending} satir var. Migration'i "
            "`python -m shared.migration_runner all` ile calistirin "
            "(auth once kosar ve tenant kimligini gecirir)."
        )

    # ------------------------------------------------------------------
    # 1) Tenant projeksiyonu — core, tenant'i bu tablodan taniyacak
    # ------------------------------------------------------------------
    conn.execute(
        text(
            "INSERT INTO tenant_registry (tenant_id, slug, status, "
            "placement_key, source_version, provisioned_at, updated_at) "
            "VALUES (CAST(:t AS uuid), :slug, 'active', 'shared-default', "
            "1, now(), now()) "
            "ON CONFLICT (tenant_id) DO NOTHING"
        ),
        {"t": tenant_id,
         "slug": os.getenv("HERMES_INITIAL_TENANT_SLUG", "duosis")},
    )

    # ------------------------------------------------------------------
    # 2) Is verisi — yalnizca NULL olanlar (idempotent)
    # ------------------------------------------------------------------
    report = []
    for table in tables:
        before = conn.execute(
            text(f"SELECT count(*) FROM {table}")
        ).scalar() or 0
        updated = conn.execute(
            text(
                f"UPDATE {table} SET tenant_id = CAST(:t AS uuid) "
                "WHERE tenant_id IS NULL"
            ),
            {"t": tenant_id},
        ).rowcount or 0
        remaining = conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE tenant_id IS NULL")
        ).scalar() or 0
        report.append((table, before, updated, remaining))

    # ------------------------------------------------------------------
    # 3) Sayaclar — global sequence'larin MEVCUT degerinin otesinden basla
    # ------------------------------------------------------------------
    # Kritik: yeni sayac, o tenant'ta halihazirda kullanilmis en yuksek
    # numaranin USTUNDEN devam etmeli. Aksi halde yeni bir gorev, var
    # olan bir task kodunu tekrar uretir.
    for key in COUNTER_KEYS:
        max_used = conn.execute(
            text(
                "SELECT COALESCE(MAX(type_number), 0) FROM tasks "
                "WHERE task_type = :k AND tenant_id = CAST(:t AS uuid)"
            ),
            {"k": key, "t": tenant_id},
        ).scalar() or 0
        conn.execute(
            text(
                "INSERT INTO tenant_counters (tenant_id, counter_key, "
                "next_value, updated_at) VALUES (CAST(:t AS uuid), :k, "
                ":v, now()) ON CONFLICT (tenant_id, counter_key) "
                "DO NOTHING"
            ),
            {"t": tenant_id, "k": key, "v": int(max_used) + 1},
        )

    # ------------------------------------------------------------------
    # 4) Backfill raporu (runbook §5 — kanit)
    # ------------------------------------------------------------------
    touched = [r for r in report if r[2] > 0]
    print(
        f"✅ backfill tamam (tenant={tenant_id}): "
        f"{len(touched)}/{len(report)} tabloda satir guncellendi",
        flush=True,
    )
    for table, before, updated, remaining in report:
        if updated or remaining:
            print(f"   {table}: toplam={before} guncellenen={updated} "
                  f"kalan_null={remaining}", flush=True)

    leftover = sum(r[3] for r in report)
    if leftover:
        raise RuntimeError(
            f"backfill sonrasi {leftover} satirda tenant_id hala NULL"
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table in _tables():
        conn.execute(text(f"UPDATE {table} SET tenant_id = NULL"))
    conn.execute(text("DELETE FROM tenant_counters"))
    conn.execute(text("DELETE FROM tenant_registry"))
