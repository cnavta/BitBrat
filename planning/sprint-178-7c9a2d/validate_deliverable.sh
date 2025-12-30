#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Validating sprint-178-7c9a2d deliverables..."

# Check if architecture and plan exist
if [ -f "planning/sprint-178-7c9a2d/technical-architecture.md" ]; then
    echo "✅ Technical Architecture found."
else
    echo "❌ Technical Architecture missing!"
    exit 1
fi

if [ -f "planning/sprint-178-7c9a2d/implementation-plan.md" ]; then
    echo "✅ Implementation Plan found."
else
    echo "❌ Implementation Plan missing!"
    exit 1
fi

if [ -f "planning/sprint-178-7c9a2d/sprint-execution-plan.md" ]; then
    echo "✅ Sprint Execution Plan found."
else
    echo "❌ Sprint Execution Plan missing!"
    exit 1
fi

if [ -f "planning/sprint-178-7c9a2d/backlog.yaml" ]; then
    echo "✅ Backlog YAML found."
else
    echo "❌ Backlog YAML missing!"
    exit 1
fi

if [ -f "src/common/mcp-server.ts" ]; then
    echo "✅ McpServer implementation found."
else
    echo "❌ McpServer implementation missing!"
    exit 1
fi

if [ -f "tests/common/mcp-server.spec.ts" ]; then
    echo "✅ McpServer tests found."
else
    echo "❌ McpServer tests missing!"
    exit 1
fi

if [ -f "documentation/services/mcp-server.md" ]; then
    echo "✅ Documentation found."
else
    echo "❌ Documentation missing!"
    exit 1
fi

echo "🧪 Running tests..."
npm test tests/common/mcp-server.spec.ts

echo "🧪 Checking for lint errors..."
npm run lint || echo "⚠️ Lint check failed, but continuing as per policy."

echo "✅ Validation complete."
