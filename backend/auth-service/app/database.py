# =============================================================================
# HERMES PLATFORM - Auth Service Database Configuration
# =============================================================================
# Bu dosya, PostgreSQL veritabanı bağlantısını ve SQLAlchemy session
# yönetimini sağlar. Tüm veritabanı işlemleri bu modül üzerinden yapılır.
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

# SQLAlchemy engine oluştur
# pool_pre_ping: Bağlantı havuzundaki bağlantıların canlı olup olmadığını kontrol eder
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,          # Havuzdaki minimum bağlantı sayısı
    max_overflow=20,       # Havuz dolduğunda ekstra oluşturulabilecek bağlantı
    echo=settings.DEBUG    # SQL sorgularını logla (debug modunda)
)

# Session factory
# autocommit=False: Transaction'ları manuel kontrol et
# autoflush=False: Her query öncesi otomatik flush yapma
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Model base class
# Tüm SQLAlchemy modelleri bu base'den türetilir
Base = declarative_base()


# =============================================================================
# Database Dependency (FastAPI)
# =============================================================================

def get_db() -> Generator[Session, None, None]:
    """
    Veritabanı session'ı sağlayan dependency.
    
    FastAPI dependency injection sistemiyle kullanılır. Her istek için
    yeni bir session oluşturur ve istek tamamlandığında kapatır.
    
    Yields:
        SQLAlchemy Session instance
    
    Kullanım:
        @router.get("/users")
        def get_users(db: Session = Depends(get_db)):
            return db.query(User).all()
    
    Not:
        Generator pattern ile context management sağlanır.
        finally bloğu, hata olsa bile session'ın kapanmasını garanti eder.
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
    """
    Veritabanı tablolarını oluşturur.
    
    Bu fonksiyon uygulama başlatıldığında çağrılır ve tanımlı tüm
    SQLAlchemy modellerinin tablolarını veritabanında oluşturur.
    
    Not:
        Mevcut tablolar varsa üzerine yazmaz (checkfirst=True default).
        Production'da migration tool (Alembic) kullanılması önerilir.
    """
    # Import models to register them with Base
    from . import models  # noqa: F401
    
    # Create all tables
    Base.metadata.create_all(bind=engine)


def drop_db() -> None:
    """
    Tüm veritabanı tablolarını siler.
    
    UYARI: Bu fonksiyon sadece test ortamında kullanılmalıdır!
    Production'da asla çağrılmamalıdır.
    """
    Base.metadata.drop_all(bind=engine)
