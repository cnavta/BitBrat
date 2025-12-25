#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running tests..."
npm test tools/brat/src/lb/urlmap/__tests__/from-repo-arch.test.ts tools/brat/src/config/loader.spec.ts

echo "✅ Validation complete."
