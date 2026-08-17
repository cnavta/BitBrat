# Execution Plan – The Bit Model & Universal MCP Control Plane

- **Role:** Lead Implementor
- **Date:** 2026-06-26
- **Source of truth:** `architecture.yaml` (AGENTS.md §0 precedence) — this work *extends* it additively.
- **Source design:** `documentation/architecture/bit-model-technical-architecture.md` (Architect; §8 phases, §9 ADRs).
- **ADR decisions (owner-accepted, this issue):**
  - **ADR-001 — ACCEPTED, conditioned:** MCP everywhere is approved **provided the existing token/RBAC restrictions apply** (`MCP_AUTH_TOKEN` transport auth + `common/mcp/rbac.ts` scopes). Sensitive Bits stay `platform-only`.
  - **ADR-002 — ACCEPTED:** profiles as **composition / mixins**, not a deepening class tree.
  - **ADR-003 — ACCEPTED:** Brat administers via the **`tool-gateway` fabric** by default; **direct-connect is a documented break-glass** path.
  - **ADR-004 — ACCEPTED:** **soft introduce** — keep the `services:` YAML key (back-compat), introduce "Bit" in code/docs/`bit.*` tooling + a glossary alias.
- **Open-question resolutions (owner, this issue):** all four open questions (§4) **Accepted as Plan of Record**.
- **Planning approval (owner, this issue):** **APPROVED**, conditioned on the resulting implementation supporting **all current deployment targets** — **GCP** (Cloud Run / PubSub / Firestore via Cloud Build + `infrastructure/deploy-cloud.sh`), **Local Docker** (Docker Compose, `infrastructure/docker-compose/docker-compose.local.yaml` via `npm run local` / `deploy-local.sh`), and **Remote Docker** (`ssh://` `brat docker` deployment targets, `DOCKER_HOST=ssh://`). See the new deployment-target-parity constraint in §2.
- **Status:** Pre-sprint planning artifact — **plan approved, implementation pending an explicit "Start sprint."** Per **AGENTS.md Rule S1** no sprint has been started, no branch created, and no implementation code changed. This plan + the companion `backlog.yaml` are the **input** to that sprint.

## 1. Purpose

Turn the accepted Bit-model architecture into a sequenced, gated, trackable set of accomplishable tasks
(companion `backlog.yaml`, BL-001 … BL-500). The thesis is **codification, not green-field**: every
primitive (MCP transport, registry self-publish, RBAC, health, redaction, feature flags, runtime
log-level, graceful `close(reason)`) already exists. The work *relocates* MCP from a per-service subclass
decision (`extends McpServer` vs `extends BaseServer`) down into the base abstraction (`Bit`) so **every
Bit speaks MCP**, and lets **Brat** administer the fleet uniformly through a mandatory `bit.*` control
plane. Scope is **core platform only** (`src/common/**`, the base abstraction, the Brat control surface),
**not** the domain logic of individual services.

## 2. Guiding Constraints

