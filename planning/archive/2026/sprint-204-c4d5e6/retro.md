# Sprint Retro – sprint-204-c4d5e6

## What Worked
- Phased implementation allowed for incremental testing of the data layer before exposing it via MCP.
- Extending `McpServer` in `AuthServer` was straightforward thanks to the base class.
- The event-driven architecture effectively decoupled the moderation intent (Auth service) from the implementation (Ingress-Egress service).

## What Didn't
- Testing SSE/MCP full flow with `supertest` is complex due to the nature of persistent connections and the MCP SDK's transport handling. Settled for verifying tool registration and individual component logic.
- Local service naming introduction had a minor networking bug due to inconsistent network naming in Docker Compose files, and a secondary issue where the "external" network was not pre-created by the deploy script. Both were resolved by standardizing names and adding an explicit `docker network create` step to the deployment script.
- **Network Label Mismatch**: Encountered `network bitbrat-network was found but has incorrect label com.docker.compose.network`. This happened because the network was created manually without the specific labels Docker Compose expects when managing a network with a custom name. Resolved by restoring `external: true` in the base compose file and enhancing `deploy-local.sh` to create the network with correct labels (or recreate it if labels are wrong).
- **Tool Schema Evolution**: Adding the `notes` field and the `get_user` tool late in the sprint required updating both the `UserRepo` and the `AuthServer` schemas. Maintaining backward compatibility in search queries (supporting both ID and Platform/Username) added slight complexity to the logic.

## Future Improvements
- Add more granular permissions to MCP tools (only allow specific users or roles to call admin tools).
- Implement unban functionality.
