# =============================================================================
# HERMES core — Modul erisimi S2S ucu (auth 0007)
# =============================================================================
#   POST /internal/access/groups   {tenant_id, user_ids} → {users: {uid: [gid]}}
#
# auth, modul erisiminin GRUP kurallarini kendi uclarinda (giris, /me,
# /rbac/me) cozerken kullanicinin aktif grup kimliklerini buradan okur.
# Yalniz S2S credential (kullanici JWT'si KABUL EDILMEZ); /api disinda
# kayitlidir (ingress yonlendirmez). Yanit yalniz kimliklerdir.
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.access_groups import active_group_ids
from ..tenant_db import bind_tenant
from .internal_tenants import require_s2s

router = APIRouter(prefix="/internal/access", tags=["Internal"])


class GroupLookup(BaseModel):
    tenant_id: UUID
    user_ids: List[UUID] = Field(..., max_length=500)


@router.post("/groups", dependencies=[Depends(require_s2s)])
def user_groups(payload: GroupLookup, db: Session = Depends(get_db)):
    # Tenant baglami istekteki (S2S ile dogrulanmis cagiranin verdigi)
    # tenant'tir; RLS yalniz o tenant'in gruplarini gosterir.
    bind_tenant(db, str(payload.tenant_id))
    return {"tenant_id": str(payload.tenant_id),
            "users": active_group_ids(db, payload.user_ids)}
