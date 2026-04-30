-- =============================================================================
-- HERMES PLATFORM - Group Assignment + Task Batch Tracking
-- Database: core_db
-- =============================================================================
-- Adds:
--   1. task_assignment_group_relations  — assigner_user → user_group mapping
--   2. tasks.assignment_batch_id        — links the per-member tasks created
--                                         from a single group assignment
--
-- Additive only — no existing data is modified or removed.
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent (PG 9.6+).
-- The CREATE TABLE / CREATE INDEX statements are also idempotent.
--
-- The new TABLE is also created automatically by SQLAlchemy create_all()
-- on service startup, so applying this file manually is optional. The
-- ALTER TABLE for tasks.assignment_batch_id, however, is performed by
-- a startup migration in core-service main.py for installed deployments
-- (since create_all does not modify existing tables).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- 1. task_assignment_group_relations
CREATE TABLE IF NOT EXISTS task_assignment_group_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assigner_user_id UUID NOT NULL,
    assignee_group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_assignment_group_relation
        UNIQUE (assigner_user_id, assignee_group_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_group_relations_assigner
    ON task_assignment_group_relations(assigner_user_id);

CREATE INDEX IF NOT EXISTS idx_task_assignment_group_relations_assignee_group
    ON task_assignment_group_relations(assignee_group_id);


-- 2. tasks.assignment_batch_id
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS assignment_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_tasks_assignment_batch_id
    ON tasks(assignment_batch_id);
