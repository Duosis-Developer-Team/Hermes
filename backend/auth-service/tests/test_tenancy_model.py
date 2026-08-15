# =============================================================================
# WS2 — Kontrol duzlemi veri modeli kapilari
# =============================================================================
# Bu testler, tenant kontrol duzleminin *guvenlik* ozelliklerini dogrular:
# yetki uzaylarinin ayriligi, uyelik benzersizligi, durum makinesi ve
# destek erisiminin sinirlari. Sema detayi degil, SOZLESME test edilir.
# =============================================================================

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


# =============================================================================
# 1) Yetki uzaylarinin ayriligi (en kritik WS2 invariant'i)
# =============================================================================

def test_platform_and_tenant_permission_spaces_are_disjoint():
    """Platform izinleri tenant katalogunda, tenant izinleri platform
    katalogunda GECERLI OLMAMALI.

    Ortak tek bir kod, tenant yoneticisinin kendine platform yetkisi
    verebilmesi demektir.
    """
    from shared.permissions import ALL_PERMISSIONS
    from shared.platform_permissions import ALL_PLATFORM_PERMISSIONS

    overlap = set(ALL_PERMISSIONS) & set(ALL_PLATFORM_PERMISSIONS)
    assert not overlap, f"iki yetki uzayi kesisiyor: {overlap}"


def test_platform_permissions_are_namespaced():
    """Platform izinleri `platform.` on ekini TASIMALI.

    Ad alani ayrimi, iki katalogun ileride kazara birlesmesini
    zorlastirir ve loglarda gozle ayirt edilebilir kilar.
    """
    from shared.platform_permissions import (
        ALL_PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_PREFIX,
    )

    bad = [p for p in ALL_PLATFORM_PERMISSIONS
           if not p.startswith(PLATFORM_PERMISSION_PREFIX)]
    assert not bad, f"on eki olmayan platform izni: {bad}"


def test_tenant_permissions_never_use_platform_prefix():
    from shared.permissions import ALL_PERMISSIONS
    from shared.platform_permissions import PLATFORM_PERMISSION_PREFIX

    bad = [p for p in ALL_PERMISSIONS
           if p.startswith(PLATFORM_PERMISSION_PREFIX)]
    assert not bad, f"tenant katalogunda platform izni: {bad}"


def test_every_platform_permission_is_documented():
    """Katalog ayni zamanda UI'nin izin editorunu besler."""
    from shared.platform_permissions import (
        ALL_PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_DESCRIPTIONS,
    )

    missing = [p for p in ALL_PLATFORM_PERMISSIONS
               if not PLATFORM_PERMISSION_DESCRIPTIONS.get(p)]
    assert not missing, f"aciklamasiz platform izni: {missing}"


# =============================================================================
# 2) Users GLOBAL kalir
# =============================================================================

def test_users_table_has_no_tenant_column():
    """`users` global kimliktir: tenant sutunu ALMAZ.

    Alsaydi ayni kisi iki tenant'ta iki ayri parola kimligi olurdu ve
    "tek kimlik, cok uyelik" modeli cokerdi.
    """
    from app.models import User

    assert "tenant_id" not in User.__table__.columns


def test_membership_is_the_only_bridge():
    """Tenant erisimi YALNIZCA uyelik uzerinden tanimlanir."""
    from app.models import TenantMembership

    cols = TenantMembership.__table__.columns
    assert "tenant_id" in cols
    assert "user_id" in cols
    assert "status" in cols


# =============================================================================
# 3) Durum makinesi
# =============================================================================

def test_status_transition_map_matches_pack():
    """08_TENANT_PROVISIONING §3 ile birebir olmali."""
    from app.models.tenancy import TENANT_STATUS_TRANSITIONS

    assert TENANT_STATUS_TRANSITIONS["provisioning"] == {"active", "failed"}
    assert TENANT_STATUS_TRANSITIONS["active"] == {
        "grace", "suspended", "deprovisioning"
    }
    assert TENANT_STATUS_TRANSITIONS["suspended"] == {
        "active", "deprovisioning"
    }
    # archived terminal durumdur.
    assert TENANT_STATUS_TRANSITIONS["archived"] == set()


def test_archived_tenant_cannot_be_reactivated():
    """Arsivlenmis tenant'i "geri acmak" tek adimli bir islem OLAMAZ."""
    from app.models.tenancy import TENANT_STATUS_TRANSITIONS

    assert "active" not in TENANT_STATUS_TRANSITIONS["archived"]


# =============================================================================
# 4) Entitlement katalogu fail-closed
# =============================================================================

