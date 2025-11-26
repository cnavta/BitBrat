#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building..."
npm run build

echo "🧪 Running tests..."
npm test

# Optional: Dry-run infrastructure planning via brat when available.
# Keeping this non-blocking for planning phase; uncomment when Phase 3 synth exists.
# echo "🧪 Dry-run infra plan (optional) ..."
# node dist/tools/brat/src/cli/index.js infra plan --dry-run || true

echo "✅ Validation steps completed successfully."
