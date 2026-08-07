# Retro – sprint-254-d6e7f8

## What worked well
- The MCP `_meta` field provided a clean, standard-compliant way to pass user context without breaking the JSON-RPC structure.
- The use of integration tests proved crucial for verifying the cross-service behavior between the bot and the gateway.

## Challenges
- Jest teardown issues with Firestore in tests, though not blocking the logic validation.
- The SDK Zod schemas are strict, requiring `as any` or custom wrappers to pass metadata that isn't explicitly in the typed wrapper.

## Next Steps
- Consider signed context (JWT) if the gateway is exposed outside a trusted internal network.
- Investigate if dynamic tool discovery per user is needed (currently discovery is session-scoped).
