# Implementation Plan – sprint-324-00782d (The Bit Model & Universal MCP Control Plane)

> This plan is the sprint-local pointer to the **owner-approved** planning artifacts:
> - Execution plan: `planning/bit-model/execution-plan.md` (mirrored here as `execution-plan.md`)
> - Backlog: `planning/bit-model/backlog.yaml` (working copy here as `backlog.yaml`)
> - Design: `documentation/architecture/bit-model-technical-architecture.md` (ADR-001..004 ACCEPTED)

## Objective
Promote MCP from a per-service subclass decision into the base abstraction (`Bit`) so every Bit speaks
MCP; expose a mandatory `bit.*` control plane that Brat administers fleet-wide; codify duplicated LLM
scaffolding into composable profiles. Additive, behavior-preserving, reversible.

## Scope
- **In:** `src/common/**` (base abstraction, MCP fold-down, profiles), the Brat control surface
  (`tools/brat`), additive `architecture.yaml` changes, conformance tests, `validate_deliverable.sh`.
- **Out:** Domain/business logic of individual services (only their base-class wiring changes).

## Deliverables
- Phase R: additive `architecture.yaml` ratification (`profile:`, `mcp.exposure`, default `MCP_AUTH_TOKEN`,
  `bit:` glossary, §6.3 promotion note) passing `brat config validate`.
- Phase 0: `Bit` (renamed from `BaseServer`) + deprecated `BaseServer` alias; MCP transport/registration
  folded into `Bit` gated by `mcp.exposure`; `McpServer` reduced to thin exposure-selecting subclass.
- Phase 1: mandatory `bit.*` toolset + RBAC scopes + token auth + redaction; registry self-publish for
  every Bit; 6 no-MCP Bits promoted to `platform-only`; Brat fleet MCP client; conformance suite + `hello-bit`.
- Phase 2: composition mechanism (`applyProfiles`) + profile→mixin enforcement; Eventing/Resources/
  McpClient/Llm profiles; `bit.llm.*` tools; refit `llm-bot`, `query-analyzer`, `stream-analyst`.
- Phase 3: `McpServer` compat shim; remove `extends McpServer` from production; retire `BaseServer` alias;
  CHANGELOG + bootstrap templates updated.
- Phase V: `validate_deliverable.sh` extended; verification-report/retro/key-learnings; PR.

## Acceptance Criteria
Per-phase exit gates GR/G0/G1/G2/G3/GV as defined in `execution-plan.md` §5 and `backlog.yaml`.

## Testing Strategy
Jest (TypeScript); behavior-preservation (existing tests pass unchanged at each gate); Platform Ring
conformance suite; RBAC/redaction negative tests; deployment-target parity assertions (PubSub vs NATS).

## Deployment Approach
Parity across GCP (Cloud Run/Cloud Build), Local Docker (Compose), Remote Docker (`ssh://`). No
GCP-only/Compose-only assumptions in the base abstraction.

## Dependencies
Existing commons: `src/common/{mcp,llm,prompt-assembly,resources,feature-flags.ts,logging.ts}`, `tools/brat`.

## Definition of Done
AGENTS.md §3 DoD; `validate_deliverable.sh` logically passable; full suite + build green.
