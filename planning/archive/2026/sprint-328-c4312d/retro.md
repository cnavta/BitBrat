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

## Close-out notes (2026-06-28)
- Two in-sprint follow-ups landed after P0–P3: **BL-328-203** (llm-bot prompt logging lists included
  ContextPacks via shared subheader helpers — detection can't drift from rendering) and **BL-328-204**
  (state-engine `propose_mutation` stopped returning false-positive success for disallowed keys; added
  `user.fact.*`). Both green; committed `7bde2ed`.
- **Publication friction repeated:** no `gh` CLI / `GITHUB_TOKEN` in the environment, so the PR still
  couldn't be auto-created. Owner accepted closure without an auto-PR (Rule S13b); branch is pushed and the
  PR only needs a one-click manual open. Follow-up: provision `gh`/token so future sprints can satisfy S12
  automatically.
- **Truthful tool results > silent async drop:** BL-328-204 reinforced a guideline — when a tool fronts a
  fire-and-forget pipeline, validate synchronously and surface `isError` rather than reporting success the
  async consumer later rejects.
