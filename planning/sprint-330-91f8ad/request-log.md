# Request Log – sprint-330-91f8ad

## REQ-001 — Sprint start + planning (Execution Plan & Backlog)
- **At:** 2026-06-29T01:05:00-05:00
- **Prompt summary:** Owner: "We are starting a new sprint." Assume Lead Implementor. Address three
  items (more to be added later): (1) `active: false` services are still deployed but should not be;
  (2) slow Bits (image-gen-mcp, llm-bot) emit at least one duplicate response — suspected timeout/retry
  default issue; (3) add `brat fleet restart <bit-name>`. First task: create an Execution Plan and a
  Trackable Prioritized YAML Backlog.
- **Interpretation:** Open a new sprint (all prior sprints ≤329 verified `complete`, Rule S1/S3),
  branch, and produce planning artifacts only. No implementation until plan approved + "Start sprint".
- **Shell/git commands executed:**
  - `git checkout -b feature/sprint-330-91f8ad-active-deploy-dup-fleet-restart`
  - `mkdir -p planning/sprint-330-91f8ad`
  - Read-only grounding: inspected `tools/brat/src/cli/index.ts` (cmdDeployServices),
    `tools/brat/src/providers/cdktf-synth.ts`, `tools/brat/src/cli/fleet.ts`,
    `src/common/base-server.ts` (bit.* control plane), `src/services/message-bus/*`
    (subscriber-options.ts, pubsub-driver.ts), and `architecture.yaml`.
- **Files created:**
  - `planning/sprint-330-91f8ad/sprint-manifest.yaml`
  - `planning/sprint-330-91f8ad/execution-plan.md`
  - `planning/sprint-330-91f8ad/backlog.yaml`
  - `planning/sprint-330-91f8ad/request-log.md`
- **Status:** PLANNING — awaiting owner approval of the Execution Plan, then "Start sprint" to implement.

## REQ-002 — Implementation (owner: "Docs approved. Start sprint.")
- **At:** 2026-06-29T01:15:00-05:00
- **Prompt summary:** Owner approved the plan and said "Start sprint"; keep backlog statuses current.
- **Interpretation:** Implement all three items with tests + docs, updating backlog item statuses as
  each progressed; bring the sprint to a publishable state.
- **Work performed:**
  - Item 1: `resolveServices` resolves canonical `active`; new `selectDeployableServices` filters
    `--all` and fails fast on explicit inactive target. Tests added.
  - Item 2: shared `dedupe.ts` (correlationId+step+attempt + message-id fallback); pubsub driver uses it
    + explicit `maxExtensionTime`; nats driver gets dedupe + `ackWait` + `msg.working()` lease extension.
    Tests added; existing pubsub/nats mocks updated.
  - Item 3: `bit.restart` tool + overridable `restart()` in base-server; `brat fleet restart` subcommand;
    conformance + fleet specs updated.
  - Docs: bit-control-plane.md, brat.md, CHANGELOG [Unreleased], architecture.yaml messaging tuning knobs.
- **Validation:** `npm run build` clean; `npm test` 1120 passed / 2 skipped (284/285 suites);
  `npm run release:dry -- patch` OK (0.7.3 -> 0.7.4, three sources agree).
- **Status:** Implementation + validation complete; preparing publication (commit + PR attempt).
