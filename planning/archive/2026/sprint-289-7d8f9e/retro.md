# Retro – sprint-289-7d8f9e

## What Worked
- Architectural "Image MCP" pattern successfully decoupled generation from core bot logic.
- Refactoring to the standard `McpServer` base class improved code maintainability and reduced redundancy.
- Standardizing context extraction in the base class simplified security enforcement for all MCP servers.
- Vercel AI SDK made DALL-E 3 integration straightforward, though it required specific routing for image models.

## What Didn't
- Missing `openai` package in the base environment required a fallback to `fetch` for moderation API calls.
- `firestore:upsert` failed with `5 NOT_FOUND`, likely due to environment/project mapping issues.
- Encountered specific DALL-E 3 integration issues (aspect ratio warnings and role-based routing) that needed specialized handling in the provider factory.

## Observations
- Using SSE for MCP allows for easier scaling in Cloud Run compared to stdio.
- The `McpServer` abstraction is now more robust and handles security headers consistently.
