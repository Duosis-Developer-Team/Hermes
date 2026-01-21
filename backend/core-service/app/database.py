# =============================================================================
# HERMES PLATFORM - Core Service Database Configuration
# =============================================================================
# Bu dosya, PostgreSQL (core_db) veritabanı bağlantısını ve SQLAlchemy session
# yönetimini sağlar.
# =============================================================================

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

from .config import get_settings


# =============================================================================
# Database Engine & Session Configuration
# =============================================================================

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=settings.DEBUG
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


# =============================================================================
# Database Dependency (FastAPI)
# =============================================================================

def get_db() -> Generator[Session, None, None]:
    """
    Veritabanı session'ı sağlayan dependency.
    
    Yields:
        SQLAlchemy Session instance
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =============================================================================
# Database Initialization
# =============================================================================

def init_db() -> None:
    """Veritabanı tablolarını oluşturur."""
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)


def drop_db() -> None:
    """UYARI: Sadece test ortamında kullanın!"""
    Base.metadata.drop_all(bind=engine)
