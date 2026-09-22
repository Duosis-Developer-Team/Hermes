"""Test yardimcisi (PM rework P1.2): `Task` satirlariyla tohumlanan dunyayi
is kalemlerine tasir.

Uclar artik `work_items`tan okur; eski `Task(...)` tohumlari gorunmez.
Fixture'lar tohumdan sonra `sync_work_items(session)` cagirir — tasima
modulunun KENDISI kosar (test = uretim yolu), tekrar kosulabilir.
"""
from app.migrations import work_item_migration as mig

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"


def sync_work_items(session, tenant_id: str = TEST_TENANT_ID) -> dict:
    session.flush()
    report = mig.migrate_tenant(session.connection(), tenant_id)
    session.commit()
    return report


def item_for_task(session, task_id):
    """Eski tasks.id → work_items satiri (legacy_task_ids uzerinden)."""
    from app.models.work_item import WorkItem
    return session.query(WorkItem).filter(
        WorkItem.legacy_task_ids.contains([task_id])
    ).first()