def test_unknown_entitlement_never_enables_a_feature():
    from app.services.entitlements import Entitlement, is_enabled, resolve

    effective = resolve(
        plan_values={"totally.made.up": True},
        overrides={"another.fake": True},
    )
    assert "totally.made.up" not in effective
    # Bilinmeyen kod hicbir gercek ozelligi acmadi.
    assert is_enabled(effective, Entitlement.API_ENABLED) is False
    assert is_enabled(effective, "totally.made.up") is False


def test_entitlement_type_is_enforced():
    from app.services.entitlements import (
        Entitlement, EntitlementValidationError, validate,
    )

    with pytest.raises(EntitlementValidationError):
        validate(Entitlement.USERS_MAX, "50")          # string sayi degil
    with pytest.raises(EntitlementValidationError):
        validate(Entitlement.USERS_MAX, True)          # bool int sayilmaz
    with pytest.raises(EntitlementValidationError):
        validate(Entitlement.API_ENABLED, 1)           # 1 bool degil
    assert validate(Entitlement.USERS_MAX, 50) == 50
    assert validate(Entitlement.API_ENABLED, True) is True


def test_override_beats_plan_which_beats_default():
    from app.services.entitlements import Entitlement, resolve

    assert resolve({}, {})[Entitlement.USERS_MAX] == 10
    assert resolve({Entitlement.USERS_MAX: 40}, {})[
        Entitlement.USERS_MAX] == 40
    assert resolve({Entitlement.USERS_MAX: 40},
                   {Entitlement.USERS_MAX: 99})[
        Entitlement.USERS_MAX] == 99


def test_corrupt_stored_value_does_not_override_default():
    """Bozuk bir DB kaydi, limiti sessizce sinirsiz yapmamali."""
    from app.services.entitlements import Entitlement, resolve

    effective = resolve({Entitlement.USERS_MAX: "sinirsiz"}, {})
    assert effective[Entitlement.USERS_MAX] == 10


# =============================================================================
# 5) DB seviyesinde kisitlar (gercek Postgres)
# =============================================================================

def _tenant(conn, slug: str) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) "
        "VALUES (:id, :slug, :name, 'active', 'tr-TR', 'Europe/Istanbul', "
        "'shared', 'shared-default', 1, now(), now())"
    ), {"id": tenant_id, "slug": slug, "name": slug.title()})
    return tenant_id


def _user(conn, email: str) -> uuid.UUID:
    user_id = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO users (id, email, full_name, hashed_password, "
        "is_active, is_admin, role, created_at) "
        "VALUES (:id, :email, 'T', 'x', true, false, 'USER', now())"
    ), {"id": user_id, "email": email})
    return user_id


def test_membership_is_unique_per_tenant_user(pg_engine):
    """Ayni kisi bir tenant'a iki kez uye olamaz."""
    with pg_engine.begin() as conn:
        tenant_id = _tenant(conn, f"acme{uuid.uuid4().hex[:8]}")
        user_id = _user(conn, f"{uuid.uuid4().hex[:8]}@example.com")
        for _ in range(1):
            conn.execute(text(
                "INSERT INTO tenant_memberships (id, tenant_id, user_id, "
                "status, created_at, updated_at) VALUES "
                "(gen_random_uuid(), :t, :u, 'active', now(), now())"
            ), {"t": tenant_id, "u": user_id})

    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenant_memberships (id, tenant_id, user_id, "
                "status, created_at, updated_at) VALUES "
                "(gen_random_uuid(), :t, :u, 'active', now(), now())"
            ), {"t": tenant_id, "u": user_id})


def test_same_identity_can_join_two_tenants(pg_engine):
    """Cok-tenant uyelik modelinin temel vaadi."""
    with pg_engine.begin() as conn:
        a = _tenant(conn, f"acme{uuid.uuid4().hex[:8]}")
        b = _tenant(conn, f"globex{uuid.uuid4().hex[:8]}")
        user_id = _user(conn, f"{uuid.uuid4().hex[:8]}@example.com")
        for tenant_id in (a, b):
            conn.execute(text(
                "INSERT INTO tenant_memberships (id, tenant_id, user_id, "
                "status, created_at, updated_at) VALUES "
                "(gen_random_uuid(), :t, :u, 'active', now(), now())"
            ), {"t": tenant_id, "u": user_id})

        count = conn.execute(text(
            "SELECT count(*) FROM tenant_memberships WHERE user_id = :u"
        ), {"u": user_id}).scalar()
    assert count == 2


