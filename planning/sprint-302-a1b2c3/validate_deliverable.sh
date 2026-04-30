#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Checking build..."
# Basic check if it compiles. Since I don't have a specific build command for just this service that is fast, 
# I'll rely on jest doing the compilation.
# npm run build # This might be too slow for the session

echo "🧪 Running tests for llm-bot and instruction annotations..."
npx jest tests/services/llm-bot/instruction-annotation.spec.ts
npx jest tests/services/llm-bot/processor.spec.ts

echo "🔍 Verifying documentation..."
if [ ! -f "planning/sprint-302-a1b2c3/gap-analysis.md" ]; then
  echo "❌ gap-analysis.md is missing!"
  exit 1
fi

if [ ! -f "planning/sprint-302-a1b2c3/technical-architecture-story-enrichment.md" ]; then
  echo "❌ technical-architecture-story-enrichment.md is missing!"
  exit 1
fi

echo "✅ Validation complete."
