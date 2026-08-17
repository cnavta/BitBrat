#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating documentation artifacts..."

# Check for existence of required files
DOCS=(
    "documentation/architecture/system-architecture.md"
    "documentation/architecture/technical-architecture.md"
)

for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        echo "✅ Found $doc"
    else
        echo "❌ Missing $doc"
        exit 1
    fi
done

# Check for placeholder text (like "...")
if grep -r "\.\.\." documentation/architecture/; then
    echo "❌ Placeholder text found in documentation!"
    exit 1
fi

echo "✅ Validation complete."
