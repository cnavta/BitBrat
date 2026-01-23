Timestamp: 2026-01-22T20:53:28Z
Prompt summary: Fix MCP connection errors in llm-bot
Interpretation: Missing MCP_AUTH_TOKEN in llm-bot and potential startup race conditions.
Shell/git commands:
- git checkout -b feature/sprint-219-b5c6d7-fix-mcp-connections
- Update architecture.yaml (added MCP_AUTH_TOKEN to llm-bot)
- Update bootstrap-service.js (added depends_on for MCP services)
- Regenerated all service compose files
Files modified:
- architecture.yaml
- infrastructure/scripts/bootstrap-service.js
- infrastructure/docker-compose/services/*.compose.yaml
