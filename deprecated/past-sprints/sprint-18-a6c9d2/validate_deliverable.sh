#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building..."
npm run build

echo "🧪 Running tests..."
npm test -- --passWithNoTests

echo "✅ Validation complete for sprint-18-a6c9d2."