def test_hostname_is_globally_unique(pg_engine):
    """Iki tenant ayni hostname'i sahiplenemez — yoksa host->tenant
    cozumu belirsiz olurdu."""
    host = f"{uuid.uuid4().hex[:10]}.hermes.test"
    with pg_engine.begin() as conn:
        a = _tenant(conn, f"acme{uuid.uuid4().hex[:8]}")
        conn.execute(text(
            "INSERT INTO tenant_domains (id, tenant_id, hostname, kind, "
            "verification_status, is_primary, created_at, updated_at) "
            "VALUES (gen_random_uuid(), :t, :h, 'custom', 'verified', "
            "true, now(), now())"
        ), {"t": a, "h": host})

    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            b = _tenant(conn, f"globex{uuid.uuid4().hex[:8]}")
            conn.execute(text(
                "INSERT INTO tenant_domains (id, tenant_id, hostname, "
                "kind, verification_status, is_primary, created_at, "
                "updated_at) VALUES (gen_random_uuid(), :t, :h, 'custom', "
                "'verified', true, now(), now())"
            ), {"t": b, "h": host})


def test_tenant_has_at_most_one_primary_domain(pg_engine):
    with pg_engine.begin() as conn:
        tenant_id = _tenant(conn, f"acme{uuid.uuid4().hex[:8]}")
        conn.execute(text(
            "INSERT INTO tenant_domains (id, tenant_id, hostname, kind, "
            "verification_status, is_primary, created_at, updated_at) "
            "VALUES (gen_random_uuid(), :t, :h, 'custom', 'verified', "
            "true, now(), now())"
        ), {"t": tenant_id, "h": f"{uuid.uuid4().hex[:10]}.hermes.test"})

    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenant_domains (id, tenant_id, hostname, "
                "kind, verification_status, is_primary, created_at, "
                "updated_at) VALUES (gen_random_uuid(), :t, :h, 'custom', "
                "'verified', true, now(), now())"
            ), {"t": tenant_id,
                "h": f"{uuid.uuid4().hex[:10]}.hermes.test"})


def test_support_grant_requires_future_expiry(pg_engine):
    """Suresi gecmis bir destek izni YARATILAMAZ."""
    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            tenant_id = _tenant(conn, f"acme{uuid.uuid4().hex[:8]}")
            actor = _user(conn, f"{uuid.uuid4().hex[:8]}@example.com")
            past = datetime.now(timezone.utc) - timedelta(minutes=5)
            conn.execute(text(
                "INSERT INTO support_access_grants (id, tenant_id, "
                "actor_user_id, mode, reason, created_at, expires_at) "
                "VALUES (gen_random_uuid(), :t, :a, 'read_only', "
                "'SUP-1', now(), :exp)"
            ), {"t": tenant_id, "a": actor, "exp": past})


def test_support_grant_mode_is_constrained(pg_engine):
    """`mode` yalnizca read_only|read_write olabilir — 'admin' gibi
    uydurma bir mod DB'de bile tutulamaz."""
    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            tenant_id = _tenant(conn, f"acme{uuid.uuid4().hex[:8]}")
            actor = _user(conn, f"{uuid.uuid4().hex[:8]}@example.com")
            future = datetime.now(timezone.utc) + timedelta(minutes=15)
            conn.execute(text(
                "INSERT INTO support_access_grants (id, tenant_id, "
                "actor_user_id, mode, reason, created_at, expires_at) "
                "VALUES (gen_random_uuid(), :t, :a, 'god_mode', "
                "'SUP-1', now(), :exp)"
            ), {"t": tenant_id, "a": actor, "exp": future})


def test_tenant_status_is_constrained(pg_engine):
    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenants (id, slug, display_name, status, "
                "default_locale, timezone, placement_mode, placement_key, "
                "version, created_at, updated_at) VALUES "
                "(gen_random_uuid(), :slug, 'X', 'totally_made_up', "
                "'tr-TR', 'Europe/Istanbul', 'shared', 'shared-default', "
                "1, now(), now())"
            ), {"slug": f"bad{uuid.uuid4().hex[:8]}"})


def test_placement_mode_is_locked_to_shared(pg_engine):
    """Ilk surumde database-per-tenant YOK: DB bunu kabul etmemeli."""
    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenants (id, slug, display_name, status, "
                "default_locale, timezone, placement_mode, placement_key, "
                "version, created_at, updated_at) VALUES "
                "(gen_random_uuid(), :slug, 'X', 'active', 'tr-TR', "
                "'Europe/Istanbul', 'dedicated', 'shared-default', 1, "
                "now(), now())"
            ), {"slug": f"ded{uuid.uuid4().hex[:8]}"})


def test_slug_format_is_enforced(pg_engine):
    """Slug hostname bileseni olarak kullanilir: bosluk/buyuk harf yok."""
    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tenants (id, slug, display_name, status, "
                "default_locale, timezone, placement_mode, placement_key, "
                "version, created_at, updated_at) VALUES "
                "(gen_random_uuid(), 'Acme Ltd', 'X', 'active', 'tr-TR', "
                "'Europe/Istanbul', 'shared', 'shared-default', 1, "
                "now(), now())"
            ))
