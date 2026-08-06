#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Sprint-320 validation: image-gen-mcp prompt logging
# Logically passable per AGENTS.md §2.6:
#   1. Build the whole project (tsc) — production + test code must compile.
#   2. Run the new image-gen-mcp prompt-logging suite.
#   3. Run a llm-bot/query-analyzer prompt-logging regression check.
# -----------------------------------------------------------------------------

# Path fix for local environment (node lives under Homebrew here).
export PATH=$PATH:/opt/homebrew/bin

# Run from the repository root regardless of where the script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

echo "🔧 Installing dependencies..."
# npm ci  # Skipped: the local environment is already provisioned for this task.

echo "🧱 Building project..."
npm run build

echo "🧪 Running image-gen-mcp prompt-logging suite..."
npm test -- tests/services/image-gen-mcp/prompt-logging.test.ts

echo "🧪 Running llm-bot / query-analyzer prompt-logging regression check..."
npm test -- \
  tests/services/llm-bot/prompt-logging.test.ts \
  tests/services/query-analyzer/llm-provider.test.ts

echo "✅ Validation complete."
