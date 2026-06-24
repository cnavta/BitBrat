#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Sprint-321 validation: tool-gateway env-var references in MCP server config
# Logically passable per AGENTS.md §2.6:
#   1. Build the whole project (tsc) — production + test code must compile.
#   2. Run the new shared env-interpolation utility suite.
#   3. Run the new MCP env/args resolution suite (client-manager).
#   4. Run a tool-gateway / MCP regression check.
# -----------------------------------------------------------------------------

# Path fix for local environment (node provisioned via nvm here).
export PATH="$HOME/.nvm/versions/node/v20.19.3/bin:$PATH:/opt/homebrew/bin"

# Run from the repository root regardless of where the script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

echo "🔧 Installing dependencies..."
# npm ci  # Skipped: the local environment is already provisioned for this task.

echo "🧱 Building project..."
npm run build

echo "🧪 Running shared env-interpolation utility suite..."
npm test -- tests/common/env-interpolation.spec.ts

echo "🧪 Running MCP env/args resolution suite..."
npm test -- tests/common/mcp/env-refs.spec.ts

echo "🧪 Running tool-gateway / MCP regression check..."
npm test -- \
  tests/common/mcp/reconnect.spec.ts \
  src/apps/tool-gateway.test.ts

echo "✅ Validation complete."
