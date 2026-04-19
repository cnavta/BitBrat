#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running reproduction script..."
npx ts-node repro_repetition.ts | grep -A 5 "## \[Conversation State / History\]"

echo "🧪 Running history redundancy test..."
npm test tests/services/llm-bot/history-redundancy.test.ts

echo "🧪 Running processor memory tests..."
npm test src/services/llm-bot/processor.memory.spec.ts src/services/llm-bot/processor.instance-memory.spec.ts

echo "✅ Validation complete."
