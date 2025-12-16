#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "📄 Verifying Technical Architecture doc exists..."
DOC_PATH="documentation/technical-architecture/prompt-assembly-v2-conversation-state.md"
test -f "$DOC_PATH"
grep -q "## \[Conversation State / History\]" "$DOC_PATH"

echo "✅ Validation complete."
