#!/usr/bin/env bash
# Validation for sprint-329-bf2d2b (Scheduler: full InternalEventV2 events + optional emit topic).
# Real, idempotent, logically passable (AGENTS.md §2.6). No mutation; exits non-zero on build/test failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
echo "📂 Repo root: $REPO_ROOT"

# Make node/npm available when provided via nvm (non-interactive shells).
if ! command -v npm >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    echo "ℹ️  npm not on PATH; sourcing nvm and selecting Node 20."
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
  fi
fi
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not available."; exit 1; }
echo "🔧 node $(node --version 2>/dev/null) / npm $(npm --version 2>/dev/null)"

echo "📦 Installing dependencies..."
if [ -f package-lock.json ]; then
  npm ci || { echo "⚠️  npm ci failed; falling back to npm install (logged)."; npm install; }
else
  npm install
fi

echo "🧱 Building project (prod + test compile)..."
npm run build

echo "🧪 Running the full Jest suite..."
npm test

echo "🔢 Version-parity dry run (architecture.yaml / package.json / package-lock.json)..."
npm run release:dry -- patch || { echo "❌ release:dry failed (version files likely disagree)."; exit 1; }

echo "🎯 Targeted scheduler suite (sprint-329 deliverable):"
npx jest tests/apps/scheduler-service.spec.ts

echo "✅ Validation complete."
