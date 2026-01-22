# Retro – sprint-219-b5c6d7

## What Worked
- Rapid identification of missing environment variables by comparing `architecture.yaml` with the generated compose files.
- Regeneration of all compose files ensured project-wide consistency for service dependencies.

## Challenges
- `llm-bot` was particularly sensitive to startup order since it attempts to connect to multiple MCP servers immediately upon receiving the registry snapshot.

## Learnings
- Always verify that required secrets for service-to-service communication are listed in the `secrets` section of `architecture.yaml` for *all* involved services, not just the providers.
