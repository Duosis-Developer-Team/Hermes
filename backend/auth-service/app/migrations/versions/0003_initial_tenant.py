"""auth_db — ilk Duosis tenant'i ve mevcut kimliklerin uyelikleri

Revision ID: 0003_initial_tenant
Revises: 0002_tenant_control_plane
Create Date: 2026-08-15

BACKFILL fazi (runbook §5). Mevcut Hermes kurulumunun TAMAMI tek bir
tenant'a tasinir; hicbir ID degismez, hicbir kullanici yetkisi kaybolmaz.

Yapilanlar (hepsi IDEMPOTENT — tekrar kosmak sifir degisiklik uretir):

  1. `duosis` tenant'i (slug varsa YENIDEN YARATILMAZ, mevcut kullanilir).
     UUID kodda UYDURULMAZ: gen_random_uuid() ile BIR kez uretilir ve
     kalici olarak saklanir.
  2. Legacy domain `hermes.duosis.com` — dogrulanmis + birincil. Eski
     URL'ler ve e-posta linkleri boylece Duosis tenant'ina cozulur.
  3. Her mevcut kullanici icin uyelik. Durum, kullanicinin mevcut
     durumunu KORUR: aktif → 'active', pasif → 'suspended'.
  4. Mevcut RBAC rol/atamalarina tenant_id yazilir. Roller zaten tek bir
     global kume oldugu icin, bunlar dogrudan Duosis'in rolleri olur —
     yani kimsenin efektif izni degismez.
  5. Bugunku tum ozellikleri KORUYAN bir plan + abonelik.

Cutover sonrasi tenant `active` yapilir; bu revizyon onu dogrudan
'active' isaretler cunku Duosis zaten calisan bir kurulumdur (yeni
tenant provisioning saga'sindan gecmez).
"""
import os

from alembic import op
from sqlalchemy import text

revision = "0003_initial_tenant"
down_revision = "0002_tenant_control_plane"
branch_labels = None
depends_on = None

# Slug ve gorunen ad ortamdan gelebilir (dev/test kurulumlari icin);
# varsayilan, runbook §3'teki kanonik degerdir.
INITIAL_TENANT_SLUG = os.getenv("HERMES_INITIAL_TENANT_SLUG", "duosis")
INITIAL_TENANT_NAME = os.getenv("HERMES_INITIAL_TENANT_NAME", "Duosis")
INITIAL_TENANT_TIMEZONE = os.getenv(
    "HERMES_INITIAL_TENANT_TIMEZONE", "Europe/Istanbul"
)
LEGACY_HOSTNAME = os.getenv(
    "HERMES_INITIAL_TENANT_HOSTNAME", "hermes.duosis.com"
)

# Duosis'in plani: bugun acik olan HER ozelligi korur. Yeni tenant'lar
# icin varsayilan DEGILDIR — Platform Console'dan atanir.
LEGACY_PLAN_CODE = "legacy-full"


