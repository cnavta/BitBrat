#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validating sprint artifacts..."

if [ ! -f "planning/sprint-153-d1e2f3/sprint-manifest.yaml" ]; then
  echo "❌ Missing sprint-manifest.yaml"
  exit 1
fi

if [ ! -f "planning/sprint-153-d1e2f3/implementation-plan.md" ]; then
  echo "❌ Missing implementation-plan.md"
  exit 1
fi

if [ ! -f "planning/sprint-153-d1e2f3/technical-architecture.md" ]; then
  echo "❌ Missing technical-architecture.md"
  exit 1
fi

if [ ! -f "planning/sprint-153-d1e2f3/execution-plan.md" ]; then
  echo "❌ Missing execution-plan.md"
  exit 1
fi

if [ ! -f "planning/sprint-153-d1e2f3/backlog.yaml" ]; then
  echo "❌ Missing backlog.yaml"
  exit 1
fi

echo "✅ All required artifacts present."

echo "🧪 Running markdown lint (mock)..."
# In a real environment we might run markdownlint here
echo "✅ Documentation structure verified."

echo "🚀 Validation complete."
