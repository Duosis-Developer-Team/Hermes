-- =============================================================================
-- HERMES PLATFORM - Tasks Module Schema
-- Database: core_db
-- =============================================================================
-- Adds task management tables:
--   1. task_user_permissions      — per-user task access / assignment flags
--   2. task_assignment_relations  — dynamic assigner -> assignee mappings
--   3. task_sub_projects          — task-only sub projects under customer/project
--   4. tasks                      — task records
--
-- All user_id columns are logical references to auth_db.users (no FK).
-- Run in order — depends on existing customers / projects tables.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. task_user_permissions
CREATE TABLE IF NOT EXISTS task_user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    can_access_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    can_assign_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_user_permissions_user UNIQUE (user_id),
    CONSTRAINT chk_task_assign_requires_access CHECK (
        can_access_tasks = TRUE OR can_assign_tasks = FALSE
    )
);

CREATE INDEX IF NOT EXISTS idx_task_user_permissions_user_id
    ON task_user_permissions(user_id);

-- 2. task_assignment_relations
CREATE TABLE IF NOT EXISTS task_assignment_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assigner_user_id UUID NOT NULL,
    assignee_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_task_assignment_relation UNIQUE (assigner_user_id, assignee_user_id),
    CONSTRAINT chk_task_assignment_not_self CHECK (assigner_user_id <> assignee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignment_relations_assigner
    ON task_assignment_relations(assigner_user_id);

CREATE INDEX IF NOT EXISTS idx_task_assignment_relations_assignee
    ON task_assignment_relations(assignee_user_id);

-- 3. task_sub_projects
CREATE TABLE IF NOT EXISTS task_sub_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,

    CONSTRAINT uq_task_sub_projects_project_name UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_task_sub_projects_customer_id
    ON task_sub_projects(customer_id);

CREATE INDEX IF NOT EXISTS idx_task_sub_projects_project_id
    ON task_sub_projects(project_id);

CREATE INDEX IF NOT EXISTS idx_task_sub_projects_active
    ON task_sub_projects(is_active);

-- 4. tasks
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    sub_project_id UUID NOT NULL REFERENCES task_sub_projects(id) ON DELETE RESTRICT,

    title VARCHAR(255) NOT NULL,
    description TEXT,

    assignee_user_id UUID NOT NULL,
    assigner_user_id UUID NOT NULL,

    scheduled_date DATE NOT NULL,
    due_date DATE,
    estimated_duration_minutes INTEGER,

    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    assignee_note TEXT,

    completed_at TIMESTAMPTZ,
    completed_by_user_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,

    CONSTRAINT chk_tasks_estimated_duration CHECK (
        estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0
    ),
    CONSTRAINT chk_tasks_priority CHECK (
        priority IN ('low', 'medium', 'high', 'urgent')
    ),
    CONSTRAINT chk_tasks_status CHECK (
        status IN ('pending', 'in_progress', 'completed', 'cancelled')
    ),
    CONSTRAINT chk_tasks_due_after_scheduled CHECK (
        due_date IS NULL OR due_date >= scheduled_date
    ),
    CONSTRAINT chk_tasks_completion_consistency CHECK (
        (status = 'completed' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL)
        OR
        (status <> 'completed' AND completed_at IS NULL AND completed_by_user_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_tasks_customer_id
    ON tasks(customer_id);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id
    ON tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_sub_project_id
    ON tasks(sub_project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_user_id
    ON tasks(assignee_user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assigner_user_id
    ON tasks(assigner_user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_date
    ON tasks(scheduled_date);

CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_tasks_priority
    ON tasks(priority);

CREATE INDEX IF NOT EXISTS idx_tasks_archived_at
    ON tasks(archived_at);