def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # 1) Tenant — varsa yeniden yaratilmaz
    # ------------------------------------------------------------------
    tenant_id = conn.execute(
        text("SELECT id FROM tenants WHERE slug = :slug"),
        {"slug": INITIAL_TENANT_SLUG},
    ).scalar()

    if tenant_id is None:
        tenant_id = conn.execute(
            text(
                "INSERT INTO tenants (id, slug, display_name, status, "
                "default_locale, timezone, placement_mode, placement_key, "
                "version, created_at, updated_at, activated_at) "
                "VALUES (gen_random_uuid(), :slug, :name, 'active', "
                "'tr-TR', :tz, 'shared', 'shared-default', 1, now(), "
                "now(), now()) RETURNING id"
            ),
            {"slug": INITIAL_TENANT_SLUG, "name": INITIAL_TENANT_NAME,
             "tz": INITIAL_TENANT_TIMEZONE},
        ).scalar()

    # ------------------------------------------------------------------
    # 2) Legacy domain — eski URL'ler ve e-posta linkleri icin
    # ------------------------------------------------------------------
    conn.execute(
        text(
            "INSERT INTO tenant_domains (id, tenant_id, hostname, kind, "
            "verification_status, verified_at, is_primary, created_at, "
            "updated_at) VALUES (gen_random_uuid(), :t, :host, 'legacy', "
            "'verified', now(), true, now(), now()) "
            "ON CONFLICT (hostname) DO NOTHING"
        ),
        {"t": tenant_id, "host": LEGACY_HOSTNAME.lower()},
    )

    # ------------------------------------------------------------------
    # 3) Uyelikler — mevcut kullanici durumu KORUNUR
    # ------------------------------------------------------------------
    # Pasif kullanici 'suspended' uyelik alir: aktif uyelige terfi
    # ettirmek, bugun giris yapamayan birine erisim vermek olurdu.
    conn.execute(
        text(
            "INSERT INTO tenant_memberships (id, tenant_id, user_id, "
            "status, joined_at, created_at, updated_at) "
            "SELECT gen_random_uuid(), :t, u.id, "
            "       CASE WHEN u.is_active THEN 'active' ELSE 'suspended' "
            "       END, u.created_at, now(), now() "
            "FROM users u "
            "ON CONFLICT (tenant_id, user_id) DO NOTHING"
        ),
        {"t": tenant_id},
    )

    # ------------------------------------------------------------------
    # 4) RBAC rolleri/atamalari bu tenant'a baglanir
    # ------------------------------------------------------------------
    # Bugun roller tek bir global kumedir; hepsi Duosis'in rolleri olur.
    # Efektif izinler DEGISMEZ — yalnizca kapsamlari adlandirilmis olur.
    conn.execute(
        text("UPDATE rbac_roles SET tenant_id = :t WHERE tenant_id IS NULL"),
        {"t": tenant_id},
    )
    conn.execute(
        text(
            "UPDATE rbac_user_roles SET tenant_id = :t "
            "WHERE tenant_id IS NULL"
        ),
        {"t": tenant_id},
    )

    # ------------------------------------------------------------------
    # 5) Plan + abonelik — bugunku ozelliklerin TAMAMI acik
    # ------------------------------------------------------------------
    conn.execute(
        text(
            "INSERT INTO plans (code, display_name, description, "
            "is_active, created_at, updated_at) VALUES "
            "(:code, 'Legacy (full access)', "
            "'Preserves every feature the pre-tenant Hermes install had. "
            "Assigned to the initial tenant only.', true, now(), now()) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"code": LEGACY_PLAN_CODE},
    )

    # Entitlement degerleri app/services/entitlements.py katalogundan
    # dogrulanir; buradaki degerler o katalogla uyumludur.
    legacy_entitlements = {
        "users.max": "null",          # sinirsiz
        "projects.active.max": "null",
        "api.enabled": "true",
        "mcp.enabled": "true",
        "meetings.enabled": "true",
        "retention.days": "null",
        "support.sla_tier": "3",
    }
    for code, json_value in legacy_entitlements.items():
        conn.execute(
            text(
                "INSERT INTO plan_entitlements (id, plan_code, "
                "entitlement_code, value) VALUES (gen_random_uuid(), "
                ":plan, :code, CAST(:val AS jsonb)) "
                "ON CONFLICT (plan_code, entitlement_code) DO NOTHING"
            ),
            {"plan": LEGACY_PLAN_CODE, "code": code, "val": json_value},
        )

    existing_subscription = conn.execute(
        text(
            "SELECT 1 FROM tenant_subscriptions "
            "WHERE tenant_id = :t AND status = 'active'"
        ),
        {"t": tenant_id},
    ).first()
    if existing_subscription is None:
        conn.execute(
            text(
                "INSERT INTO tenant_subscriptions (id, tenant_id, "
                "plan_code, status, started_at, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :t, :plan, 'active', now(), "
                "now(), now())"
            ),
            {"t": tenant_id, "plan": LEGACY_PLAN_CODE},
        )

    # ------------------------------------------------------------------
    # Dogrulama — sessiz yarim backfill kabul edilemez
    # ------------------------------------------------------------------
    orphan_roles = conn.execute(
        text("SELECT count(*) FROM rbac_roles WHERE tenant_id IS NULL")
    ).scalar()
    orphan_assignments = conn.execute(
        text("SELECT count(*) FROM rbac_user_roles WHERE tenant_id IS NULL")
    ).scalar()
    missing_memberships = conn.execute(
        text(
            "SELECT count(*) FROM users u WHERE NOT EXISTS ("
            "  SELECT 1 FROM tenant_memberships m "
            "  WHERE m.user_id = u.id AND m.tenant_id = :t)"
        ),
        {"t": tenant_id},
    ).scalar()
    if orphan_roles or orphan_assignments or missing_memberships:
        raise RuntimeError(
            "ilk tenant backfill'i eksik kaldi: "
            f"roles={orphan_roles} assignments={orphan_assignments} "
            f"users_without_membership={missing_memberships}"
        )

    # ------------------------------------------------------------------
    # 6) Benzersizlik kisitlari tenant-qualified hale gelir
    # ------------------------------------------------------------------
    # Backfill'den SONRA: artik her rol/atama bir tenant'a ait.
    from app.migrations.baseline_ddl import apply_tenant_constraints

    apply_tenant_constraints(conn)

    print(
        f"✅ ilk tenant hazir: slug={INITIAL_TENANT_SLUG} id={tenant_id}",
        flush=True,
    )


def downgrade() -> None:
    conn = op.get_bind()
    tenant_id = conn.execute(
        text("SELECT id FROM tenants WHERE slug = :slug"),
        {"slug": INITIAL_TENANT_SLUG},
    ).scalar()
    if tenant_id is None:
        return
    # Roller/atamalar SILINMEZ — yalnizca tenant baglari cozulur.
    conn.execute(
        text("UPDATE rbac_user_roles SET tenant_id = NULL "
             "WHERE tenant_id = :t"), {"t": tenant_id})
    conn.execute(
        text("UPDATE rbac_roles SET tenant_id = NULL WHERE tenant_id = :t"),
        {"t": tenant_id})
    conn.execute(
        text("DELETE FROM tenant_memberships WHERE tenant_id = :t"),
        {"t": tenant_id})
    conn.execute(
        text("DELETE FROM tenant_subscriptions WHERE tenant_id = :t"),
        {"t": tenant_id})
    conn.execute(
        text("DELETE FROM tenant_domains WHERE tenant_id = :t"),
        {"t": tenant_id})
    conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
