# =============================================================================
# WS3 — Tenant oturumu, audience ayrimi ve tenant-scoped RBAC kapilari
# =============================================================================
# Bu dosya, cok-tenantli Hermes'in KIMLIK katmanindaki guvenlik
# ozelliklerini dogrular:
#
#   1. tenant/platform audience'lari birbirini REDDEDER;
#   2. tenant token'i tenant baglami OLMADAN uretilemez;
#   3. host → tenant cozumu yalnizca DOGRULANMIS domain uzerinden olur;
#   4. login, uyelik olmadan basarisiz olur ve numaralandirmaya izin
#      vermez;
#   5. ayni kimlik iki tenant'ta FARKLI izinlere sahip olabilir.
# =============================================================================

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text

# Her test KENDI tenant'larini yaratir: sabit UUID'ler, ayni test
# veritabanini paylasan dosyalar arasinda cakisirdi.


@pytest.fixture()
def tenant_a():
    return str(uuid.uuid4())


@pytest.fixture()
def tenant_b():
    return str(uuid.uuid4())


# =============================================================================
# 1) Audience ayrimi — WS3'un tek en kritik invariant'i
# =============================================================================

def _rsa_keypair():
    """Test icin gercek bir RS256 anahtar cifti uretir."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


@pytest.fixture()
def signing(monkeypatch):
    """shared.auth'u gercek anahtarlarla imzalayacak sekilde baglar."""
    from shared import auth as shared_auth

    private_pem, public_pem = _rsa_keypair()
    monkeypatch.setattr(shared_auth, "SIGNING_KEY", private_pem)
    monkeypatch.setattr(shared_auth, "VERIFY_KEY", public_pem)
    return shared_auth


def test_platform_token_is_rejected_by_tenant_verifier(signing):
    """Platform oturumu tenant verilerine ERISEMEZ."""
    from shared.auth import PLATFORM_AUDIENCE, TENANT_AUDIENCE
    from shared.exceptions import UnauthorizedError

    platform_token = signing.create_access_token(
        {"user_id": str(uuid.uuid4()), "email": "ops@hermes.dev"},
        audience=PLATFORM_AUDIENCE,
    )
    with pytest.raises(UnauthorizedError):
        signing.verify_token(platform_token, expected_audience=TENANT_AUDIENCE)


def test_tenant_token_is_rejected_by_platform_verifier(signing, tenant_a):
    """Tenant yoneticisi, platform API'sine gecemez."""
    from shared.auth import PLATFORM_AUDIENCE, TENANT_AUDIENCE
    from shared.exceptions import UnauthorizedError

    tenant_token = signing.create_access_token(
        {
            "user_id": str(uuid.uuid4()),
            "email": "admin@acme.test",
            "tenant_id": tenant_a,
            "membership_id": str(uuid.uuid4()),
            # Tenant admini olmak platform yetkisi VERMEZ; is_admin
            # claim'i burada bilerek True.
            "is_admin": True,
        },
        audience=TENANT_AUDIENCE,
    )
    with pytest.raises(UnauthorizedError):
        signing.verify_token(
            tenant_token, expected_audience=PLATFORM_AUDIENCE
        )


def test_tenant_token_cannot_be_minted_without_tenant(signing):
    """Tenant baglami olmayan bir tenant token'i URETILEMEZ.

    Bu kontrol olmasaydi, bir kod yolu yanlislikla tenant'siz token
    uretebilir ve asagi akista "tenant yok" sessizce "tum tenant'lar"
    gibi yorumlanabilirdi.
    """
    from shared.auth import TENANT_AUDIENCE

    with pytest.raises(ValueError):
        signing.create_access_token(
            {"user_id": str(uuid.uuid4()), "email": "x@y.z"},
            audience=TENANT_AUDIENCE,
        )


def test_platform_token_never_carries_tenant_claims(signing, tenant_a):
    """Platform token'ina tenant claim'i sizmaz (verilse bile atilir)."""
    from shared.auth import PLATFORM_AUDIENCE

    token = signing.create_access_token(
        {
            "user_id": str(uuid.uuid4()),
            "email": "ops@hermes.dev",
            # Cagiran yanlislikla gecirse bile korunmaz.
            "tenant_id": tenant_a,
            "membership_id": str(uuid.uuid4()),
        },
        audience=PLATFORM_AUDIENCE,
    )
    data = signing.verify_token(token, expected_audience=PLATFORM_AUDIENCE)
    assert data.tenant_id is None
    assert data.membership_id is None


def test_audience_is_mandatory_and_validated(signing):
    """Bilinmeyen bir audience ile token uretilemez."""
    with pytest.raises(ValueError):
        signing.create_access_token(
            {"user_id": str(uuid.uuid4()), "email": "x@y.z"},
            audience="hermes-something-else",
        )


