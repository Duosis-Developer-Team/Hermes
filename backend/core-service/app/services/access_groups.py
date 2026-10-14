# =============================================================================
# HERMES core — Modul erisimi icin grup uyeligi (auth 0007)
# =============================================================================
# Gruplar core_db'dedir; auth modul kurallarini cozerken kullanicinin AKTIF
# grup kimliklerine ihtiyac duyar. Iki yol da buradan okur:
#   - core → auth izin sorgusu (authz_client) kimlikleri istekle iletir;
#   - auth'un kendi uclari /internal/access/groups ile sorar.
# Pasif grup ya da pasif uyelik SAYILMAZ.
# =============================================================================

from typing import Dict, Iterable, List
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.user_group import UserGroup, UserGroupMember


def active_group_ids(db: Session, user_ids: Iterable) -> Dict[str, List[str]]:
    ids = []
    for u in user_ids:
        try:
            ids.append(UUID(str(u)))
        except (ValueError, TypeError):
            continue
    out: Dict[str, List[str]] = {str(u): [] for u in ids}
    if not ids:
        return out
    rows = (
        db.query(UserGroupMember.user_id, UserGroupMember.group_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(UserGroupMember.user_id.in_(ids), UserGroupMember.is_active.is_(True),
                UserGroup.is_active.is_(True))
        .all()
    )
    for user_id, group_id in rows:
        out.setdefault(str(user_id), []).append(str(group_id))
    return out
