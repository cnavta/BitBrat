#!/usr/bin/env bash
set -e

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Compiling..."
npm run build

echo "🧪 Running tests..."
npm test

echo "🚀 Running dry-run deployment..."
./scripts/deploy-local.sh --dry-run
./scripts/deploy-cloud.sh --dry-run

echo "✅ All validation steps passed."