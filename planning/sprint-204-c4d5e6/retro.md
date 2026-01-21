# Sprint Retro – sprint-204-c4d5e6

## What Worked
- Phased implementation allowed for incremental testing of the data layer before exposing it via MCP.
- Extending `McpServer` in `AuthServer` was straightforward thanks to the base class.
- The event-driven architecture effectively decoupled the moderation intent (Auth service) from the implementation (Ingress-Egress service).

## What Didn't
- Testing SSE/MCP full flow with `supertest` is complex due to the nature of persistent connections and the MCP SDK's transport handling. Settled for verifying tool registration and individual component logic.
- Local service naming introduction had a minor networking bug due to inconsistent network naming in Docker Compose files, which was quickly resolved.

## Future Improvements
- Add more granular permissions to MCP tools (only allow specific users or roles to call admin tools).
- Implement unban functionality.
