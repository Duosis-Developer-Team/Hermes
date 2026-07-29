# =============================================================================
# HERMES Auth Service - Internal AuthZ resolve (RBAC R1)
# =============================================================================
# core-service'in S2S credential'i ile cagirdigi BATCH izin cozumu.
# internal_directory ile ayni guard (require_s2s: dual-key, constant-time,
# bos konfig=kapali, IP fail limiti) ve ayni sinirlar:
#   - /api prefix'inin DISINDA kayitlidir (ingress /internal'i yonlendirmez).
#   - Yanit MINIMAL: id + permissions listesi. Rol adlari/aciklama/kullanici
#     profili YOK (o is directory'nin; bu uc yalnizca yetki cozer).
#   - Bilinmeyen VEYA PASIF kullanici → permissions: [] (fail-closed;
#     cagiranin negatif cache'i icin id her kosulda yanitta bulunur).
#   - JWT'ye izin gomulmedigi icin rol degisikligi core tarafinda en gec
#     cache TTL'i (60 sn) icinde etkili olur; revocation aninda buradan
#     bos liste doner.
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.rbac_service import effective_permissions
from .internal_directory import require_s2s

router = APIRouter(prefix="/internal/authz", tags=["Internal"])

MAX_RESOLVE_IDS = 500


class ResolvePermissionsRequest(BaseModel):
    user_ids: List[UUID] = Field(..., max_length=MAX_RESOLVE_IDS)


@router.post("/resolve")
def resolve_permissions(
    payload: ResolvePermissionsRequest,
    _: None = Depends(require_s2s),
    db: Session = Depends(get_db),
):
    """Batch kullanici → efektif izin listesi. Siralama girdi sirasi;
    her istenen id yanitta VARDIR (bilinmeyen/pasif → bos liste)."""
    seen = set()
    users = []
    for uid in payload.user_ids:
        if uid in seen:
            continue
        seen.add(uid)
        users.append(
            {
                "id": str(uid),
                "permissions": sorted(effective_permissions(db, uid)),
            }
        )
    return {"users": users}
