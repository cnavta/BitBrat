#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
# npm ci --quiet # Skipping for speed if already installed, but keeping standard command

echo "🧱 Building project..."
npm run build

echo "🧪 Running Story Engine MCP tests..."
# Run the specific test for this service
npm test src/apps/__tests__/story-engine-mcp.test.ts

echo "🔍 Verifying implementation details..."

# Verify constants in src/types/events.ts
grep -q "INTERNAL_STORY_ENRICH_V1" src/types/events.ts || (echo "❌ Constant INTERNAL_STORY_ENRICH_V1 missing" && exit 1)
grep -q "internal.story.enrich.v1" src/types/events.ts || (echo "❌ Topic internal.story.enrich.v1 missing" && exit 1)

# Verify methods and tools in StoryEngineMcpServer
grep -q "setupEnrichmentConsumer" src/apps/story-engine-mcp.ts || (echo "❌ setupEnrichmentConsumer missing" && exit 1)
grep -q "commit_scene" src/apps/story-engine-mcp.ts || (echo "❌ commit_scene tool missing" && exit 1)
grep -q "publishPersistenceSnapshot" src/apps/story-engine-mcp.ts || (echo "❌ publishPersistenceSnapshot integration missing" && exit 1)

echo "✅ Validation complete."
