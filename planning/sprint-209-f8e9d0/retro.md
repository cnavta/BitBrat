# Sprint Retro – sprint-209-f8e9d0

## What Worked
- **McpServer Foundation**: Inheriting from `McpServer` provided immediate access to logging and configuration, simplifying the bootstrap.
- **Messaging Abstractions**: The `PublisherResource` and `onMessage` helpers made it easy to integrate with the platform without worrying about the underlying transport.
- **Test-Driven Refinement**: Unit tests helped identify type mismatches in `InternalEventV2` early.

## Challenges
- **WebSocket Upgrade Auth**: Manually handling the HTTP `upgrade` event was necessary to perform Bearer token validation before the WebSocket connection is fully established.
- **Type Mismatches**: `InternalEventV2` did not have `createdAt` as a direct property (inherited fields were different than expected), requiring a small fix in the managers.
- **Environment Overlays**: Discovered that the `brat` tool's service bootstrap did not include `env_file` support in generated Docker Compose files, causing local configuration issues.

## Future Improvements
- Implement a generic WebSocket service base class if more gateways are planned.
- Add support for token rotation/refresh events.
- Improve the `brat` tool to automatically sync `.yaml` overlays to `.env` files for local development.
