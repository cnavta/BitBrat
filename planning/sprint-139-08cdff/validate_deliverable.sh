#!/usr/bin/env bash
set -euo pipefail

echo "Installing dependencies..."
npm ci

echo "Building project..."
npm run build

echo "Running tests..."
npm test

echo "Starting local environment (optional)..."
npm run local || true

echo "Healthcheck (placeholder)..."
echo "OK"

echo "Stopping local environment..."
npm run local:down || true

echo "Cloud dry-run deployment (optional)..."
npm run deploy:cloud -- --dry-run || true

echo "Validation complete."
