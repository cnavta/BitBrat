#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
npm test

echo "📄 Verifying architecture document exists and has required sections..."
DOC="documentation/technical-architecture/prompt-assembly-v1.md"
test -f "$DOC"
grep -q "# Prompt Assembly Framework – v1" "$DOC"
grep -q "## Canonical Structure" "$DOC"
grep -q "## TypeScript Thin Layer Design" "$DOC"
grep -q "## Provider Mappings" "$DOC"

echo "✅ Validation complete."
