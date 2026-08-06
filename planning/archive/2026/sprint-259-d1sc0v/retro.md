# Retro – sprint-259-d1sc0v

## What worked
- Quick identification of the session-based RBAC as the bottleneck for tool discovery.
- Reproduction test clearly demonstrated the issue and verified the fix.
- Agent allowlist bypass provides a clean way for trusted services to discover tools while maintaining per-user RBAC.

## What didn't work
- Initial investigation took some time to rule out hardcoded limits in `ToolRegistry`.
- The sprint was left open without publication metadata and later required an explicit force-close override.

## Learnings
- Service-to-service connections for proxies need special consideration in RBAC systems, especially when the discovery and invocation phases happen at different times with different contexts.
- Sprint closure should be completed in the same session as validation/publication whenever possible.
