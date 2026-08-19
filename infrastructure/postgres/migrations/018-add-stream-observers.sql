-- Migration: 018-add-stream-observers
-- Purpose: Add stream_observers table for event-stream-analyzer Phase 2
-- Sprint: sprint-19-c3762f
-- Date: 2026-08-19
--
-- This migration creates the stream_observers table to persist observer configurations
-- for the event-stream-analyzer service. Observers define real-time event stream
-- windows with filters, triggers, and delivery configurations.

-- Create stream_observers table
CREATE TABLE IF NOT EXISTS stream_observers (
  -- Primary identification
  id VARCHAR(255) PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT true,
  mcp_enabled BOOLEAN DEFAULT true,

  -- Observer configuration (JSONB for flexibility)
  source JSONB NOT NULL,          -- StreamSourceV4: { mode, topics, filters }
  window JSONB NOT NULL,          -- StreamWindowConfig: { type, sizeMs, slideMs, sessionGapMs }
  trigger JSONB NOT NULL,         -- StreamTriggerV4: { type, timeConfig, countConfig, conditionConfig }
  analysis JSONB NOT NULL,        -- StreamAnalysis: { promptId, inspectionEnabled, outputFormat }
  delivery JSONB NOT NULL,        -- StreamDelivery: { egressTopic, destination }

  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_stream_observers_active
  ON stream_observers(active);

CREATE INDEX IF NOT EXISTS idx_stream_observers_created_at
  ON stream_observers(created_at DESC);

-- Add comment for documentation
COMMENT ON TABLE stream_observers IS
  'Event stream observer configurations for real-time event analysis with sliding/tumbling/session windows';

COMMENT ON COLUMN stream_observers.source IS
  'StreamSourceV4: Event source configuration (mode: stream|database|hybrid, topics, filters)';

COMMENT ON COLUMN stream_observers.window IS
  'StreamWindowConfig: Window configuration (type: sliding|tumbling|session, sizeMs, slideMs, sessionGapMs)';

COMMENT ON COLUMN stream_observers.trigger IS
  'StreamTriggerV4: Trigger configuration (type: time|count|condition)';

COMMENT ON COLUMN stream_observers.analysis IS
  'StreamAnalysis: LLM analysis configuration (promptId, inspectionEnabled, outputFormat)';

COMMENT ON COLUMN stream_observers.delivery IS
  'StreamDelivery: Egress configuration (egressTopic, destination)';

-- Insert example observer for documentation (will be replaced by MCP-created observers)
INSERT INTO stream_observers (id, active, mcp_enabled, source, window, trigger, analysis, delivery, created_at, updated_at)
VALUES (
  'example-twitch-chat-5min',
  false,  -- Not active by default
  true,
  '{"mode": "stream", "topics": ["internal.contextualization.v1"], "filters": {"platforms": ["twitch"], "eventTypes": ["chat.message.v1"]}}'::jsonb,
  '{"type": "sliding", "sizeMs": 300000, "slideMs": 60000}'::jsonb,
  '{"type": "time"}'::jsonb,
  '{"promptId": "stream-analyst-v1", "inspectionEnabled": false, "outputFormat": "markdown"}'::jsonb,
  '{"egressTopic": "internal.egress.v1", "destination": {"type": "chat", "target": "default"}}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Verification queries (run after migration)
-- SELECT COUNT(*) FROM stream_observers;
-- SELECT * FROM stream_observers WHERE active = true;
-- \d stream_observers;
