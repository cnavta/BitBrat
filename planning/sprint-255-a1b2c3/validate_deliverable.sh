#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating documentation..."

DOCS_DIR="documentation/services/state-engine"
FILES=("technical-overview.md" "runbook.md" "rule-examples.md")

for file in "${FILES[@]}"; do
  if [ ! -f "$DOCS_DIR/$file" ]; then
    echo "❌ Missing deliverable: $DOCS_DIR/$file"
    exit 1
  fi
  echo "✅ Found $DOCS_DIR/$file"
  
  # Basic structure check (at least one H1)
  if ! grep -q "^# " "$DOCS_DIR/$file"; then
    echo "❌ No H1 found in $DOCS_DIR/$file"
    exit 1
  fi
done

echo "🔍 Checking for broken links (placeholders)..."
if grep -r "TODO" "$DOCS_DIR"; then
  echo "❌ Found TODO in documentation"
  exit 1
fi

echo "✅ Validation complete."