def test_expired_token_is_rejected(signing, tenant_a):
    from shared.auth import TENANT_AUDIENCE
    from shared.exceptions import UnauthorizedError

    token = signing.create_access_token(
        {
            "user_id": str(uuid.uuid4()),
            "email": "x@y.z",
            "tenant_id": tenant_a,
            "membership_id": str(uuid.uuid4()),
        },
        expires_delta=timedelta(seconds=-30),
        audience=TENANT_AUDIENCE,
    )
    with pytest.raises(UnauthorizedError):
        signing.verify_token(token, expected_audience=TENANT_AUDIENCE)


def test_tenant_claims_survive_round_trip(signing, tenant_a):
    from shared.auth import TENANT_AUDIENCE

    membership_id = str(uuid.uuid4())
    token = signing.create_access_token(
        {
            "user_id": "11111111-1111-1111-1111-111111111111",
            "email": "u@acme.test",
            "tenant_id": tenant_a,
            "membership_id": membership_id,
            "auth_method": "microsoft",
        },
        audience=TENANT_AUDIENCE,
    )
    data = signing.verify_token(token, expected_audience=TENANT_AUDIENCE)
    assert data.tenant_id == tenant_a
    assert data.membership_id == membership_id
    assert data.auth_method == "microsoft"
    assert data.jti  # replay/denetim icin benzersiz kimlik


# =============================================================================
# 2) Host → tenant cozumu
# =============================================================================

def _seed_tenant(db, tenant_id, slug, *, status="active", hostname=None,
                 verified=True):
    db.execute(text(
        "INSERT INTO tenants (id, slug, display_name, status, "
        "default_locale, timezone, placement_mode, placement_key, "
        "version, created_at, updated_at) VALUES "
        "(CAST(:id AS uuid), :slug, :name, :status, 'tr-TR', "
        "'Europe/Istanbul', 'shared', 'shared-default', 1, now(), now()) "
        "ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status"
    ), {"id": tenant_id,
        # Slug GLOBAL benzersizdir; testler ayni DB'yi paylastigi icin
        # tenant kimligine bagli benzersiz bir slug uretiyoruz.
        "slug": f"{slug}-{tenant_id[:8]}",
        "name": slug.title(), "status": status})
    if hostname:
        db.execute(text(
            "INSERT INTO tenant_domains (id, tenant_id, hostname, kind, "
            "verification_status, verified_at, is_primary, created_at, "
            "updated_at) VALUES (gen_random_uuid(), CAST(:t AS uuid), "
            ":h, 'custom', :vs, now(), false, now(), now()) "
            "ON CONFLICT (hostname) DO NOTHING"
        ), {"t": tenant_id, "h": hostname,
            "vs": "verified" if verified else "pending"})
    db.commit()


def test_verified_host_resolves_tenant(pg_session, tenant_a):
    from app.services.tenant_resolver import resolve_by_hostname

    host = f"{uuid.uuid4().hex[:10]}.hermes.test"
    _seed_tenant(pg_session, tenant_a, "acme", hostname=host)

    resolved = resolve_by_hostname(pg_session, host)
    assert resolved.id == tenant_a
    assert resolved.slug.startswith("acme-")


def test_unverified_domain_does_not_resolve(pg_session, tenant_a):
    """Dogrulanmamis domain tenant cozmez.

    Aksi halde biri kendi tenant'ina baskasinin hostname'ini ekleyip o
    adrese gelen istekleri kendi organizasyonuna yonlendirebilirdi.
    """
    from app.services.tenant_resolver import (
        WorkspaceNotFound, resolve_by_hostname,
    )

    host = f"{uuid.uuid4().hex[:10]}.hermes.test"
    _seed_tenant(pg_session, tenant_a, "acme", hostname=host,
                 verified=False)

    with pytest.raises(WorkspaceNotFound):
        resolve_by_hostname(pg_session, host)


def test_unknown_host_is_not_found(pg_session):
    from app.services.tenant_resolver import (
        WorkspaceNotFound, resolve_by_hostname,
    )

    with pytest.raises(WorkspaceNotFound):
        resolve_by_hostname(pg_session, "hic-yok.example.invalid")


def test_suspended_tenant_is_unavailable_not_missing(pg_session, tenant_b):
    """Askiya alinmis tenant, 'yok' DEGIL 'kullanilamaz' doner.

    Ikisi ayri sinif: kullanici bir hata ekrani gormeli, "boyle bir
    workspace yok" mesaji degil.
    """
    from app.services.tenant_resolver import (
        WorkspaceUnavailable, resolve_by_hostname,
    )

    host = f"{uuid.uuid4().hex[:10]}.hermes.test"
    _seed_tenant(pg_session, tenant_b, "globex", status="suspended",
                 hostname=host)

    with pytest.raises(WorkspaceUnavailable):
        resolve_by_hostname(pg_session, host)


