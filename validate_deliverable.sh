#!/usr/bin/env bash
set -e

# Enforce running from repo root
if [[ ! -f "package.json" || ! -f "architecture.yaml" ]]; then
  echo "[validate_deliverable] Error: please run this command from the repository root (where package.json and architecture.yaml reside)." >&2
  exit 2
fi

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Compiling..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🚀 Running local deployment..."
npm run local

echo "🚀 Shutting local deployment down..."
npm run local:down

echo "🚀 Running dry-run deployment..."
npm run deploy:cloud -- --dry-run

echo "✅ All validation steps passed."