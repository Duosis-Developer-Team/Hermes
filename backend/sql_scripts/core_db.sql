-- =============================================================================
-- HERMES PLATFORM - Core Database Schema
-- Database: core_db
-- =============================================================================
-- Örnek Çalıştırma Sırası:
-- Bu dosyadaki komutları yukarıdan aşağıya sırasıyla çalıştırın.
-- Tablo bağımlılıkları (Foreign Keys) nedeniyle sıra önemlidir.

-- 1. Eklentiler
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- A. TEMEL TABLOLAR (Bağımlılığı Olmayanlar)
-- ==========================================

-- 1. Customers (Müşteriler)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Work Types (İş Tipleri - örn: Geliştirme, Analiz)
CREATE TABLE IF NOT EXISTS work_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Activity Types (Aktivite Tipleri - örn: Kodlama, Test)
CREATE TABLE IF NOT EXISTS activity_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Platforms (Platformlar - örn: Web, iOS)
CREATE TABLE IF NOT EXISTS platforms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Work Lines (Çalışma Alanları - örn: Support, Ops)
CREATE TABLE IF NOT EXISTS work_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- B. İLİŞKİSEL TABLOLAR (1. Seviye Bağımlılık)
-- ==========================================

-- 6. Projects (Projeler) -> Customers'a bağlı
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    project_key VARCHAR(50) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT uq_projects_customer_name UNIQUE (customer_id, name)
);
CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON projects(customer_id);

-- ==========================================
-- C. DETAY TABLOLAR (2. Seviye Bağımlılık)
-- ==========================================

-- 7. Project Memberships -> Projects'e bağlı
-- Not: user_id Auth DB'dedir, burada Constraint konulamaz.
CREATE TABLE IF NOT EXISTS project_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- Logical Ref to Auth DB
    member_role VARCHAR(80),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT uq_memberships_project_user UNIQUE (project_id, user_id),
    CONSTRAINT chk_membership_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_memberships_project_id ON project_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON project_memberships(user_id);

-- 8. Issues -> Projects'e bağlı
CREATE TABLE IF NOT EXISTS issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_key VARCHAR(50) NOT NULL,
    summary VARCHAR(255),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT uq_issues_project_key UNIQUE (project_id, issue_key)
);
CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(issue_key);

-- ==========================================
-- D. İŞLEM TABLOLARI (En Son Oluşmalı)
-- ==========================================

-- 9. Work Logs (Zaman Kayıtları) -> Her şeye bağlı
CREATE TABLE IF NOT EXISTS work_logs (
    id BIGSERIAL PRIMARY KEY,
    
    -- İlişkiler
    user_id UUID NOT NULL, -- Logical Ref to Auth DB
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    work_type_id UUID NOT NULL REFERENCES work_types(id) ON DELETE RESTRICT,
    
    -- Opsiyonel İlişkiler
    activity_type_id UUID REFERENCES activity_types(id) ON DELETE RESTRICT,
    platform_id UUID REFERENCES platforms(id) ON DELETE RESTRICT,
    work_line_id UUID REFERENCES work_lines(id) ON DELETE RESTRICT,
    
    -- Issue Bağlantısı
    issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
    issue_key_manual VARCHAR(50),
    
    -- Veriler
    date_worked DATE NOT NULL,
    duration_hours DECIMAL(5, 2) NOT NULL,
    description TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Validasyon
    CONSTRAINT chk_work_logs_duration CHECK (duration_hours > 0 AND duration_hours <= 24)
);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_work_logs_user_date ON work_logs(user_id, date_worked);
CREATE INDEX IF NOT EXISTS idx_work_logs_project_date ON work_logs(project_id, date_worked);
CREATE INDEX IF NOT EXISTS idx_work_logs_customer_date ON work_logs(customer_id, date_worked);
CREATE INDEX IF NOT EXISTS idx_work_logs_issue_id ON work_logs(issue_id);
