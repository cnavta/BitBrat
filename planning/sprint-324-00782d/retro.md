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

## Carry-forward (next sprint)
- BL-204 Brat fleet MCP client + direct-connect break-glass.
- BL-300–304 composition mechanism + Eventing/Resources/McpClient/Llm profiles + `bit.llm.*` + refits.
- BL-400/401 remove `extends McpServer` from production, update bootstrap templates, retire `BaseServer`
  alias at the end of the migration window. Note the prototype-chain/spy coupling above when doing so.
