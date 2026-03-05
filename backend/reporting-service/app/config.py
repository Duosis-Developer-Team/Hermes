# =============================================================================
# HERMES PLATFORM - Reporting Service Configuration
# =============================================================================

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Reporting Service yapılandırma ayarları.
    
    NOT: Bu servis stateless çalışır ve kendine ait veritabanı yoktur.
    Tüm veriler core-service ve auth-service'den API ile çekilir.
    """
    
    SERVICE_NAME: str = "reporting-service"
    SERVICE_VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Mikroservisler arası iletişim URL'leri
    AUTH_SERVICE_URL: str = "http://localhost:8000"
    CORE_SERVICE_URL: str = "http://localhost:8001"
    
    # JWT Configuration — RS256 Asimetrik (KRİTİK-2)
    #
    # reporting-service: YALNIZCA JWT_PUBLIC_KEY kullanır (doğrulama).
    # Private key bu serviste TANIMLI DEĞİL — kasıtlı izolasyon.
    #
    # JWT_PUBLIC_KEY → shared/auth.py'de VERIFY_KEY olarak yüklenir.
    # K8s'te hermes-jwt-public secret'ına bağlıdır.
    
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
