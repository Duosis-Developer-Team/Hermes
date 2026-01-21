-- =============================================================================
-- HERMES PLATFORM - Auth Database Schema
-- Database: auth_db
-- =============================================================================

-- 1. Eklentiler (Extensions)
-- UUID fonksiyonları için gereklidir (Postgres < 13 için pgcrypto, >= 13 için gen_random_uuid native)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. USERS (Kullanıcılar) Tablosu
-- Tüm kullanıcı kimlik bilgileri burada tutulur.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255),
    hashed_password VARCHAR(255) NOT NULL,
    
    -- Rol ve Yetki Alanları
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    role VARCHAR(50) DEFAULT 'user', -- Gelecekteki RBAC geliştirmeleri için
    
    -- Durum
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Zaman Damgaları
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
