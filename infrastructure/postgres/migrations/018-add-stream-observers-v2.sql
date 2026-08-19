-- Migration: 018-add-stream-observers-v2
-- Purpose: Add stream_observers table for event-stream-analyzer Phase 2
-- Sprint: sprint-19-c3762f
-- Date: 2026-08-19
--
-- REVISION: Changed from individual JSONB columns to single 'data' column
-- to be compatible with IDocumentStore interface
--
-- This migration creates the stream_observers table to persist observer configurations
-- for the event-stream-analyzer service. Observers define real-time event stream
-- windows with filters, triggers, and delivery configurations.

-- Drop existing table if it exists (from v1 migration)
DROP TABLE IF EXISTS stream_observers CASCADE;

-- Create stream_observers table compatible with IDocumentStore
CREATE TABLE stream_observers (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_stream_observers_active
  ON stream_observers((data->>'active'));

CREATE INDEX idx_stream_observers_created_at
  ON stream_observers(created_at DESC);

-- Create GIN index on data column for efficient JSONB queries
CREATE INDEX idx_stream_observers_data_gin
  ON stream_observers USING GIN (data);

-- Add comment for documentation
COMMENT ON TABLE stream_observers IS
  'Event stream observer configurations for real-time event analysis with sliding/tumbling/session windows';

COMMENT ON COLUMN stream_observers.data IS
  'StreamObserver: Full observer configuration (source, window, trigger, analysis, delivery, active, mcpEnabled)';

-- Insert test observer (active=true so it loads on startup)
INSERT INTO stream_observers (id, data, created_at, updated_at)
VALUES (
  'test-twitch-chat-5min',
  jsonb_build_object(
    'id', 'test-twitch-chat-5min',
    'active', true,
    'mcpEnabled', true,
    'source', jsonb_build_object(
      'mode', 'stream',
      'topics', jsonb_build_array('internal.contextualization.v1'),
      'filters', jsonb_build_object(
        'platforms', jsonb_build_array('twitch'),
        'eventTypes', jsonb_build_array('chat.message.v1')
      )
    ),
    'window', jsonb_build_object(
      'type', 'sliding',
      'sizeMs', 300000,
      'slideMs', 60000
    ),
    'trigger', jsonb_build_object(
      'type', 'time'
    ),
    'analysis', jsonb_build_object(
      'promptId', 'stream-analyst-v1',
      'inspectionEnabled', false,
      'outputFormat', 'markdown'
    ),
    'delivery', jsonb_build_object(
      'egressTopic', 'internal.egress.v1',
      'destination', jsonb_build_object(
        'type', 'chat',
        'target', 'default'
      )
    ),
    'createdAt', NOW()::text,
    'updatedAt', NOW()::text
  ),
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Verification queries (run after migration)
-- SELECT COUNT(*) FROM stream_observers;
-- SELECT id, data->>'active' as active, data->'window'->>'type' as window_type FROM stream_observers;
-- SELECT id, data FROM stream_observers WHERE (data->>'active')::boolean = true;
