-- =============================================================================
-- HERMES PLATFORM - User Groups + decoupled Task Permission tables
-- Database: core_db
-- =============================================================================
-- Refactor: groups become a general user-organization concept (reusable by
-- future modules). Task-specific permission state is stored separately.
--
-- New tables (additive only — no existing data is touched):
--   1. user_groups                      — generic, named user groups
--   2. user_group_members               — membership + optional title
--   3. task_group_permissions           — per-group task access/assign defaults
--   4. task_group_member_overrides      — per-member tri-state overrides
--
-- IMPORTANT — what is NOT done by this migration:
--   * task_groups and task_group_members tables are deliberately left in
--     place. Application code stops reading/writing them, but the rows
--     remain so any rollback can re-attach them. A separate explicit
--     cleanup migration may drop them later, only after user approval.
--
-- Idempotent — every CREATE uses IF NOT EXISTS. SQLAlchemy create_all()
-- on service startup also produces this exact shape, so manual application
-- of this file is optional.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- 1. user_groups
CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at TIMESTAMPTZ,

    CONSTRAINT uq_user_groups_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_user_groups_is_active
    ON user_groups(is_active);


-- 2. user_group_members
CREATE TABLE IF NOT EXISTS user_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    title VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_group_members_group_user UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_group_members_group_id
    ON user_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_user_group_members_user_id
    ON user_group_members(user_id);


-- 3. task_group_permissions  (per user_group task defaults)
CREATE TABLE IF NOT EXISTS task_group_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE RESTRICT,
    can_access_tasks_default BOOLEAN NOT NULL DEFAULT FALSE,
    can_assign_tasks_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_group_permissions_group UNIQUE (group_id)
);

CREATE INDEX IF NOT EXISTS idx_task_group_permissions_group_id
    ON task_group_permissions(group_id);


-- 4. task_group_member_overrides  (tri-state per user, per group)
CREATE TABLE IF NOT EXISTS task_group_member_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    can_access_tasks_override BOOLEAN,
    can_assign_tasks_override BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_group_member_overrides_group_user UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_group_member_overrides_group_id
    ON task_group_member_overrides(group_id);

CREATE INDEX IF NOT EXISTS idx_task_group_member_overrides_user_id
    ON task_group_member_overrides(user_id);
