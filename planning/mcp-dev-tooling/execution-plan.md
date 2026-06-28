# Execution Plan – MCP Dev-Tooling Easy Wins (read / observe / validate / plan)

- **Role:** Lead Developer
- **Date:** 2026-06-26
- **Source of truth:** `architecture.yaml` (AGENTS.md §0 / Law #2) — this work is **additive** to the already-ratified `bit.*` control plane and `mcp.exposure`/`profile` model; it ratifies no new behavioral change beyond the new read-only operator surface.
- **Source assessment:** "What MCP tooling _would_ be useful during development and issue resolution?" (the dev-tooling assessment — the *read/observe/validate/plan* quadrant) and its companion "Would it make sense to expose the `brat` command as MCP tooling?" (the curated, read-only, gateway-mediated, fail-closed posture).
- **Companion docs:** `documentation/architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md` (the `brat fleet` MCP client this consumes); `documentation/tools/brat.md` (the CLI subcommands being wrapped); `documentation/reference/bit-control-plane.md` (the `bit.*` reads being driven).
- **Status:** Pre-sprint planning artifact — **plan drafted, awaiting approval; implementation pending an explicit "Start sprint."** Per **AGENTS.md Rule S1** no sprint has been started, no branch created, and no code changed. This plan + the companion `backlog.yaml` are the **input** to that sprint.

## 1. Purpose

Turn the dev-tooling assessment's **easy wins** into a sequenced, gated, trackable set of accomplishable
tasks (companion `backlog.yaml`, BL-001 … BL-500). The thesis is **expose what already exists, safely**:
every easy win is either (a) a `brat` subcommand that *already* emits `--json` (`config show`,
`config validate`, `doctor`, `release --dry-run`, `infra plan`, `deploy --dry-run`), (b) a `bit.*` read
tool that is *already* MCP on every Bit and aggregated by `tool-gateway` (`bit.info`/`health`/`readiness`/
`config.*`/`flags.get` + `fleet list`), or (c) a pure **read** of repo/registry/Firestore state. The work
*wraps* these as typed MCP tools so an agent stops brittle-parsing human-formatted CLI output — without
handing it any mutating command.

**Explicitly out of scope** (per the assessment's "stay OUT / hard-gate" list): every `bit:operate`
mutation (`flags.set`, `log.level`, `drain`, `shutdown`) and every high-blast-radius `brat` command
(`setup`, `infra apply`, `deploy services --all`, `cloud-run shutdown`, `fleet … --direct` break-glass,
`release --tag`). These remain human-initiated, `--confirm`-gated, single-target, and audited. The
*higher-effort* net-new ask — structured **logs + correlation-trace reads** — is **deferred** out of this
"easy wins" backlog and tracked as a follow-on epic (it is high value but not low effort).

Scope is the **MCP exposure surface only** (the new read-tool definitions + their `tool-gateway` routing
and RBAC mapping), **not** the domain logic of any Bit and **not** the `brat` CLI behavior itself (it is
consumed as-is via its existing `--json` contract).

## 2. Guiding Constraints (the unifying rule)

- **Read-only / idempotent only.** Every tool in this backlog maps to `bit:read` or is a pure read of
  repo/registry/Firestore state. No tool mutates platform state. Anything that *writes* is exposed only as
  its **`--dry-run` / `plan` half** (computes and reports; writes nothing).
- **Gateway-mediated (ADR-003 chokepoint).** Discovery and invocation flow through `tool-gateway` — one
  auth/RBAC/discovery chokepoint. No tool opens a second path around the fabric and none self-authorizes;
  RBAC is **server-authoritative** (the gateway and the Bit decide; the tool only forwards identity).
- **Fail-closed.** No resolvable bearer token ⇒ the tool refuses to run (non-zero / typed error), never a
  silent unauthenticated call. Absent token is logged as a **posture warning** (mirrors OQ3 / `brat fleet`).
- **Redaction preserved.** Config/registry reads inherit the existing **server-side** secret redaction
  (`bit.config.*` `safeConfig`; token *hashes*, never plaintext). No tool performs de-redaction.
- **Typed I/O over CLI parsing.** Each tool has an explicit input/output JSON schema and is driven by the
  subcommand's existing `--json` (or the `bit.*` typed result), so output is machine-stable.
- **Canonical-file discipline (Law #2).** Exposing a new operator surface over MCP is itself an **ADR +
  sprint** item (assessment's process note). The ADR (allowed tool subset, scope mapping, dry-run/audit
  guardrails) lands in Phase R **before** any tool is wired.
- **Deployment-target parity.** Tools must behave identically on **GCP** (Cloud Run / PubSub / Firestore),
  **Local Docker** (Compose / NATS), and **Remote Docker** (`ssh://`); discovery uses the registry-published
  URL and the bus backend is off the synchronous read path. Asserted by BL-500.
- **WIP limit = 3** in-progress items at a time.

## 3. The easy wins (grounded in the assessment)

| # | Easy win | Already exists | Risk | Backlog |
|---|---|---|---|---|
| 1 | `brat config show` / `config validate` / `doctor` as typed MCP reads | `--json`/`--ci` flags exist | Zero blast radius (pure repo/env reads) | BL-200…202 |
| 2 | Drive the `bit.*` **read** plane (`info`/`health`/`readiness`/`config.*`/`flags.get`) over MCP | Already MCP on every Bit, aggregated by gateway | `bit:read`, redacted | BL-210…211 |
| 3 | `fleet list` enumeration as a typed MCP read | `brat fleet list` ships (BL-204) | `bit:read` | BL-212 |
| 4 | `release --dry-run` planning tool | CI-safe, idempotent, in `validate_deliverable.sh` | Writes nothing | BL-300 |
| 5 | `infra plan <module>` / `deploy … --dry-run` planning halves | `--dry-run` exists; mutating halves excluded | Plan only | BL-301 |
| 6 | Read-only Firestore / registry **snapshot** reads | Registry is what `RegistryWatcher` consumes | Reads, hashes only | BL-400 |

The **logs + correlation-trace** reads (assessment §2, the top *net-new* ask) are **deferred** (BL-D01,
follow-on epic) — high value, not an easy win.

## 4. Phases & Gates

### Phase R — Ratify the surface first (ADR + guardrails, Law #2) — P0
*Must complete before any tool is wired.*
- Inventory the candidate subcommands/tools and confirm each emits stable `--json` (or a typed `bit.*`
  result); confirm none in scope mutates state (BL-001).
- Author the ADR: the **allowed read-only/dry-run tool subset**, the **agent→`bit:read` scope mapping**,
  the **gateway-mediated/fail-closed/redaction** guardrails, and the explicit **exclusion list**
  (mutations + break-glass). Define the shared MCP **read-tool harness** contract (typed I/O, token
  resolution, posture warning) reused by every later tool (BL-002).
- **Gate GR:** ADR accepted; guardrails + scope map written; harness contract agreed; exclusion list
  recorded; no `architecture.yaml` behavioral change required beyond the additive exposure note.

### Phase 1 — Deterministic config / schema / doctor reads (zero blast radius) — P1
*The easiest, most immediately useful wins; pure repo/env reads.*
- `config.show` MCP tool wrapping `brat config show --json` (resolved/merged config incl. overlays) (BL-200).
- `config.validate` MCP tool wrapping `brat config validate --json` (`architecture.yaml` vs
  `documentation/schemas/architecture.v1.json`) — lets the agent confirm a change is schema-legal *before*
  proposing it (Law #2) (BL-201).
- `doctor` MCP tool wrapping `brat doctor --json --ci` (env/tooling/auth preflight) (BL-202).
- **Gate G1:** the three tools return typed JSON over the gateway, fail closed, leak no secrets, and run
  identically across all three deployment targets.

### Phase 2 — Fleet read-plane wiring (drive `bit.*` reads + `fleet list`) — P1
*Use the read plane that is already MCP instead of brittle CLI parsing.*
- Typed read tools for the `bit:read` surface: `bit.info`, `bit.health`/`bit.readiness`,
  `bit.config.get`/`bit.config.describe` (redacted), `bit.flags.get` — single-Bit and read-only `--all`
  fan-out, via the gateway (BL-210).
- Fail-closed RBAC + redaction conformance for the read plane (read scope cannot reach any `bit:operate`
  tool; `Forbidden` surfaces cleanly) (BL-211).
- `fleet.list` typed tool enumerating every live Bit (name/profile/exposure), including `platform-only`
  Bits with zero domain tools (BL-212).
- **Gate G2:** an agent can enumerate the fleet and read `bit.*` per-Bit (and read-only `--all`) over MCP;
  no mutating `bit.*` tool is reachable from the read scope; partial-failure tolerated in fan-out.

### Phase 3 — Dry-run planning halves (plan, never apply) — P2
- `release.dryRun` MCP tool wrapping `brat release <bump> --dry-run` (reports the planned version bump
  across the three lockstep files; writes nothing) (BL-300).
- `infra.plan` / `deploy.dryRun` MCP tools wrapping `brat infra plan <module>` and `brat deploy … --dry-run`
  (delta only; the mutating `infra apply` / `deploy --all` are **excluded**) (BL-301).
- **Gate G3:** each tool computes and returns a plan/delta, performs zero writes, and is idempotent/CI-safe.

### Phase 4 — Read-only data-plane reproduction reads — P2
- `registry.snapshot` / Firestore read tools: read the `mcp_servers` registry (and related rules/identities
  / token **hashes**, never plaintext) — "is this Bit actually published/live on this target?" (BL-400).
- **Gate G4:** queries are read-only, return redacted/hashed secrets only, and route through the gateway.

### Phase V — Validation harness & close-out
- Extend `validate_deliverable.sh`: build, run the new tool tests, assert each tool is read-only/fail-closed,
  assert no excluded (mutating) command is reachable, and assert deployment-target parity (mockable, both
  bus backends); logically passable per AGENTS.md §2.6 (BL-500).
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; attempt PR and record in
  `publication.yaml` (Rules S12/S13).
- **Gate GV:** `validate_deliverable.sh` logically passable and DoD (AGENTS.md §3) met.

## 5. Sequencing & Dependencies (summary)

```
Phase R (GR: ADR + guardrails + scope map + read-tool harness)          [P0]
  -> Phase 1 (G1: config.show / config.validate / doctor)               [P1]
  -> Phase 2 (G2: bit.* read plane + fleet.list)                        [P1]
       -> Phase 3 (G3: release/infra/deploy --dry-run planning halves)  [P2]
            -> Phase 4 (G4: read-only Firestore/registry snapshot)      [P2]
                 -> Phase V (GV: validate + docs + PR)
```

Phase R is the hard gate (Law #2 / ADR). Phases 1 and 2 are the highest-value, lowest-risk wins and can
proceed in parallel once the harness exists (respecting the WIP limit). Phases 3–4 layer on the dry-run
and reproduction reads. The **logs/trace** epic (BL-D01) is deferred and not gated here.

## 6. Testing Strategy (DoD-aligned, AGENTS.md §3)

- **Tool-contract tests:** each MCP tool returns its typed schema; output is stable across runs.
- **Fail-closed tests:** no resolvable token ⇒ refuse + posture warning; `bit:read` scope cannot reach any
  `bit:operate` tool (expects `Forbidden`).
- **Redaction tests:** `config.*` / registry reads never return raw `MCP_AUTH_TOKEN`, provider keys, or
  plaintext tokens (hashes only).
- **Dry-run safety tests:** `release/infra/deploy` tools write nothing (assert no file/state mutation) and
  are idempotent.
- **Exclusion tests:** no mutating/break-glass command is reachable from the exposed surface.
- **Parity test:** read path exercised against both `MESSAGE_BUS_DRIVER=pubsub` and `=nats` (mockable).
- **Stack:** Jest (TypeScript), external services mocked, `npm test` green, wired into
  `validate_deliverable.sh`.

## 7. Definition of Done (this artifact)
- [x] Dev-tooling assessment easy wins decomposed into phased, gated, accomplishable tasks.
- [x] The unifying rule (read-only/idempotent, gateway-mediated, fail-closed, redacted, dry-run-only writes)
      captured as guiding constraints and per-phase gates.
- [x] Explicit exclusion list (mutations + break-glass) and the deferred logs/trace epic recorded.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`, BL-001 … BL-500 + BL-D01).
- [x] Deployment-target parity (GCP / Local Docker / Remote Docker) wired into Phase 1 and Phase V gates.
- [ ] **Plan approval** by the owner (pending).
- [ ] **"Start sprint." to begin implementation (pending, Rule S1 / §2.2).**
