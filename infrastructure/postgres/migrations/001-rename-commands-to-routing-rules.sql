-- Migration: Rename commands table to routing_rules
-- Date: 2026-07-16
-- Reason: "commands" is misleading; "routing_rules" better describes event router rules

-- Check if commands table exists and routing_rules doesn't
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'commands')
     AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'routing_rules')
  THEN
    -- Rename table
    ALTER TABLE commands RENAME TO routing_rules;

    -- Rename indexes
    ALTER INDEX IF EXISTS idx_commands_pattern RENAME TO idx_routing_rules_pattern;
    ALTER INDEX IF EXISTS idx_commands_active RENAME TO idx_routing_rules_active;

    RAISE NOTICE 'Successfully renamed commands → routing_rules';
  ELSIF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'routing_rules')
  THEN
    RAISE NOTICE 'Table routing_rules already exists, skipping migration';
  ELSE
    RAISE NOTICE 'Table commands does not exist, skipping migration';
  END IF;
END
$$;
