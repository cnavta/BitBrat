#!/usr/bin/env bash
set -euo pipefail

# Documentation-only deliverable validation for sprint-317-a4c7e2.
# Performs: required-file checks, JSON validity, internal-link resolution,
# and required-topic coverage in the Part 2 tutorial.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TUTORIAL="documentation/tutorials/lurk-command-part-2.md"
PART1="documentation/tutorials/lurk-command.md"
PERSONALITY="documentation/reference/setup/lurk_personality.json"

echo "🔍 Checking required files exist..."
FILES=(
  "$TUTORIAL"
  "$PART1"
  "$PERSONALITY"
  "planning/sprint-317-a4c7e2/sprint-manifest.yaml"
  "planning/sprint-317-a4c7e2/implementation-plan.md"
  "planning/sprint-317-a4c7e2/request-log.md"
)
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "❌ Missing required file: $f"
    exit 1
  fi
  echo "✅ Found $f"
done

echo "🧱 Validating JSON files..."
if command -v node >/dev/null 2>&1; then
  node -e "JSON.parse(require('fs').readFileSync('$PERSONALITY','utf8'))" \
    && echo "✅ $PERSONALITY is valid JSON"
else
  python3 -c "import json,sys; json.load(open('$PERSONALITY'))" \
    && echo "✅ $PERSONALITY is valid JSON (python)"
fi

echo "🧱 Validating embedded JSON code blocks in the tutorial..."
if command -v node >/dev/null 2>&1; then
  node - "$TUTORIAL" <<'NODE'
const fs = require('fs');
const md = fs.readFileSync(process.argv[2], 'utf8');
const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
if (blocks.length === 0) { console.error('❌ No JSON code blocks found'); process.exit(1); }
blocks.forEach((b, i) => {
  try { JSON.parse(b); } catch (e) { console.error(`❌ JSON block #${i + 1} invalid: ${e.message}`); process.exit(1); }
});
console.log(`✅ All ${blocks.length} JSON code blocks parse cleanly`);
NODE
else
  echo "⚠️  node not available; skipping embedded JSON block check"
fi

echo "🔗 Checking internal links resolve..."
LINKS=(
  "documentation/tutorials/lurk-command.md"
  "documentation/getting-started/quickstart.md"
  "documentation/concepts/event-router-rules.md"
  "documentation/llm-bot-personality.md"
  "documentation/reference/setup/lurk_personality.json"
)
for target in "${LINKS[@]}"; do
  if [ ! -f "$target" ]; then
    echo "❌ Broken internal link target: $target"
    exit 1
  fi
  echo "✅ Link target exists: $target"
done

echo "📝 Checking required topic coverage in $TUTORIAL..."
TOPICS=(
  "Routing to the LLM Bot"
  "internal.llmbot.v1"
  "kind\": \"prompt"
  "Generate a random lurk response for \${user.displayName}"
  "kind\": \"personality"
  "/personalities"
  "default personality"
)
for t in "${TOPICS[@]}"; do
  if ! grep -qF "$t" "$TUTORIAL"; then
    echo "❌ Missing required content: $t"
    exit 1
  fi
  echo "✅ Topic covered: $t"
done

echo "🔁 Verifying Part 1 links forward to Part 2..."
if ! grep -qF "lurk-command-part-2.md" "$PART1"; then
  echo "❌ Part 1 does not link to Part 2"
  exit 1
fi
echo "✅ Part 1 links to Part 2"

echo "✅ Validation complete."
