#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running tests..."
npx jest infrastructure/scripts/extract-config.test.ts tests/services/command-processor/routing-advance.spec.ts

echo "✅ Validation complete."
