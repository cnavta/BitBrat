#!/usr/bin/env bash
set -e

echo "🔧 Installing dependencies..."
npm install

echo "🧱 Compiling..."
npm run build

echo "🧪 Running tests..."
npm test

echo "✅ Validation complete for Sprint 31 deliverable."
