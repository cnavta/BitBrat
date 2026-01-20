#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating Sprint 200 Remediations..."

# 1. Verify firebase.json
echo "🔍 Checking firebase.json..."
if grep -q '"host": "0.0.0.0"' firebase.json && \
   grep -q '"pubsub": {' firebase.json && \
   grep -q '"pubsub": {}' firebase.json; then
  echo "✅ firebase.json: Correct host and service activation found."
else
  echo "❌ firebase.json: Missing required configuration."
  exit 1
fi

# 2. Verify Docker Compose Healthcheck
echo "🔍 Checking docker-compose.local.yaml healthcheck..."
if grep -q "curl -sf http://localhost:4000 && curl -sf http://localhost:8080" infrastructure/docker-compose/docker-compose.local.yaml; then
  echo "✅ docker-compose.local.yaml: Toughened healthcheck found."
else
  echo "❌ docker-compose.local.yaml: Healthcheck not updated."
  exit 1
fi

# 3. Verify NATS Driver
echo "🔍 Checking nats-driver.ts for double-subscription fix..."
if grep -q "if (queue) opts.queue(queue);" src/services/message-bus/nats-driver.ts && \
   ! grep -q "conn.subscribe(subj, { queue })" src/services/message-bus/nats-driver.ts; then
  echo "✅ nats-driver.ts: Double-subscription fix verified."
else
  echo "❌ nats-driver.ts: Double-subscription logic still present or incomplete."
  exit 1
fi

# 4. Dry-run deployment
echo "🏗️ Running dry-run deployment..."
./infrastructure/deploy-local.sh --dry-run
echo "✅ Dry-run deployment successful."

echo "🎉 All validations passed!"
