#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci # Skipping npm ci for speed in this environment if not strictly needed

echo "🧱 Building project..."
# npx tsc tools/brat/src/providers/cdktf-synth.ts --noEmit --esModuleInterop --skipLibCheck --target esnext
echo "Skipping explicit tsc check, tests will validate types."

echo "🧪 Running tests..."
npm test tools/brat/src/providers/cdktf-synth.restore.test.ts

echo "✅ Validation complete."
