"""Is kalemi cutover senkronu (PM rework P1.2).

0010 ile tasima yapildiktan sonra, uclar work_items'a gecene kadar
calisan eski kod `tasks` ailesine yazmaya devam etti. Bu adim ayni
TEKRAR KOSULABILIR tasimayi bir kez daha calistirir: 0010'dan sonra
`tasks`a dusen satirlar is kalemine tasinir, tasinmis olanlar atlanir
(legacy_task_ids). Sema degisikligi YOK; hicbir sey dusurulmez.

Bu migration ile ayni deploy'da uclar work_items'tan okumaya baslar;
dolayisiyla tasima ile kod gecisi arasinda kayip pencere kalmaz.

`downgrade` bilerek desteklenmez (0010 ile ayni gerekce).
"""
from __future__ import annotations

from alembic import op

revision = "0011_work_items_cutover_sync"
down_revision = "0010_work_items_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.work_item_migration import migrate_all

    conn = op.get_bind()
    summary = migrate_all(conn)
    # Yalnizca sayilar loglanir (baslik/kisi verisi YOK).
    print(f"[0011] work item cutover sync: {summary}")


def downgrade() -> None:
    raise RuntimeError(
        "0011_work_items_cutover_sync: downgrade desteklenmez — tasinan "
        "is kalemleri kullanici verisidir."
    )
