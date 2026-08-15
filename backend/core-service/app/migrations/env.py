# =============================================================================
# HERMES core-service — Alembic ortami (WS1)
# =============================================================================
# alembic.ini KULLANILMAZ: Config programatik olarak
# shared/migration_runner.py icinde uretilir ve baglanti URL'i
# `config.attributes["database_url"]` uzerinden gelir. Boylece sifre
# hicbir ini dosyasina/loga yazilmaz.
# =============================================================================

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config


def _database_url() -> str:
    url = config.attributes.get("database_url")
    if not url:
        raise RuntimeError(
            "database_url verilmedi — migration'lari "
            "`python -m shared.migration_runner core` ile calistirin."
        )
    return url


def _target_metadata():
    """Autogenerate icin model metadata'si (uygulama modelleri)."""
    import app.models  # noqa: F401 — modelleri Base'e kaydeder
    from app.database import Base

    return Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=_target_metadata(),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from shared.migration_runner import migration_connect_args

    engine = create_engine(
        _database_url(),
        poolclass=pool.NullPool,
        future=True,
        # DDL kilit bekleyisini SINIRLA: unutulmus bir "idle in
        # transaction" baglanti, ALTER TABLE'i sinirsiz bekletir ve
        # arkasina normal trafigi kuyruklar. Fail-fast daha iyidir.
        connect_args=migration_connect_args(),
    )
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=_target_metadata(),
                # Sema karsilastirmasinda tip degisikliklerini de gor.
                compare_type=True,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
