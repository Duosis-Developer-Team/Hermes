-- =============================================================================
-- Migration: Add contract fields to projects table
-- =============================================================================
-- Safe migration: uses IF NOT EXISTS, no existing columns dropped.
-- =============================================================================

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS contract_start_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS contract_duration_days INTEGER;
