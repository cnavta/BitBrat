#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running core app tests..."
npm test -- src/apps/ infrastructure/scripts/

echo "🛡️ Verifying bootstrap safety guards..."
# Create a dummy real file
echo "import { BaseServer } from '../common/base-server'; // Real code here" > src/apps/safety-test.ts
# Attempt to bootstrap it with force - should skip due to safety check
# Note: we use api-gateway name but the script will check the file path derived from architecture.yaml or the provided name.
# We need to make sure the name matches the entry path we are testing.
# For api-gateway, it is src/apps/api-gateway.ts. Let's use that.
echo "import { BaseServer } from '../common/base-server'; // Real code here" > src/apps/api-gateway.ts
npm run bootstrap:service -- --name api-gateway --force 2>&1 | grep "Safety skip" || (echo "FAILED: Safety guard did not trigger"; exit 1)
# Restore the real one we just checked out earlier
git checkout src/apps/api-gateway.ts

echo "✅ Validation complete."
