"""Talep agi — ticket_network_links (requester tenant → provider tenant).

TAMAMEN ADDITIVE: tek yeni GLOBAL tablo (RLS'siz; `mixins.GLOBAL_TABLES`
gerekcesiyle). Mevcut `hermes` yonlendirmelerinden baglanti satirlari
geri doldurulur (ticket_network_migration.backfill_links) — saglayici
verisine YAZILMAZ, hicbir satir silinmez/degistirilmez. Tekrar kosulabilir.

GRANT: yeni tablo runtime role'e ayrica grant'lanir (0007 notu).

`downgrade` bilerek desteklenmez: baglanti konfigurasyonudur.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0018_ticket_network"
down_revision = "0017_tenant_modules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_ticket_network
    from app.migrations.tenant_enforce import grant_runtime_role
    from app.migrations.ticket_network_migration import backfill_links

    conn = op.get_bind()
    apply_ticket_network(conn)
    grant_runtime_role(conn, os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app"))
    report = backfill_links(conn)
    print(
        "✅ ticket network: {links_inserted} baglanti ({links_active} aktif), "
        "{providers} saglayici, {skipped} atlandi".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError("talep agi dusurulmez — konfigurasyondur.")
