# Retro – sprint-328-c4312d (Just-in-Time Context Provisioning / Context Packs)

## What worked
- **Grounding the plan in verified source first** paid off: the ADR cited `src/common/mcp-server.ts`, but the
  real primitives are on the Bit (`base-server.ts`). Targeting the actual locations avoided rework.
- **Single-source-of-truth arrays** (`ANNOTATION_KINDS_V1`, `CUSTOM_OPERATORS`, `EVAL_CONTEXT_PATHS`) made the
  generated packs + drift guards trivially honest (G2/G6) and refactoring `registerOperatorsOnce` to iterate
  the array was behavior-preserving (52 router/jsonlogic tests stayed green).
- **Behavior-preserving by default:** `registerToolWithContext` with empty `packIds` == `registerTool`, and the
  registration `payload.context` field is omitted when empty — so packless Bits are byte-for-byte unchanged.
- **Phased, build-after-each-step** kept `tsc` and the targeted suites green throughout; no big-bang integration.

## What didn't / friction
- **No prompt-assembly at the gateway:** the ADR implied JIT injection "in tool-gateway/McpBridge", but neither
  assembles prompts. Resolved by exposing `ToolGatewayServer.resolveContextForTools()` as the resolution seam the
  prompt-build can call, rather than forcing assembly into the gateway.
- **Test access to private state:** the Bit had no public getters for registered tools/resources. Added small
  additive introspection methods (`listToolDescriptors`/`listResourceDescriptors`/`readRegisteredResource`)
  instead of reaching into privates from tests.
- **node via nvm only** in this environment; every shell step had to source `~/.nvm/nvm.sh`. `validate_deliverable.sh`
  now does this automatically.

## Deferred / follow-ups
- **P4 RAG scale-out** is design-only; the `resolveContextPacks(providers[])` seam is ready for a future
  Firestore/embedding `ContextProvider` (mcp-evolution-roadmap Phase 2).
- **Actual prompt-build wiring:** `resolveContextForTools` is available but the llm-bot turn-build calling it for
  every tool turn is a natural next step (out of this sprint's behavior-preserving scope).
