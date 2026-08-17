#!/bin/bash
#
# Example: Slack Notification
# Hook Type: post-deploy
# Purpose: Send deployment notification to Slack
#
# Environment Variables Required:
# - SLACK_WEBHOOK_URL: Slack incoming webhook URL
#
# Environment Variables Available:
# - BRAT_CONTEXT_NAME: Execution context name
# - BRAT_SERVICES: Space-separated service names deployed
# - BRAT_DEPLOYMENT_TYPE: Deployment type
# - BRAT_TARGET_HOST: Deployment target
#
# Usage:
# 1. Create Slack incoming webhook: https://api.slack.com/messaging/webhooks
# 2. Store webhook URL in .secure.{context}/.env:
#    SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxx
# 3. Configure in architecture.yaml:
#    executionContexts:
#      staging:
#        deployment:
#          hooks:
#            post-deploy: .brat/hooks/examples/post-deploy-slack-notification.sh
#

set -e
set -u

log() {
  echo "[slack-notification] $*"
}

log "Sending deployment notification to Slack..."

# Check required environment variable
if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  log "WARNING: SLACK_WEBHOOK_URL not set, skipping notification"
  exit 0
fi

# Build notification message
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SERVICES_LIST=$(echo "${BRAT_SERVICES}" | tr ' ' '\n' | sed 's/^/• /' | tr '\n' '\\n')

# Slack message payload (JSON)
PAYLOAD=$(cat <<EOF
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🚀 Deployment Successful",
        "emoji": true
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Environment:*\n${BRAT_CONTEXT_NAME}"
        },
        {
          "type": "mrkdwn",
          "text": "*Type:*\n${BRAT_DEPLOYMENT_TYPE}"
        },
        {
          "type": "mrkdwn",
          "text": "*Target:*\n${BRAT_TARGET_HOST:-local}"
        },
        {
          "type": "mrkdwn",
          "text": "*Time:*\n${TIMESTAMP}"
        }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Services Deployed:*\n${SERVICES_LIST}"
      }
    }
  ]
}
EOF
)

# Send notification
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" \
  "${SLACK_WEBHOOK_URL}")

if [ "${HTTP_CODE}" = "200" ]; then
  log "✓ Notification sent successfully"
else
  log "WARNING: Notification failed (HTTP ${HTTP_CODE})"
  # Don't fail the hook - notification is not critical
fi

exit 0
