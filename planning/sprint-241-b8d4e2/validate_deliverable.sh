#!/usr/bin/env bash
set -euo pipefail

echo "🧱 Building project..."
npm run build

echo "🔍 Verifying documentation..."
if [ -f "planning/sprint-241-b8d4e2/technical-architecture.md" ]; then
  echo "✅ technical-architecture.md exists."
else
  echo "❌ technical-architecture.md missing."
  exit 1
fi

echo "✅ Validation complete."
