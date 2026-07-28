#!/bin/bash
# Diagnostic script to detect duplicate Slack message processing
# Checks for messages with the same Slack timestamp (ts) but different correlation IDs

set -e

CONTEXT=${1:-staging}

echo "🔍 Checking for duplicate Slack message processing in $CONTEXT..."
echo ""

# Get recent Slack ingress events from PostgreSQL
if [ "$CONTEXT" = "staging" ]; then
  DB_URL="postgresql://bitbrat:bitbrat_staging_password@bitbrat.lan:5432/bitbrat"
else
  DB_URL="postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat"
fi

# Query for messages in the last 2 hours, grouped by Slack timestamp
psql "$DB_URL" -c "
SELECT
  (data->'message'->>'id') as slack_ts,
  correlation_id,
  (data->'ingress'->>'ingressAt') as ingress_at,
  (data->'message'->>'text') as message_text
FROM events
WHERE
  data->>'type' = 'ingress.message.v1'
  AND data->'ingress'->>'connector' = 'slack'
  AND (data->'ingress'->>'ingressAt')::timestamptz > NOW() - INTERVAL '2 hours'
ORDER BY slack_ts, ingress_at;
" | head -100

echo ""
echo "🔍 Checking for duplicate Slack ts values..."
echo ""

# Find any Slack ts that appears more than once
psql "$DB_URL" -c "
WITH slack_messages AS (
  SELECT
    (data->'message'->>'id') as slack_ts,
    correlation_id,
    (data->'ingress'->>'ingressAt') as ingress_at,
    (data->'message'->>'text') as message_text
  FROM events
  WHERE
    data->>'type' = 'ingress.message.v1'
    AND data->'ingress'->>'connector' = 'slack'
    AND (data->'ingress'->>'ingressAt')::timestamptz > NOW() - INTERVAL '2 hours'
)
SELECT
  slack_ts,
  COUNT(*) as occurrence_count,
  STRING_AGG(correlation_id, ', ') as correlation_ids,
  MAX(message_text) as message_text
FROM slack_messages
WHERE slack_ts IS NOT NULL
GROUP BY slack_ts
HAVING COUNT(*) > 1
ORDER BY occurrence_count DESC;
"

echo ""
echo "✅ Diagnostic complete"