def test_hostname_normalisation_ignores_port_and_case(pg_session, tenant_a):
    from app.services.tenant_resolver import resolve_by_hostname

    host = f"{uuid.uuid4().hex[:10]}.hermes.test"
    _seed_tenant(pg_session, tenant_a, "acme", hostname=host)

    assert resolve_by_hostname(pg_session, f"{host.upper()}:8443").id == (
        tenant_a
    )
    assert resolve_by_hostname(pg_session, f"{host}.").id == tenant_a


def test_workspace_path_is_disabled_by_default(pg_session, monkeypatch, tenant_a):
    """`/w/{slug}` yalnizca acikca etkinlestirilirse calisir.

    Production'da host disinda bir tenant secme yolu OLMAMALIDIR.
    """
    from app.services import tenant_resolver

    monkeypatch.delenv("HERMES_ALLOW_WORKSPACE_PATH", raising=False)
    _seed_tenant(pg_session, tenant_a, "acme")

    with pytest.raises(tenant_resolver.WorkspaceNotFound):
        tenant_resolver.resolve_by_slug(pg_session, f"acme-{tenant_a[:8]}")

    monkeypatch.setenv("HERMES_ALLOW_WORKSPACE_PATH", "true")
    slug = f"acme-{tenant_a[:8]}"
    assert tenant_resolver.resolve_by_slug(pg_session, slug).slug == slug


# =============================================================================
# 3) Uyelik ve tenant-scoped RBAC
# =============================================================================

def _mk_user(db, email=None, *, active=True):
    from app.models.user import User

    u = User(
        id=uuid.uuid4(),
        email=email or f"u-{uuid.uuid4().hex[:8]}@x.com",
        full_name="T",
        hashed_password="x",
        is_admin=False,
        is_active=active,
    )
    db.add(u)
    db.commit()
    return u


def _add_membership(db, tenant_id, user_id, status="active"):
    from app.models.tenancy import TenantMembership

    m = TenantMembership(
        tenant_id=uuid.UUID(tenant_id), user_id=user_id, status=status
    )
    db.add(m)
    db.commit()
    return m


def _grant(db, tenant_id, user, perms, code=None):
    from app.models.rbac import RbacRole, RbacUserRole

    role = RbacRole(
        tenant_id=uuid.UUID(tenant_id),
        code=code or f"r-{uuid.uuid4().hex[:8]}",
        name="Role",
        permissions=sorted(perms),
    )
    db.add(role)
    db.flush()
    db.add(RbacUserRole(
        tenant_id=uuid.UUID(tenant_id), user_id=user.id, role_id=role.id
    ))
    db.commit()
    return role


def test_same_identity_has_different_permissions_per_tenant(pg_session, tenant_a, tenant_b):
    """WS3'un cikis kriteri: A'da admin, B'de member.

    Bu, izinlerin JWT'ye gomulmemesinin ve her cozumun (tenant, user)
    uzerinden yapilmasinin somut kanitidir.
    """
    from shared.permissions import Perm
    from app.services.rbac_service import effective_permissions

    _seed_tenant(pg_session, tenant_a, "acme")
    _seed_tenant(pg_session, tenant_b, "globex")

    user = _mk_user(pg_session)
    _add_membership(pg_session, tenant_a, user.id)
    _add_membership(pg_session, tenant_b, user.id)

    _grant(pg_session, tenant_a, user,
           [Perm.USERS_MANAGE, Perm.REPORTS_VIEW])
    _grant(pg_session, tenant_b, user, [Perm.REPORTS_VIEW])

    perms_a = effective_permissions(
        pg_session, user.id, tenant_id=uuid.UUID(tenant_a)
    )
    perms_b = effective_permissions(
        pg_session, user.id, tenant_id=uuid.UUID(tenant_b)
    )

    assert Perm.USERS_MANAGE in perms_a
    assert Perm.USERS_MANAGE not in perms_b      # A'nin yetkisi B'ye SIZMAZ
    assert Perm.REPORTS_VIEW in perms_a and Perm.REPORTS_VIEW in perms_b


def test_permissions_require_active_membership(pg_session, tenant_a):
    """Uyelik askiya alininca rol atamasi DURSA BILE izin kalmaz."""
    from shared.permissions import Perm
    from app.models.tenancy import TenantMembership
    from app.services.rbac_service import effective_permissions

    _seed_tenant(pg_session, tenant_a, "acme")
    user = _mk_user(pg_session)
    membership = _add_membership(pg_session, tenant_a, user.id)
    _grant(pg_session, tenant_a, user, [Perm.REPORTS_VIEW])

    assert Perm.REPORTS_VIEW in effective_permissions(
        pg_session, user.id, tenant_id=uuid.UUID(tenant_a)
    )

    membership.status = "suspended"
    pg_session.commit()

    assert effective_permissions(
        pg_session, user.id, tenant_id=uuid.UUID(tenant_a)
    ) == frozenset()


