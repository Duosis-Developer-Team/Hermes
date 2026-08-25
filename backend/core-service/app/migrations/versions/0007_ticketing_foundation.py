"""core_db — Ortak urun ticket platformu (Ticket Hub) tablolari

Revision ID: 0007_ticketing_foundation
Revises: 0006_api_token_lookup
Create Date: 2026-08-25

TAMAMEN ADDITIVE (D-012). Bu revizyon:

  - YALNIZCA yeni tablo yaratir; mevcut hicbir tabloyu degistirmez,
    hicbir satiri okumaz/yazmaz/siler;
  - `DROP`, `TRUNCATE`, genis `DELETE` ve yeniden seed ICERMEZ;
  - yeni tablolara enforce fazinin AYNI yardimcilarini uygular
    (NOT NULL, tenant-qualified unique, composite FK, RLS ENABLE +
    FORCE + politika, runtime rol grant'lari) — mantik kopyalanmaz,
    `app/migrations/tenant_enforce.py` tek kaynaktir.

NEDEN `create_all` + enforce yardimcilari (elle CREATE TABLE degil):
    Repo'nun sema otoritesi ORM modelleridir ve 0001/0002 ayni deseni
    kullanir. Elle yazilan ikinci bir DDL kopyasi, modelle ayrisabilecek
    IKINCI bir dogruluk kaynagi olurdu; nitekim `tests/test_migrations.py`
    "bos DB → head sonrasi TUM ORM tablolari var mi?" diye sorar.
    `checkfirst=True` sayesinde ifade hem BOS bir veritabaninda (tablolar
    0001'in create_all'i ile zaten olusmus olabilir) hem de MEVCUT
    hermes-dev/hermes-test veritabaninda (tablolar yok) ayni sonucu
    verir.

GRANT NOTU: `GRANT ... ON ALL TABLES` yalnizca O ANDA var olan tablolari
kapsar. Yeni tablolar bu yuzden runtime role'u YENIDEN grant'lamak
zorundadir; aksi halde uygulama rolu ticket tablolarini goremezdi
(sessiz "permission denied" — canli arizanin klasik bicimi).

GERI ALMA: `downgrade` tablolari DUSURMEZ. Ticket verisi silinmez
(04_HERMES_TEST_AND_ROLLOUT §11). Uretim rollback'i onceki image'a
donmektir; yeni tablolar yerinde kalir ve zararsizdir.
"""
import os

from alembic import op

revision = "0007_ticketing_foundation"
down_revision = "0006_api_token_lookup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticketing import TICKETING_TABLES

    conn = op.get_bind()

    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in TICKETING_TABLES],
        checkfirst=True,
    )

    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(
        conn, runtime_role=runtime_role, only=TICKETING_TABLES
    )
    print(
        "✅ ticketing: {tables_with_rls} tablo RLS+FORCE, "
        "unique={unique_constraints_converted}, "
        "fk={foreign_keys_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    # Tablolari dusurmek = ticket, conversation ve audit verisini
    # SILMEK. Rollback yolu code rollback'tir; sema yerinde kalir.
    raise NotImplementedError(
        "0007_ticketing_foundation geri alinamaz: tablolari dusurmek "
        "ticket/conversation/audit verisini siler. Rollback, onceki "
        "uygulama image'ina donmektir; tablolar yerinde kalir."
    )
