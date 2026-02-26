-- =============================================================================
-- Migration: Copy contract data from customers to their projects
-- =============================================================================
-- SAFE: No columns are dropped. Only UPDATE on projects where contract fields
-- are currently NULL. Copies from the parent customer row.
-- Idempotent: can be run multiple times safely.
-- =============================================================================

-- For each customer that has contract data, copy it to ALL of their
-- projects (only where the project doesn't already have contract data set).

UPDATE projects p
SET
    contract_start_date   = c.contract_start_date,
    contract_duration_days = c.contract_duration_days
FROM customers c
WHERE p.customer_id = c.id
  AND (c.contract_start_date IS NOT NULL OR c.contract_duration_days IS NOT NULL)
  AND p.contract_start_date IS NULL
  AND p.contract_duration_days IS NULL;

-- NOTE: Customer columns are intentionally NOT dropped.
-- They remain as read-only historical data.
