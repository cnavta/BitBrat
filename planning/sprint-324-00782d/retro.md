# Retrospective – sprint-324-00782d (The Bit Model & Universal MCP Control Plane)

## What worked
- **Codification, not green-field.** Every primitive existed; the work was relocation. Folding the MCP
  machinery into `Bit` and gating it on `mcp.exposure` let Phase 0 stay perfectly behavior-preserving
  (927→927 tests) before any promotion.
- **Always-construct, conditionally-wire.** Creating the in-memory MCP `Server` for every Bit but only
  wiring the `/sse`/`/message` transport + self-publish when enabled made the fold-down invisible to the
  6 legacy services while making the control plane uniform.
- **Explicit-only promotion.** Reading `mcp.exposure` from `architecture.yaml` and promoting *only*
  explicitly-declared services kept test fixtures MCP-off and the full suite green through the §6.3 flip.
- **Phase R first (Law #2).** Ratifying the canonical file additively (and validating with
  `brat config validate`) before touching code avoided schema/back-compat surprises.

## What didn't / friction
- **Prototype-chain coupling in tests.** Tests `jest.spyOn(BaseServer.prototype, …)` and a base-server
  mock exporting only `BaseServer` forced the decision to keep `McpServer extends BaseServer` and to
  extend (not weaken) one mock. Worth knowing for the eventual alias retirement.
- **Scope vs. one sitting.** The full Phase 2 (composition/LlmProfile refits) and the Brat fleet client
  are sizeable; they were deliberately deferred to keep a green, behavior-preserving slice rather than
  ship a half-done refactor.

## Phase 2 follow-up (completed this sprint, REQ-002)
- **Composition landed cleanly.** `applyProfiles` + per-instance `bootstrapProfiles()` (after
  `initializeMcp`) + the `profile:`→mixin contract gave a working capability-mixin model without any new
  inheritance depth. Enforcing only `llm`⇒`LlmProfile` kept the blast radius tiny while still catching
  declared-vs-runtime drift; the three `llm`-declared services were all in scope, so no other Bit tripped.
- **Lifecycle hooks were the key enabler.** Adding `Bit.onStartup`/`onShutdown` let `McpClientProfile`
  absorb llm-bot's gateway-connect/retry + registry-watcher/teardown dance verbatim (same ordering), so
  the refit was behavior-preserving and the existing tests passed unchanged.
- **One pragmatic deviation:** `McpClientProfile` is a factory (injected `createRegistry`) rather than the
  design's bare singleton, because the per-instance `ToolRegistry` must be shared between the manager and
  the loop. Documented in `verification-report.md`.

## Carry-forward (next sprint)
- BL-204 Brat fleet MCP client + direct-connect break-glass.
- BL-400/401 (Phase 3) remove `extends McpServer` from production, update bootstrap templates, retire the
  `BaseServer` alias at the end of the migration window. Note the prototype-chain/spy coupling above when
  doing so.

## Phase 3 (deprecate & retire — BL-400 / BL-401, Gate G3)
- **What worked:** Passing explicit `mcpExposure: 'platform+domain'` when moving the 10 MCP services to
  `extends Bit` made the migration provably behavior-identical to the old `McpServer` shim, independent of
  any serviceName↔architecture-key mismatch (`stream-analyst` vs `stream-analyst-service`, `api-gateway`'s
  bare `super()`). The full suite stayed green at 267/949 with no test-count change.
- **The retro-flagged coupling, resolved:** the earlier "keep `McpServer extends BaseServer` for the
  prototype spies" compromise was finally unwound. Because services no longer route through
  `BaseServer.prototype`, every `jest.spyOn(BaseServer.prototype, …)` had to be repointed to
  `Bit.prototype` — this was the bulk of the Phase 3 test churn (~40 files) and is the kind of test↔base-
  class coupling worth avoiding in future (spy on the concrete SUT class, not a shared base).
- **Scope clarity:** BL-204 (Brat fleet MCP client + break-glass) is a deferred **Phase 1** item, not part
  of Phase 3; it remains the main carry-forward for a follow-up sprint.
- **`BaseServerOptions` kept:** only the `BaseServer` *class* alias was retired; the options interface is
  pervasive and legitimately named, so renaming it was out of scope (would be churn for no benefit).
