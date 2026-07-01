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

## REQ-003 — Post-publication test stabilization (owner: "Continue" / flaky test report)
- **At:** 2026-06-30T00:12:00-05:00
- **Prompt summary:** Owner reported `tests/repro_gateway_roles.spec.ts` failing with
  `Parse Error: Expected HTTP/, RTSP/ or ICE/` (1 failed / 283 passed).
- **Interpretation:** Intermittent supertest socket parse error, not a logic regression — the spec
  constructs a fresh `ToolGatewayServer` per test but never tears it down, so handles accumulate
  across the full suite and can surface as a stale/reused-socket parse error under load.
- **Investigation:**
  - Ran the spec in isolation 3x and the full suite — all green for me (1120 passed / 2 skipped).
  - Confirmed the Jest path disables the MCP reconnect monitor (monitorMs=0), ruling out a timer leak;
    root cause is missing per-test teardown of the server resource.
- **Fix:** Added an idempotent `afterEach(async () => server?.close('test-teardown'))` to
  `tests/repro_gateway_roles.spec.ts` (graceful, safe even when the server was never started),
  removing cross-test handle accumulation.
- **Validation:** Spec passes repeatedly; full suite `npm test` 1120 passed / 2 skipped (284/285 suites),
  0 failures, no "Parse Error".
- **Files modified:** `tests/repro_gateway_roles.spec.ts`
- **Status:** Test stabilized; suite green.

## REQ-004 — obs-mcp (active:false) still deployed to remote docker (owner bug report)
- **At:** 2026-06-30T19:04:00-05:00
- **Prompt summary:** "The obs-mcp server was still deployed to a remote docker system even though it is
  marked active:false when a deploy was run. Please investigate and remediate."
- **Interpretation:** Item-1 (deploy honors active:false) was fixed only for the Cloud Run CLI path
  (`selectDeployableServices`). The docker/remote deploy path was missed.
- **Root cause:** `DockerOrchestrator.up()` -> `ComposeFactory.getComposeFiles()` globbed every
  `infrastructure/docker-compose/services/*.compose.yaml` (including `obs-mcp.compose.yaml`) with NO
  `active` filtering, so disabled Bits were built and `up`-ed on local/remote (ssh:// / DOCKER_HOST) targets.
- **Fix:**
  - `ComposeFactory.getComposeFiles(targetService?, inactiveServices?)` now skips inactive per-service
    compose files on `--all` and fails fast when an explicitly named target is inactive (parity with
    `selectDeployableServices`).
  - `DockerOrchestrator.up()` computes the inactive set from `resolveServices(arch)` (canonical
    architecture.yaml `active`) and passes it. `down`/`logs`/`ps` intentionally omit it so a previously
    deployed disabled Bit can still be torn down/inspected.
- **Validation:** `npx tsc --noEmit` clean; new `compose-factory.spec.ts` cases (4) green; full suite
  `npm test` 1124 passed / 2 skipped (284/285 suites), 0 failures.
- **Files modified:** `tools/brat/src/orchestration/docker/compose-factory.ts`,
  `tools/brat/src/orchestration/docker/orchestrator.ts`,
  `tools/brat/src/orchestration/docker/compose-factory.spec.ts`
- **Status:** Remediated; inactive services no longer deploy on any path.

## REQ-005 — Sprint close-out ("Sprint complete.")
- **At:** 2026-07-01T13:49:00-05:00
- **Prompt summary:** Owner said "Sprint complete." (Rule S2/S9).
- **Interpretation:** Formally close sprint-330: commit + push the outstanding deliverables (REQ-003
  test teardown fix, REQ-004 docker active:false remediation) so PR #255 reflects final state, refresh
  verification-report/retro, and set sprint-manifest status=complete.
- **Final validation:** `npx tsc --noEmit` clean; `npm test` 1124 passed / 2 skipped (284/285 suites),
  0 failures.
- **Excluded from commit (intentional):** a stray working-tree edit flipping architecture.yaml `obs-mcp`
  from active:false -> active:true. It is NOT a sprint-330 deliverable and contradicts the REQ-004 bug
  scenario (obs-mcp is the disabled Bit under test), so it is left uncommitted in the working tree.
- **Status:** Sprint complete.
