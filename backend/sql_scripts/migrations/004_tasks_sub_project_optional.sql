-- =============================================================================
-- HERMES PLATFORM - Tasks Module: make tasks.sub_project_id optional
-- Database: core_db
-- =============================================================================
-- Business rule update: a task can be created directly under a Customer +
-- Project, with the Sub Project being an optional grouping. This migration
-- relaxes the NOT NULL constraint on tasks.sub_project_id.
--
-- This is an additive constraint relaxation:
--   * No data is deleted, truncated, or modified.
--   * Existing rows keep their current sub_project_id values.
--   * The FK to task_sub_projects(id) is retained (still ON DELETE RESTRICT).
--   * Idempotent: safe to re-run (DROP NOT NULL is a no-op when already null).
-- =============================================================================

ALTER TABLE tasks ALTER COLUMN sub_project_id DROP NOT NULL;
