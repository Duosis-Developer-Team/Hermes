# =============================================================================
# Dev-only sahte kullanici tohumu (app/jobs/dev_seed.py)
# =============================================================================
#   1. Kapi: hermes-test imzasinda (HERMES_ENVIRONMENT=test) ya da bayraksiz
#      exit 2, DB'ye baglanilmaz.
#   2. Idempotent: iki kosu ayni sayilari verir.
#   3. Purge yalnizca isaretli sahte kullanicilari (+ uyelik/rol) siler;
#      gercek kullanici ve uyeligi kalir.
#   4. Sahte kullanici giris YAPAMAZ: parolasiz, .invalid e-posta, admin degil.
# =============================================================================

import uuid

import pytest
from sqlalchemy import text

from shared import dev_seed as guard

SLUG = "dev-seed-auth-test"


def test_main_refuses_outside_dev(monkeypatch, capsys):
    from app import database
    from app.jobs import dev_seed

    def _boom(*a, **k):
        raise AssertionError("DB must not be opened when the guard refuses")

    monkeypatch.setattr(database, "SessionLocal", _boom)
    monkeypatch.delenv("KUBERNETES_SERVICE_HOST", raising=False)
    monkeypatch.delenv("PUBLIC_API_ENV", raising=False)

    monkeypatch.setenv("HERMES_ENVIRONMENT", "test")  # hermes-test imzasi
    assert dev_seed.main(["--yes-dev"]) == guard.EXIT_REFUSED
    assert dev_seed.main(["--yes-dev", "--purge"]) == guard.EXIT_REFUSED

    monkeypatch.setenv("HERMES_ENVIRONMENT", "dev")
    assert dev_seed.main([]) == guard.EXIT_REFUSED  # bayrak yok
    monkeypatch.setenv("PUBLIC_API_ENV", "live")
    assert dev_seed.main(["--yes-dev"]) == guard.EXIT_REFUSED
    assert "refused" in capsys.readouterr().err


@pytest.fixture()
def tenant_world(pg_session):
    from app.models.rbac import RbacRole
    from app.models.tenancy import Tenant, TenantMembership
    from app.models.user import User

    s = pg_session
    s.execute(text("DELETE FROM tenants WHERE slug = :s"), {"s": SLUG})
    s.commit()
    tenant = Tenant(id=uuid.uuid4(), slug=SLUG, display_name="Seed Test", status="active")
    real = User(id=uuid.uuid4(), email="gercek.kisi@example.com", full_name="Gerçek Kişi",
                hashed_password=None, is_active=True, is_admin=False)
    s.add_all([tenant, real])
    s.flush()
    role = RbacRole(id=uuid.uuid4(), tenant_id=tenant.id, code="member", name="Member",
                    permissions=["tasks.access"], is_system=True, is_active=True)
    s.add_all([role, TenantMembership(tenant_id=tenant.id, user_id=real.id, status="active")])
    s.commit()
    yield {"tenant": tenant, "real": real, "role": role}
    s.rollback()
    s.execute(text("DELETE FROM tenants WHERE slug = :s"), {"s": SLUG})
    s.execute(text("DELETE FROM users WHERE id = :u"), {"u": real.id})
    s.commit()


def _counts(s, tenant_id):
    return (
        s.execute(text("SELECT count(*) FROM users")).scalar(),
        s.execute(text("SELECT count(*) FROM tenant_memberships WHERE tenant_id = :t"),
                  {"t": tenant_id}).scalar(),
        s.execute(text("SELECT count(*) FROM rbac_user_roles WHERE tenant_id = :t"),
                  {"t": tenant_id}).scalar(),
    )


def test_seed_is_idempotent_and_purge_removes_only_demo_users(pg_session, tenant_world):
    from app.jobs import dev_seed
    from app.models.user import User

    s = pg_session
    tid = tenant_world["tenant"].id
    before = _counts(s, tid)

    first = dev_seed.seed(s, tenant_slug=SLUG)
    s.commit()
    n = len(guard.DEMO_USERS)
    assert first["created"] == {"users": n, "memberships": n, "roles": n}
    after_first = _counts(s, tid)
    assert after_first == (before[0] + n, before[1] + n, before[2] + n)

    second = dev_seed.seed(s, tenant_slug=SLUG)
    s.commit()
    assert second["created"] == {"users": 0, "memberships": 0, "roles": 0}
    assert _counts(s, tid) == after_first

    for spec in guard.demo_users():
        u = s.get(User, spec["id"])
        assert u.hashed_password is None and not u.is_admin and u.is_active
        assert u.email.endswith("@" + guard.DEMO_EMAIL_DOMAIN)

    result = dev_seed.purge(s)
    s.commit()
    assert result["deleted"] == {"rbac_user_roles": n, "tenant_memberships": n, "users": n}
    assert _counts(s, tid) == before
    assert s.get(User, tenant_world["real"].id) is not None
