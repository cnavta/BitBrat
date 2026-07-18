-- Migration 014: Add serviceName index to prompt_logs table
-- Sprint 344: Support multi-service logging with serviceName discriminator
--
-- In Firestore, serviceName was implicit in the document path:
--   services/{serviceName}/prompt_logs/{logId}
--
-- In PostgreSQL, all services write to a flat prompt_logs table,
-- so we need an explicit serviceName field for filtering.
--
-- This migration adds indexes to support efficient queries by service.

-- Add serviceName index (single field)
CREATE INDEX IF NOT EXISTS idx_prompt_logs_service_name
ON prompt_logs((data->>'serviceName'));

-- Add composite index for service + platform queries
CREATE INDEX IF NOT EXISTS idx_prompt_logs_service_platform
ON prompt_logs((data->>'serviceName'), (data->>'platform'));

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 014 complete: Added serviceName indexes to prompt_logs';
END $$;
