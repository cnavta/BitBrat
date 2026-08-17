#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating assets/index.html..."

# Check for the link
if grep -q "https://github.com/cnavta/BitBrat" assets/index.html; then
    echo "✅ Link found in index.html"
else
    echo "❌ Link NOT found in index.html"
    exit 1
fi

# Check for the white color style
if grep -q "color: #fff" assets/index.html; then
    echo "✅ White color style found"
else
    echo "❌ White color style NOT found"
    exit 1
fi

# Check for the footer ID
if grep -q "id=\"footer\"" assets/index.html; then
    echo "✅ Footer container found"
else
    echo "❌ Footer container NOT found"
    exit 1
fi

echo "✅ Validation complete."
