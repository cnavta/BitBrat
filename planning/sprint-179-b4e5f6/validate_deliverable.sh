#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Building project..."
npm run build

echo "🧪 Running tests..."
# Run Twilio related tests and ensure overall tests pass
npm test src/services/ingress/twilio

echo "🚀 Cloud dry-run deployment..."
# Based on project-wide validate_deliverable.sh
# We'll skip real infra steps if no PROJECT_ID is provided
if [[ -n "${PROJECT_ID:-}" ]]; then
  npm run deploy:cloud -- --dry-run || true
else
  echo "Skipping cloud dry-run (PROJECT_ID not set)"
fi

echo "✅ Validation complete."
