# Key Learnings – sprint-139-08cdff

- Connector interfaces simplify adding new chat systems without touching core flow.
- Per-instance egress topics continue to scale for multi-connector setups.
- Clear config contracts (env + YAML) reduce operational risk.
 - Disabled-mode guards (e.g., DISCORD_ENABLED=false, NODE_ENV=test) are essential to keep CI hermetic.
 - Small, focused tests around connectors (unit + integration with mocks) provide confidence without external I/O.