- **Canonical-file discipline (AGENTS.md §0 / Law #2):** `architecture.yaml` changes are **additive**
  (`profile:`, `mcp.exposure`, default `MCP_AUTH_TOKEN`, glossary `bit:` entry). The `services:` key is
  **retained** (ADR-004); nothing a consumer parses (`brat config validate`, `documentation/schemas/`) is
  renamed/removed. The §6.3 behavioral change is **ratified in `architecture.yaml` first** (Phase R) before
  any code promotes MCP to baseline.
- **Behavior-preservation first (Phase 0):** the fold-down is gated behind `mcp.exposure` so existing
  `BaseServer` and `McpServer` services behave **identically** until explicitly flipped. The full test
  suite must stay green at every phase boundary.
- **Security per ADR-001:** default `mcp.exposure: platform-only`; `MCP_AUTH_TOKEN` transport auth and
  per-tool RBAC scopes are mandatory (elevated scopes for `bit.shutdown`/`bit.drain`/`bit.flags.set`,
  low scopes for read-only `bit.info`/`bit.health`); `bit.config.*` **must redact** secrets (reuse
  `prompt-assembly/redaction.ts`); raw `MCP_AUTH_TOKEN`/provider keys are never returned.
- **Composition over inheritance (ADR-002):** profiles are mixins applied over `Bit`; a documented
  `profile:` → mixin map is **enforced at `Bit` bootstrap** so declared intent and runtime capability
  cannot diverge.
- **Reversible & traceable (AGENTS.md §3):** each phase is independently shippable/reversible; each task
  maps to a backlog ID (BL-0xx) and a `request-log.md` entry; all work on a single feature branch.
- **Deployment-target parity (owner approval condition):** every change must keep working across **all
  three current deployment targets** with no target left behind: **GCP** (Cloud Run / Cloud Build,
  `infrastructure/deploy-cloud.sh`, `cloudbuild.*.yaml`), **Local Docker** (Compose,
  `infrastructure/docker-compose/docker-compose.local.yaml`, `npm run local`), and **Remote Docker**
  (`ssh://` `brat docker` targets, `DOCKER_HOST=ssh://`). Concretely: the universal MCP control endpoint,
  `bit.*` surface, registry self-publish, `MCP_AUTH_TOKEN` auth, and `mcp.exposure` defaults must behave
  identically whether messaging is PubSub (GCP) or NATS (Docker) and whether the host is Cloud Run, a
  local engine, or a remote `ssh://` engine. No GCP-only or Compose-only assumptions may be baked into the
  base abstraction; target-parity is asserted in the Phase V validation harness (BL-500).
- **WIP limit = 3** in-progress items at a time.

## 3. Verified Baseline Facts (grounding)

- Two base classes today: `src/common/base-server.ts` (lifecycle/HTTP/health/config/eventing/resources)
  and `src/common/mcp-server.ts` (`extends BaseServer`; adds `Server`, `/sse` + `POST /message`,
  `registerTool/Resource/Prompt`, discovery handlers, `executeTool`, `traceMcpOperation`,
  `publishRegistration()` → `INTERNAL_MCP_REGISTRATION_V1`, `authMiddleware` on `MCP_AUTH_TOKEN`).
- The split is arbitrary: **`extends McpServer` (8)** `auth, api-gateway, event-router, scheduler,
  state-engine, tool-gateway, stream-analyst, obs-mcp, story-engine-mcp, image-gen-mcp`;
  **`extends BaseServer` (6)** `llm-bot, query-analyzer, persistence, disposition, oauth, ingress-egress`.
  The 6 are the §6.3 behavioral-change set (they gain an MCP endpoint).
- Tell: `llm-bot` `extends BaseServer` yet hand-rolls a full MCP **client** stack
  (`common/mcp/client-manager.ts`, `common/mcp/registry-watcher.ts`, a `tool-gateway` connection).
- Reusable commons exist: `src/common/mcp/` (`client-manager`, `registry-watcher`, `rbac`,
  `proxy-invoker`, `bridge`, `stats-collector`, `observability`, `types`), `src/common/llm/provider-factory.ts`,
  `src/common/prompt-assembly/` (`assemble`, `redaction`, adapters), `src/common/feature-flags.ts`,
  `src/common/logging.ts` (runtime log-level), `tools/brat`.
- `registerTool(name, description, schema, handler, { scopes })` **already** carries the RBAC scope hook.

## 4. Resolved Decisions (owner-accepted — all Plan of Record)

The four prior open questions are **resolved**; the owner **Accepted the Plan of Record (PoR)** for each.
These are now binding decisions for the sprint, not open items.

1. **Migration window length — ACCEPTED (PoR):** retire the deprecated `BaseServer = Bit` alias **and** the
   `McpServer` shim at the **Phase 3 exit gate**; surface (and reschedule) only if an out-of-scope (domain)
   service still references them at that point.
2. **`profile:` value set — ACCEPTED (PoR):** ship exactly the four values `[core | llm | mcp-domain |
   gateway]`; `absent ⇒ core`. No fifth profile in this sprint.
3. **Default `MCP_AUTH_TOKEN` provisioning — ACCEPTED (PoR):** the token stays *required for auth to
   engage*; an absent token preserves current behavior (auth disabled) but is logged as a **posture
   warning**. This holds across all deployment targets (GCP Secret Manager, `.secure.local`/`.env.local`
   for local, and the `ssh://`-synced `.env.brat` for remote Docker) and applies to the 6 promoted Bits
   (incl. `persistence`/`oauth`, which additionally stay `platform-only` behind elevated scopes).
4. **Brat break-glass surface (ADR-003) — ACCEPTED (PoR):** a documented direct-connect escape hatch behind
   an explicit CLI flag (e.g. `brat fleet --direct <bit>`); fabric-through-`tool-gateway` remains the
   default path.

## 5. Phases & Gates

### Phase R — Ratify the canonical file first (AGENTS.md Law #2 / doc §6) — P0
*Must complete before any code promotes MCP to baseline.*
- Discovery & baseline inventory: confirm the 8/6 base-class split, which Bits already declare
  `MCP_AUTH_TOKEN`, and the `profile:`→mixin mapping targets (BL-001).
- Extend `architecture.yaml` **additively** (ADR-004): add optional `profile:` per Bit (default `core`);
  add `mcp.exposure: [platform-only | platform+domain]` (default `platform-only`); make `MCP_AUTH_TOKEN`
  a platform default secret; add a `bit:` glossary entry; **document the §6.3 behavioral change** (the 6
  promoted Bits) with ADR-001 justification (BL-002).
- **Gate GR:** `brat config validate` passes against the schema (`documentation/schemas/architecture.v1.json`);
  changes are additive and the file stays backward-compatible; §6.3 promotion is recorded in-file.

### Phase 0 — Alias & fold (behavior-preserving) — P0
- Introduce `Bit` (refactor `BaseServer` → `Bit`); keep `export const BaseServer = Bit` as a **deprecated
  alias** with a one-time deprecation log on use (BL-100).
- Fold the MCP transport (`/sse` + `POST /message`), discovery handlers, `registerTool/Resource/Prompt`,
  `executeTool`, `traceMcpOperation`, and `publishRegistration()` **down into `Bit`**, **gated behind
  `mcp.exposure`** so existing `BaseServer` services see no change until flipped (BL-101).
- Reduce `McpServer` to a subclass that simply selects `platform+domain` exposure; the 8 existing MCP
  services remain behavior-identical (BL-102).
- **Gate G0 (exit):** full suite green; no observable change to any of the 14 services; `extends McpServer`
  still works unchanged; behavior-preservation tests pass; the fold-down introduces **no deployment-target
  coupling** (the `mcp.exposure` gate, transport, and registration build/run identically for GCP, Local
  Docker, and Remote Docker).

### Phase 1 — Platform tools & the universal control plane — P1
- Implement the mandatory `bit.*` toolset registered by the Platform Ring **during `Bit` construction,
  before Business-Ring code**: `bit.info`, `bit.health`/`bit.readiness`, `bit.config.get`/`bit.config.describe`
  (redacted), `bit.flags.get`/`bit.flags.set`, `bit.log.level`, `bit.drain`/`bit.shutdown` (BL-200).
- Apply **RBAC scopes** per tool (ADR-001): elevated for `shutdown`/`drain`/`flags.set`, low for
  read-only `info`/`health`; enforce token auth + secret redaction in `bit.config.*` (BL-201).
- Ensure **registry self-publish** runs for *every* Bit on boot (extend `publishRegistration()` beyond the
  former `McpServer` set) (BL-202).
- Promote the **6 no-MCP Bits** to `platform-only` exposure (gated by Phase R ratification); verify health
  + RBAC; `persistence`/`oauth` stay platform-only behind elevated scopes (BL-203).
- Make **Brat a fleet MCP client** (ADR-003): fleet `bit.*` orchestration commands (`bit.info`/`bit.health`/
  `bit.flags`/`bit.drain`) via the `tool-gateway` fabric, with a documented direct-connect break-glass flag
  (BL-204).
- Add a **Platform Ring conformance suite** + a `hello-bit` fixture asserting the full `bit.*` contract,
  registry presence, and health on every Bit (BL-205).
- **Gate G1 (exit):** Brat can enumerate the fleet and call `bit.*` on every Bit; the 6 promoted Bits pass
  health/RBAC; conformance suite green; secrets never leak through `bit.config.*`.

### Phase 2 — LLM profile (codify the duplication) — P1
- Implement the **composition mechanism** (`applyProfiles`/mixins, ADR-002) and the documented
  `profile:`→mixin map **enforced at `Bit` bootstrap** (BL-300).
- Extract `EventingProfile`, `ResourcesProfile`, `McpClientProfile`, and `LlmProfile` from existing commons
  (`base-server` eventing, `common/resources`, `common/mcp`, `common/llm/provider-factory` +
  `common/prompt-assembly`) (BL-301).
- Add **`bit.llm.*` admin tools** (`bit.llm.model`, `bit.llm.promptPreview` [redacted], `bit.llm.toolFilter`)
  and surface memory/behavioral-guidance knobs as profile config (BL-302).
- Refit **`llm-bot`** onto `LlmProfile` (replacing its hand-rolled `McpClientManager`+`RegistryWatcher`
  dance); behavior identical pre/post (BL-303).
- Refit **`query-analyzer`** and **`stream-analyst`** onto the profile; verify against their existing tests
  (BL-304).
- **Gate G2 (exit):** the three LLM Bits behave identically pre/post; duplication removed; `bit.llm.*`
  tools available and identical across LLM Bits.

### Phase 3 — Deprecate & retire — P2
- `McpServer` becomes a **thin compat shim**; remove `extends McpServer` from production code; update
  `brat service bootstrap` templates and developer docs to the Bit vocabulary (BL-400).
- Retire the `BaseServer` alias at the **end of the migration window**; update `CHANGELOG.md` (BL-401).
- **Gate G3 (exit):** no production code references `extends McpServer`; alias removed; CHANGELOG +
  bootstrap templates updated; docs speak "Bit".

### Phase V — Validation harness & close-out
- Provide/extend `validate_deliverable.sh`: build, run the conformance + full suites, validate
  `architecture.yaml`, assert the `bit.*` contract on a `hello-bit` fixture, **and assert deployment-target
  parity** — the `bit.*`/registration/auth path is exercised against both messaging backends (NATS-backed
  Local/Remote Docker Compose *and* the PubSub-backed GCP path, mockable) so no target regresses; logically
  passable (§2.6) (BL-500).
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; attempt PR and record in
  `publication.yaml` (Rules S12/S13).
- **Gate GV:** `validate_deliverable.sh` is logically passable and DoD (AGENTS.md §3) is met.

## 6. Sequencing & Dependencies (summary)

```
Phase R (GR: ratify architecture.yaml — profile/exposure/glossary/§6.3)   [P0]
  -> Phase 0 (G0: Bit + alias + fold-down, behavior-preserving)            [P0]
       -> Phase 1 (G1: bit.* toolset + RBAC + self-publish + Brat fleet)   [P1]
            -> Phase 2 (G2: composition + LlmProfile + refits)             [P1]
                 -> Phase 3 (G3: McpServer shim, retire alias)             [P2]
                      -> Phase V (GV: validate + docs + PR)
```

Phase R is the hard gate (Law #2). Phase 0 is the riskiest *correctness* step (must be invisible). Phase 1
delivers the user-visible "bossing" capability. Phase 2 pays down the real LLM duplication. Phase 3 removes
the old vocabulary. The detailed, trackable breakdown (IDs, priorities, effort, deps, acceptance) lives in
`backlog.yaml` (BL-001 … BL-500).

## 7. Testing Strategy (DoD-aligned, AGENTS.md §3 / doc §10)

- **Platform Ring contract tests:** a shared conformance suite asserts every Bit (incl. `hello-bit`)
  exposes the full `bit.*` toolset, self-registers, and serves health.
- **Behavior-preservation tests (Phase 0):** existing `McpServer` and `BaseServer` service tests pass
  **unchanged**.
- **Profile tests:** `LlmProfile` unit-tested over provider resolution, prompt assembly/redaction, and
  MCP-client wiring; `query-analyzer`/`stream-analyst` verified against existing tests.
- **RBAC/security tests:** platform-vs-domain scope enforcement; `bit.shutdown` requires elevated scope;
  `bit.config.*` redacts secrets; `platform-only` Bit refuses domain calls; missing `MCP_AUTH_TOKEN`
  behaves and is logged as expected.
- **Stack:** Jest (TypeScript), external services mocked, `npm test` green, integrated into
  `validate_deliverable.sh`.

## 8. Definition of Done (this artifact)
- [x] Accepted Bit-model architecture decomposed into phased, gated, accomplishable tasks.
- [x] ADR-001…004 decisions folded into constraints and per-phase scope.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`, BL-001 … BL-500).
- [x] Canonical-file discipline (Phase R ratification first), behavior-preservation, and security
      constraints made explicit.
- [x] All four open questions **resolved** (owner Accepted the Plan of Record) and folded into §4 as
      binding decisions.
- [x] **Deployment-target-parity** condition (GCP, Local Docker, Remote Docker) captured as a guiding
      constraint (§2) and wired into the Phase 0 and Phase V exit gates.
- [x] **Plan approved** by the owner (conditioned on deployment-target parity).
- [ ] **"Start sprint." to begin implementation (pending, Rule S1 / §2.2). Plan approval is satisfied.**
