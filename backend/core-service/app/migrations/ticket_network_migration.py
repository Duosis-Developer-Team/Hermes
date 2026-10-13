# =============================================================================
# HERMES core — Talep agi geri doldurmasi (0018)
# =============================================================================
# Bugune kadar tek saglayici vardi (Duosis support tenant'i) ve "hangi
# tenant talep acabilir?" bilgisi saglayicinin verisindeydi:
# `support_applications(code='hermes')` → `support_source_tenants` →
# `support_ticket_routes`. Bu modul o bilgiyi GLOBAL indekse tasir:
#
#   her tenant P icin (P = olasi saglayici)
#     her `hermes` uygulamasi kaynak tenant'i R icin
#       R gercek bir Hermes tenant'i ise (tenant_registry'de) ve R != P:
#         link(R → P), aktif = R icin AKTIF bir route var mi?
#
# TEKRAR KOSULABILIR: (requester, provider) cifti zaten varsa dokunulmaz
# (ON CONFLICT DO NOTHING) — konsolda sonradan yapilan bir degisiklik
# ezilmez. Saglayici verisine YAZMAZ; yalnizca okur.
#
# Baglanti: migrator BYPASSRLS'tir; yine de her tenant icin app.tenant_id
# set edilir (RLS'li tablolarin okunmasi her kosumda ayni sonucu versin).
# =============================================================================

from __future__ import annotations

import uuid
from typing import Dict

from sqlalchemy import text

from .work_item_migration import set_tenant, tenant_ids


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def backfill_links(conn) -> Dict[str, int]:
    known = set(tenant_ids(conn))
    report = {"providers": 0, "links_inserted": 0, "links_active": 0, "skipped": 0}
    for provider in sorted(known):
        set_tenant(conn, provider)
        rows = conn.execute(text(
            "SELECT s.source_tenant_id, s.display_name, "
            "       EXISTS (SELECT 1 FROM support_ticket_routes r "
            "                WHERE r.source_tenant_row_id = s.id "
            "                  AND r.is_active) AS active "
            "  FROM support_source_tenants s "
            "  JOIN support_applications a ON a.id = s.application_id "
            " WHERE a.code = 'hermes' AND s.tenant_id = CAST(:p AS uuid)"
        ), {"p": provider}).all()
        if rows:
            report["providers"] += 1
        for source_id, display_name, active in rows:
            requester = str(uuid.UUID(str(source_id))) if _is_uuid(source_id) else None
            if requester is None or requester not in known or requester == provider:
                report["skipped"] += 1
                continue
            inserted = conn.execute(text(
                "INSERT INTO ticket_network_links "
                "  (id, requester_tenant_id, provider_tenant_id, is_active, "
                "   requester_display_name, version, created_by, updated_by, "
                "   created_at, updated_at) "
                "VALUES (CAST(:id AS uuid), CAST(:r AS uuid), CAST(:p AS uuid), "
                "        :active, :name, 1, 'migration:0018', 'migration:0018', "
                "        now(), now()) "
                "ON CONFLICT ON CONSTRAINT uq_ticket_network_pair DO NOTHING"
            ), {
                "id": str(uuid.uuid4()), "r": requester, "p": provider,
                "active": bool(active), "name": display_name,
            }).rowcount
            report["links_inserted"] += int(inserted or 0)
            report["links_active"] += int(bool(inserted) and bool(active))
    return report
