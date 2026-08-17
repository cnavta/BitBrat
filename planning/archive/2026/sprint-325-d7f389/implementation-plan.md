# Implementation Plan – sprint-325-d7f389 (BL-204 — Brat as a Fleet MCP Client)

- **Role:** Lead Implementor
- **Date:** 2026-06-26
- **Source of truth:** `architecture.yaml` (AGENTS.md §0 precedence). This work is a **consumer** of the
  already-ratified `bit.*` control plane and `mcp.exposure`/`profile` model — it proposes **no** new
  behavioral change to `architecture.yaml` (Law #2 has nothing to ratify here).
- **Source design:** `documentation/architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md`
  (Architect; §§4–9, ADR-003, OQ3/OQ4).
- **Carried forward:** `BL-204` (Phase 1 / Gate G1) from `planning/sprint-324-00782d/backlog.yaml`
  (deferred there; sprint-324 shipped the `bit.*` fabric this sprint consumes).
- **Status:** Planning artifact — **coding forbidden until the owner approves this plan** (AGENTS.md §2.4).

## 1. Objective

Turn Brat into a **fleet MCP client**: a new `brat fleet` command group that **lists** live Bits and
**invokes the universal `bit.*` control plane** on one Bit or fanned out across the fleet. Per **ADR-003**
the default path is **fabric-through-`tool-gateway`** (one discovery + auth + RBAC chokepoint); a
**documented, audited direct-connect break-glass** exists behind an explicit `--direct <bit>` flag for when
the gateway itself is unhealthy. Commands are **fail-closed** on RBAC and behave identically across **GCP /
Local Docker / Remote Docker**.

## 2. Scope

**In scope**
- New `brat fleet` command surface dispatched from `tools/brat/src/cli/index.ts` (TA §4.1).
- New fleet client module `tools/brat/src/fleet/` — `FleetClient` + `gateway-transport` (default) +
  `direct-transport` (break-glass) + `rbac-context` (TA §4.3).
- One **additive read-path/aggregation** change in `src/apps/tool-gateway.ts`: **Bit-qualified addressing**
  for platform (`bit.*`) tools (e.g. id `mcp:<bit>/bit.health`) so identically-named tools are individually
  targetable and discoverable per origin Bit (TA §4.2, Option A).
- Fan-out (`--all`) semantics, fail-closed RBAC, break-glass audit, and the full Jest test matrix (TA §9).

**Out of scope**
- The `bit.*` toolset or its scopes (shipped sprint-324; BL-200/201) — **unchanged**.
- Any Bit's **domain** logic; any **GUI/TUI**; replacing `brat chat` (user plane) or the `llm-bot` tool loop.
- Any new behavioral change to `architecture.yaml` (Law #2).

## 3. Verified Baseline Facts (grounding)

- Brat CLI is a flat router in `tools/brat/src/cli/index.ts` (`if (c1 === 'docker') …`), with `parseArgs`,
  `parseKeyValueFlags`, a structured logger, and a global `--env` flag (`BITBRAT_ENV`). Existing groups:
  `docker`, `backup`, `chat`, `bootstrap`, `setup`, `trigger`.
- Reusable MCP primitives already exist: `src/common/mcp/{client-manager,registry-watcher,bridge,rbac}.ts`;
  Brat will reuse the `@modelcontextprotocol/sdk` `Client` + `SSEClientTransport` wrappers (as
  `McpClientManager` does) rather than re-implement transport.
- `tool-gateway` (`src/apps/tool-gateway.ts`) already aggregates the fleet, exposes a session MCP server on
  `/sse` + `POST /message` and a REST mirror (`GET /v1/tools`, `POST /v1/tools/:id`), and records
  `originServer` + holds each upstream `McpServerConfig` (with `toolPrefix`) — the inputs for §4.2.
- The fabric **flattens identity**: `McpBridge.translateTool` assigns every discovered tool id
  `mcp:<toolName>`, so every Bit's `bit.info` collides (last-writer-wins). This is the core gap.
- Bounded concurrency primitive for read fan-out exists: `tools/brat/src/orchestration/queue.ts`.
- Brat has **no** MCP client today; `brat chat` speaks WebSocket to `api-gateway` (user plane, not control).

## 4. Resolved Decisions (binding for this sprint)

- **ADR-003 — ACCEPTED:** fabric-through-`tool-gateway` is the default; direct-connect is a documented
  break-glass behind an explicit flag.
- **OQ3 — ACCEPTED (PoR):** a resolvable bearer token is **required for the command to engage**; an absent
  token **fails closed** (refuse, non-zero exit) and is logged as a **posture warning**. Resolution order:
  `MCP_AUTH_TOKEN` env → environment-target secret (GCP Secret Manager / `.secure.local` / `ssh://`-synced
  `.env.brat`).
- **OQ4 — ACCEPTED (PoR):** direct-connect break-glass behind `--direct <bit>`; explicit, single-Bit,
  audited (`fleet.break_glass`), never combined with `--all`.
- **Addressing (TA §4.2) — Option A chosen:** gateway-side Bit-qualified aggregation, derived from the
  registry document key (Bit `name`) / `toolPrefix`; smallest additive change, keeps one chokepoint.

## 5. Deliverables

- **Code:** `brat fleet` command group; `tools/brat/src/fleet/` client module (FleetClient + two
  transports + rbac-context); additive Bit-qualified aggregation in `tool-gateway`.
- **Tests (Jest, mocked externals):** discovery, invocation + per-Bit addressing, `--all` fan-out with
  partial-failure tolerance, fail-closed/RBAC scope, break-glass (audit + `--all` rejection), gateway
  addressing regression, and bus-driver parity (`pubsub`/`nats`) per BL-500.
- **Docs:** `brat fleet --help` text + a short operator note (fabric default, `--direct` emergency-only,
  `--all`/`--confirm`), and a `CHANGELOG.md` entry.
- **CI:** new tests wired into `validate_deliverable.sh`.

## 6. Phases & Gates

The work is deliberately small (the control plane, transport, discovery, and RBAC primitives all exist).
It is sequenced **gateway-first** because the Brat client depends on Bit-qualified addressing to target a
specific Bit through the fabric.

### Phase A — Gateway per-Bit addressing (the one new platform affordance) — P0
*The core gap (TA §4.2). Additive read-path/aggregation only; no `bit.*` definition or `architecture.yaml`
change.*
- Expose a **Bit-qualified discovery id** for platform (`bit.*`) tools (e.g. `mcp:<bit>/bit.health`,
  `displayName` unchanged), derived from the registry key (Bit `name`) / `toolPrefix` already on
  `McpServerConfig`, using the `originServer` already tracked per tool (BL2-100).
- Make those qualified ids **invocable** through both the MCP `CallTool` path and the REST mirror
  (`POST /v1/tools/:id`) without regressing existing domain-tool aggregation or RBAC (BL2-101).
- **Gate GA (exit):** `mcp:<bit>/bit.*` is enumerable and invocable per Bit; domain tools unaffected;
  existing gateway tests + new addressing tests green; RBAC still enforced at discovery + invocation.

### Phase B — Fleet client module (Brat side) — P1
- Define the `FleetClient` interface + `rbac-context` (SessionContext build + fail-closed bearer-token
  resolution) (BL2-200).
- Implement `gateway-transport` (DEFAULT): MCP SSE client → `tool-gateway` `/sse`, with `GET /v1/tools` /
  `POST /v1/tools/:id` REST fallback; reuse the SDK `Client`/`SSEClientTransport` wrappers (BL2-201).
- Implement `direct-transport` (BREAK-GLASS): MCP SSE client → a single Bit's registry-published MCP URL
  (BL2-202).
- Implement `FleetClient.discover()/list()/call()/callAll()`, forwarding identity via
  `_meta:{userRoles,userId}`; discovery reads the gateway (qualified ids) and MAY read the Firestore
  `mcp_servers` registry to render `platform-only` Bits with zero domain tools (BL2-203).
- **Gate GB (exit):** FleetClient lists Bits (incl. a platform-only Bit) and calls a Bit-qualified `bit.*`
  over either transport against a mocked gateway/registry; fail-closed when no token resolves.

### Phase C — `brat fleet` command surface — P1
- Dispatch a new `fleet` group from `tools/brat/src/cli/index.ts` (mirroring `docker`/`backup`), with global
  modifiers `--all`, `--direct <bit>`, `--json`, `--env` (BL2-300).
- Wire read subcommands → `bit.*`: `list`, `info`, `health`, `config [--describe]`, `flags <bit> get`
  (`bit:read`) (BL2-301).
- Wire mutating subcommands → `bit.*`: `flags <bit> set`, `log <bit> --level`, `drain`, `shutdown`
  (`bit:operate`), surfacing a clear `Forbidden`/insufficient-scope error rather than retrying (BL2-302).
- Implement `--all` fan-out: read-only by default via the bounded `Queue`
  (`tools/brat/src/orchestration/queue.ts`), per-Bit table / `--json` array, tolerating partial failure
  (down Bit → `unreachable`); mutations are **not** implied by `--all` and require `--confirm`, run
  sequentially with per-Bit logging (BL2-303).
- Implement break-glass guardrails: `--direct <bit>` bypasses the gateway, emits a `fleet.break_glass`
  audit log line (who/which Bit), is single-Bit only, and is **rejected** when combined with `--all`
  (BL2-304).
- **Gate GC (exit):** every command in the TA §4.1 / Appendix A mapping works on the fabric path; mutations
  demand `bit:operate`; `--all` fans out read-only and gates mutations behind `--confirm`; `--direct` is
  audited and `--all`-incompatible.

### Phase V — Validation, parity & close-out
- Full Jest matrix (TA §9): discovery, invocation/addressing, RBAC/fail-closed, break-glass, gateway
  addressing regression (BL2-400).
- **Deployment-target parity** asserted by driving the fleet path against a mocked gateway/registry under
  both `MESSAGE_BUS_DRIVER=pubsub` and `=nats` (per BL-500 harness); discovery uses the registry-published
  external URL so no Cloud-Run-only or Compose-only host assumption is baked in (BL2-401).
- Docs + `CHANGELOG.md`; wire tests into `validate_deliverable.sh`; produce `verification-report.md`,
  `retro.md`, `key-learnings.md`; attempt PR and record in `publication.yaml` (Rules S12/S13) (BL2-500).
- **Gate GV:** `validate_deliverable.sh` logically passable; DoD (AGENTS.md §3) met.

## 7. Sequencing & Dependencies (summary)

```
Phase A (GA: gateway Bit-qualified addressing — the one new affordance)      [P0]
  -> Phase B (GB: FleetClient + gateway/direct transports + rbac-context)    [P1]
       -> Phase C (GC: brat fleet command surface, --all, --direct)          [P1]
            -> Phase V (GV: full test matrix + bus parity + validate + PR)
```

Phase A is the hard prerequisite (without per-Bit addressing the fabric cannot target a single Bit's
`bit.*`). Phase B composes the existing MCP primitives into a Brat-side client. Phase C delivers the
user-visible operator capability. Phase V proves parity and closes out. The trackable breakdown (IDs,
priorities, effort, deps, acceptance) lives in `backlog.yaml` (BL2-100 … BL2-500).

## 8. Acceptance Criteria (sprint-level, maps to TA §9 DoD)

- Brat discovers Bits (incl. a `platform-only` Bit) and offers fleet `bit.info`/`bit.health`/`bit.flags`/
  `bit.drain` (and the full Appendix-A mapping).
- Default path is **fabric-through-gateway**; a documented **`--direct`** break-glass exists, is audited,
  single-Bit, and rejected with `--all`.
- Per-Bit addressing (`mcp:<bit>/bit.*`) works through the fabric **without** regressing domain-tool
  aggregation or RBAC.
- Commands **honor RBAC** (`bit:read` vs `bit:operate`) and **fail closed** without an authorized token
  (non-zero exit + posture warning); secrets stay redacted (no de-redaction client-side).
- `--all` read fan-out tolerates a single unreachable Bit; fleet-wide mutations require `--confirm`.
- **Parity** holds across GCP / Local Docker / Remote Docker (asserted under both bus drivers).
- Jest suite green; wired into `validate_deliverable.sh`; `npm run build` + `npm test` green.

## 9. Testing Strategy (DoD-aligned, AGENTS.md §3 / TA §9)

- **Discovery:** `FleetClient.discover()` lists Bits incl. a platform-only Bit (no domain tools) from a
  mocked registry + gateway.
- **Invocation/addressing:** `call(bit,'bit.health')` and per-Bit ids hit the correct upstream; `--all`
  aggregates and tolerates one unreachable Bit.
- **RBAC / fail-closed:** missing token ⇒ refuse + posture warning; a `bit:read` token cannot
  `bit.shutdown` (expects `Forbidden`); a `bit:operate` token succeeds.
- **Break-glass:** `--direct <bit>` bypasses the gateway, emits the `fleet.break_glass` audit line, and is
  rejected when combined with `--all`.
- **Gateway addressing:** the additive Bit-qualified aggregation exposes/invokes `mcp:<bit>/bit.*` without
  regressing existing domain-tool aggregation or RBAC (extends `tests/apps` gateway coverage).
- **Parity:** fleet path exercised under `MESSAGE_BUS_DRIVER=pubsub` and `=nats` (mockable), per BL-500.
- **Stack:** Jest (TypeScript), external services mocked, `npm test` green, wired into
  `validate_deliverable.sh`.

## 10. Deployment Approach

No new deployable service. Brat ships as the existing CLI artifact (`Dockerfile.brat` / `cloudbuild.brat.yaml`);
the additive `tool-gateway` change rides the existing `tool-gateway` deploy path. Discovery uses each Bit's
**registry self-published** external URL (Cloud Run URL / compose-network host / `ssh://`-resolved host) and
the bus backend (PubSub vs NATS) is **off** the synchronous MCP call path — so no target-specific assumption
is introduced (TA §8). Token source per target: GCP Secret Manager / `.secure.local` / `ssh://`-synced
`.env.brat`.

## 11. Dependencies

- **Upstream (shipped):** the `bit.*` control plane + registry self-publish + RBAC scopes (sprint-324,
  BL-200/201/202). No code dependency on `./deprecated` (Law #4).
- **External systems:** Firestore `mcp_servers` registry; `tool-gateway` `/sse` + `/v1`; a resolvable
  `MCP_AUTH_TOKEN`. All **mocked** in tests.
- **Reused libraries:** `@modelcontextprotocol/sdk` (`Client`, `SSEClientTransport`); existing
  `src/common/mcp/*` primitives; `tools/brat/src/orchestration/queue.ts`.

## 12. Definition of Done (project-wide, AGENTS.md §3)

- Code adheres to project + `architecture.yaml` constraints; no TODOs/placeholders on production paths.
- Tests for all new behavior (Jest), externals mocked, `npm test` green; deferral needs explicit owner
  approval.
- Docs: rationale + operator note + `CHANGELOG.md`; `brat fleet --help`.
- Traceability: every change maps to a BL2-* item and a `request-log.md` entry.
- Deployment-target parity (GCP / Local Docker / Remote Docker) asserted; `validate_deliverable.sh`
  logically passable.

## 13. Definition of Done (this planning artifact)

- [x] BL-204 TA decomposed into phased, gated, accomplishable tasks (companion `backlog.yaml`).
- [x] ADR-003 + OQ3/OQ4 folded into binding decisions and per-phase scope.
- [x] Consumer-only posture made explicit (no `bit.*` or `architecture.yaml` change; Law #2).
- [x] Deployment-target parity captured as an acceptance condition and wired into Phase V.
- [ ] **Owner approval pending** (AGENTS.md §2.4) — implementation begins only on explicit approval /
      "Start sprint."
