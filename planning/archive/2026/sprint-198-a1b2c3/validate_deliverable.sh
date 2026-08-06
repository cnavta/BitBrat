#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating Sprint 198 Deliverables..."

# 1. Validate firebase.json
echo "🔍 Checking firebase.json..."
grep -q '"pubsub": {}' firebase.json || (echo "❌ pubsub key missing in firebase.json"; exit 1)
grep -q '"host": "0.0.0.0"' firebase.json || (echo "❌ 0.0.0.0 binding missing in firebase.json"; exit 1)
grep -q '"hub":' firebase.json || (echo "❌ hub config missing in firebase.json"; exit 1)

# 2. Validate nats-driver.ts
echo "🔍 Checking nats-driver.ts for stream provisioning..."
grep -q "jsm.streams.add({ name: streamName, subjects })" src/services/message-bus/nats-driver.ts || (echo "❌ Stream provisioning missing in nats-driver.ts"; exit 1)

# 3. Validate base-server.ts
echo "🔍 Checking base-server.ts for relaxed env validation..."
grep -q "optionalLocally" src/common/base-server.ts || (echo "❌ Relaxed env validation missing in base-server.ts"; exit 1)

# 4. Dry-run deployment to check env merge and compose config
echo "🧱 Running dry-run deployment..."
BITBRAT_ENV=local ./infrastructure/deploy-local.sh --dry-run

echo "✅ Validation successful!"
