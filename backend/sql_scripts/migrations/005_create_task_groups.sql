-- =============================================================================
-- HERMES PLATFORM - Tasks Module: Task Groups
-- Database: core_db
-- =============================================================================
-- Adds two new tables for group-based task permission management:
--   1. task_groups          — named permission groups with default flags
--   2. task_group_members   — user membership with task title + overrides
--
-- Permission semantics (computed in service layer):
--   effective_can_access(user) =
--     is_admin
--     OR direct task_user_permissions.can_access_tasks
--     OR ∃ active group membership where:
--          (member.can_access_tasks_override IS TRUE)
--       OR (override IS NULL AND group.is_active AND group.can_access_tasks_default)
--
--   effective_can_assign — same shape, on the assign columns.
--
-- A FALSE override only suppresses that group's contribution, not other
-- groups' or direct permissions. This keeps multi-group composition
-- intuitive ("any source granting true wins").
--
-- task_title is task-module-specific (e.g. "Senior Developer"); it does not
-- replace the auth users.role.
--
-- Additive only — no existing data is altered. Idempotent (CREATE ...
-- IF NOT EXISTS). SQLAlchemy create_all() will produce the same shape on
-- service startup, so manual application is optional.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS task_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    can_access_tasks_default BOOLEAN NOT NULL DEFAULT FALSE,
    can_assign_tasks_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,

    CONSTRAINT uq_task_groups_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_task_groups_is_active
    ON task_groups(is_active);


CREATE TABLE IF NOT EXISTS task_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES task_groups(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    task_title VARCHAR(255),
    can_access_tasks_override BOOLEAN,
    can_assign_tasks_override BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_group_members_group_user UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_group_members_group_id
    ON task_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_task_group_members_user_id
    ON task_group_members(user_id);
