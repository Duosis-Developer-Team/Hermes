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
    # WS3: tenant ZORUNLU. Opsiyonel olsaydi, tenant'i unutan her cagri
    # izinleri tenant'lar arasi birlestirirdi.
    tenant_id: UUID
    user_ids: List[UUID] = Field(..., max_length=MAX_RESOLVE_IDS)


@router.post("/resolve")
def resolve_permissions(
    payload: ResolvePermissionsRequest,
    _: None = Depends(require_s2s),
    db: Session = Depends(get_db),
):
    """Batch kullanici → BIR TENANT ICINDEKI efektif izin listesi.

    Siralama girdi sirasi; her istenen id yanitta VARDIR (bilinmeyen,
    pasif VEYA bu tenant'in uyesi olmayan → bos liste). Bos liste
    donmek, "bu kimlik baska bir tenant'ta var" bilgisini de sizdirmaz.

    Yanit, cagiranin dogrulayabilmesi icin cozulen tenant'i TEKRARLAR
    (03_TARGET_ARCHITECTURE §5).
    """
    seen = set()
    users = []
    for uid in payload.user_ids:
        if uid in seen:
            continue
        seen.add(uid)
        users.append(
            {
                "id": str(uid),
                "permissions": sorted(
                    effective_permissions(
                        db, uid, tenant_id=payload.tenant_id
                    )
                ),
            }
        )
    return {"tenant_id": str(payload.tenant_id), "users": users}


# =============================================================================
# RBAC cutover: legacy task izinlerinin komponent rollere backfill'i
# =============================================================================
# core-service, legacy efektif izinleri (task_user_permissions + grup
# mirasi + member override) DONMUS legacy cozumleyiciyle hesaplar ve
# kullanici→komponent-rol eslemesini buraya POST'lar. Bu uc:
#   - YALNIZCA ekler (var olan atama atlanir) — tekrar kosmak guvenli,
#   - hicbir rol/atama SILMEZ,
#   - bilinmeyen kullanici/rol kodunu sayip raporlar (FK patlatmaz),
#   - require_s2s ile korunur (dual-key, constant-time).

MAX_BACKFILL_ITEMS = 500

_COMPONENT_CODES = ("task-access", "task-assigner",
                    "issues-access", "issues-assigner")


class TaskBackfillItem(BaseModel):
    user_id: UUID
    role_codes: List[str] = Field(..., max_length=4)


class TaskBackfillRequest(BaseModel):
    # WS3: backfill de tenant-scoped. Cagiran (core) hangi tenant'in
    # legacy izinlerini tasidigi ACIKCA soylemek zorundadir.
    tenant_id: UUID
    assignments: List[TaskBackfillItem] = Field(
        ..., max_length=MAX_BACKFILL_ITEMS
    )


@router.post("/task-backfill")
def task_backfill(
    payload: TaskBackfillRequest,
    _: None = Depends(require_s2s),
    db: Session = Depends(get_db),
):
    from ..models.rbac import RbacRole, RbacUserRole
    from ..models.user import User

    from ..models.tenancy import TenantMembership

    roles = {
        r.code: r
        for r in db.query(RbacRole)
        .filter(RbacRole.code.in_(_COMPONENT_CODES),
                RbacRole.tenant_id == payload.tenant_id)
        .all()
    }
    wanted_users = {i.user_id for i in payload.assignments}
    # "Bilinen kullanici" = BU TENANT'IN aktif uyesi. Global users
    # tablosunda var olmak yetmez; aksi halde baska bir organizasyonun
    # kullanicisina rol atanabilirdi.
    known_users = {
        row[0]
        for row in db.query(TenantMembership.user_id)
        .join(User, User.id == TenantMembership.user_id)
        .filter(
            TenantMembership.tenant_id == payload.tenant_id,
            TenantMembership.status == "active",
            TenantMembership.user_id.in_(wanted_users),
        )
        .all()
    }
    existing = {
        (row.user_id, row.role_id)
        for row in db.query(RbacUserRole.user_id, RbacUserRole.role_id)
        .filter(RbacUserRole.user_id.in_(known_users),
                RbacUserRole.tenant_id == payload.tenant_id)
        .all()
    }

    assigned = 0
    skipped_existing = 0
    unknown_users = 0
    unknown_roles = 0
    for item in payload.assignments:
        if item.user_id not in known_users:
            unknown_users += 1
            continue
        for code in dict.fromkeys(item.role_codes):
            role = roles.get(code)
            if role is None:
                unknown_roles += 1
                continue
            key = (item.user_id, role.id)
            if key in existing:
                skipped_existing += 1
                continue
            db.add(RbacUserRole(
                user_id=item.user_id, role_id=role.id,
                tenant_id=payload.tenant_id,
            ))
            existing.add(key)
            assigned += 1
    db.commit()
    return {
        "assigned": assigned,
        "skipped_existing": skipped_existing,
        "unknown_users": unknown_users,
        "unknown_roles": unknown_roles,
    }