def test_role_of_another_tenant_grants_nothing(pg_session, tenant_a, tenant_b):
    """B'nin rolu A baglaminda hicbir sey vermez."""
    from shared.permissions import Perm
    from app.models.rbac import RbacUserRole
    from app.services.rbac_service import effective_permissions

    _seed_tenant(pg_session, tenant_a, "acme")
    _seed_tenant(pg_session, tenant_b, "globex")

    user = _mk_user(pg_session)
    _add_membership(pg_session, tenant_a, user.id)
    role_b = _grant(pg_session, tenant_b, user, [Perm.USERS_MANAGE])

    # Bozuk/kotu niyetli bir atama: B'nin rolu, A'nin atamasiyla.
    pg_session.add(RbacUserRole(
        tenant_id=uuid.UUID(tenant_a), user_id=user.id,
        role_id=role_b.id,
    ))
    pg_session.commit()

    # Rolun tenant'i eslesmedigi icin izin AKMAZ.
    assert effective_permissions(
        pg_session, user.id, tenant_id=uuid.UUID(tenant_a)
    ) == frozenset()


def test_switchable_memberships_exclude_suspended_tenants(pg_session, tenant_a, tenant_b):
    """Organizasyon secici, girilemeyecek bir tenant'i GOSTERMEZ."""
    from app.services.membership_service import list_switchable_memberships

    _seed_tenant(pg_session, tenant_a, "acme")
    _seed_tenant(pg_session, tenant_b, "globex", status="suspended")

    user = _mk_user(pg_session)
    _add_membership(pg_session, tenant_a, user.id)
    _add_membership(pg_session, tenant_b, user.id)

    slugs = {
        m["slug"] for m in list_switchable_memberships(
            pg_session, user_id=user.id
        )
    }
    # Yalnizca kullanilabilir tenant listelenir; askiya alinmis olan YOK.
    assert slugs == {f"acme-{tenant_a[:8]}"}


def test_directory_filter_drops_non_members(pg_session, tenant_a, tenant_b):
    """S2S dizin cozumu, baska tenant'in kimligini DONDURMEZ."""
    from app.services.membership_service import assert_user_ids_are_members

    _seed_tenant(pg_session, tenant_a, "acme")
    _seed_tenant(pg_session, tenant_b, "globex")

    member = _mk_user(pg_session)
    outsider = _mk_user(pg_session)
    _add_membership(pg_session, tenant_a, member.id)
    _add_membership(pg_session, tenant_b, outsider.id)

    allowed = assert_user_ids_are_members(
        pg_session,
        tenant_id=uuid.UUID(tenant_a),
        user_ids=[member.id, outsider.id],
    )
    assert allowed == [member.id]


def test_last_admin_guard_counts_within_tenant(pg_session, tenant_a, tenant_b):
    """A'nin son admini, B'de admin olan biri var diye dusurulemez."""
    from fastapi import HTTPException
    from app.services import rbac_service as svc

    _seed_tenant(pg_session, tenant_a, "acme")
    _seed_tenant(pg_session, tenant_b, "globex")

    admin_a = _mk_user(pg_session)
    admin_b = _mk_user(pg_session)
    _add_membership(pg_session, tenant_a, admin_a.id)
    _add_membership(pg_session, tenant_b, admin_b.id)

    svc.bootstrap_tenant(pg_session, tenant_id=uuid.UUID(tenant_a))
    svc.bootstrap_tenant(pg_session, tenant_id=uuid.UUID(tenant_b))
    pg_session.commit()

    for tenant_id, user in ((tenant_a, admin_a),
                            (tenant_b, admin_b)):
        role = svc.get_role_by_code(
            pg_session, svc.SYSTEM_ADMIN_CODE,
            tenant_id=uuid.UUID(tenant_id),
        )
        from app.models.rbac import RbacUserRole

        pg_session.add(RbacUserRole(
            tenant_id=uuid.UUID(tenant_id), user_id=user.id,
            role_id=role.id,
        ))
    pg_session.commit()

    # A'nin TEK admini dusurulemez — B'deki admin sayilmaz.
    with pytest.raises(HTTPException) as exc:
        svc.enforce_last_admin_guard(
            pg_session, losing_user_id=admin_a.id,
            tenant_id=uuid.UUID(tenant_a),
        )
    assert exc.value.status_code == 409
