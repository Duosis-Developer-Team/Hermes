"""PM rework P1.2: Public API is kalemlerinden (`work_items`) okur; `Task`
tohumlari gorunmez. Dunya fixture'lari tohumdan sonra `sync_work_items`
cagirir — core-service'teki tasima modulunun KENDISI kosar (uretim yolu =
test yolu; tekrar kosulabilir, tasinmis satirlar atlanir).
"""
from .conftest import TEST_TENANT_ID


def sync_work_items(session, tenant_id: str = TEST_TENANT_ID) -> dict:
    from app.migrations.work_item_migration import migrate_tenant

    session.flush()
    report = migrate_tenant(session.connection(), tenant_id)
    session.commit()
    return report
