# Technical Architecture: The Bit Model & Universal MCP Control Plane

> **Status:** Draft for review (pre-sprint design artifact)
> **Author role:** Architect
> **Precedence:** Per `AGENTS.md` Law #2, `architecture.yaml` is the canonical source of truth. This document proposes an extension to it and surfaces the one behavioral conflict that must be ratified there before implementation.
> **Scope:** Core platform only (`src/common/**`, the base abstraction, and the Brat control surface). **Not** the domain implementations of individual services.

---

## 1. Executive Summary

The BitBrat platform today forces a per-service, binary decision: a service either `extends BaseServer` or `extends McpServer`. This split is arbitrary and leaks into the platform's vocabulary, its security posture, and its administrability. The flagship LLM service (`llm-bot`) is the proof of the inconsistency — it `extends BaseServer` (no MCP *server*) yet is one of the heaviest MCP *clients* in the fleet.

This document specifies the **Bit model**: a refactor that promotes MCP from a *subclass decision* to a *baseline capability of the base abstraction itself*. After the refactor there is no `BaseServer` vs `McpServer` choice — there is just a **Bit**, and **every Bit speaks MCP**, even a "Hello World" logging Bit. **Brat** administers the fleet uniformly through that universal MCP surface.

The model is deliberately low-drama: it codifies and collapses an inconsistency that is already ~80% built, rather than inventing new infrastructure.

---

## 2. Current State (Grounded in the Repo)

### 2.1 The two base classes

| Concern | `BaseServer` (`src/common/base-server.ts`) | `McpServer` (`src/common/mcp-server.ts`) |
|---|---|---|
| Lifecycle | `start(port, host)`, `close(reason)`, signal handlers | `extends BaseServer`; overrides `start` to also `publishRegistration()`, overrides `close` to drain transports |
| HTTP | Express app, `onHTTPRequest(path\|cfg, handler)` | adds `/sse` (SSE transport) + `POST /message` routes |
| Health | `/healthz`, `/readyz`, `/livez` via `registerHealth` | inherited |
| Config/secrets | `getConfig`, `getSecret`, `readEnvValue`, env interpolation | inherited; reads `architecture.yaml` for name/version/description |
| Eventing | `onMessage`, routing-slip `next()` / `complete()`, persistence snapshots | inherited |
| Resources | `buildResourceManagers` / `initializeResources` (firestore, storage, publisher) | inherited |
| Architecture awareness | `loadArchitectureYaml`, `computeRequiredKeysFromArchitecture`, `ensureRequiredEnv` | inherited |
| MCP server | — (none) | `Server` instance, `registerTool/Resource/Prompt`, discovery handlers (`tools/list`, etc.), `executeTool`, `traceMcpOperation` |
| Registry self-publish | — | `publishRegistration()` → `INTERNAL_MCP_REGISTRATION_V1` (transport `sse`, external URL, bearer token from `MCP_AUTH_TOKEN`) |
| RBAC / auth | — | `authMiddleware` on `/sse` + `/message` validating `MCP_AUTH_TOKEN` (header `x-mcp-token`, `?token=`, or `Authorization: Bearer`) |

### 2.2 The arbitrary split

- **`extends McpServer` (8):** `auth`, `api-gateway`, `event-router`, `scheduler`, `state-engine`, `tool-gateway`, `stream-analyst`, `obs-mcp`, `story-engine-mcp`, `image-gen-mcp`.
- **`extends BaseServer` (6):** `llm-bot`, `query-analyzer`, `persistence`, `disposition`, `oauth`, `ingress-egress`.

The tell: `llm-bot` extends `BaseServer` yet hand-rolls a full MCP *client* stack (`common/mcp/client-manager.ts`, `common/mcp/registry-watcher.ts`, a `tool-gateway` connection). "Is this an MCP server?" is a per-service coin-flip rather than a platform guarantee.

### 2.3 Pre-existing building blocks the Bit model reuses (not rebuilds)

- **MCP fabric:** `src/common/mcp/` already provides `client-manager.ts`, `registry-watcher.ts`, `rbac.ts`, `proxy-invoker.ts`, `bridge.ts`, `stats-collector.ts`, `observability.ts`, `types.ts`.
- **LLM commons:** `src/common/llm/provider-factory.ts` (provider/model resolution) and `src/common/prompt-assembly/` (`assemble.ts`, `redaction.ts`, adapters).
- **Feature flags:** `src/common/feature-flags.ts` + `feature-flags.manifest.json`.
- **Logging:** `src/common/logging.ts` already supports runtime log-level changes.
- **Brat:** `tools/brat` CLI (config / backup / setup), glossed in `architecture.yaml` as "the platform CLI/tooling under tools/brat".
- **Discovery:** `tool-gateway` consumes `INTERNAL_MCP_REGISTRATION_V1` and is the existing hub for the LLM tool loop.

> **Key insight:** Every primitive the Bit model needs — MCP transport, registry self-publish, RBAC, health, config with redaction, feature flags, runtime log-level, graceful `close(reason)` — already exists. The work is *relocation and codification*, not green-field construction.

---

## 3. The Bit Model

### 3.1 Naming & the base abstraction

Rename/refactor `BaseServer` → **`Bit`**. Keep `BaseServer` as a **deprecated alias** for exactly one migration window (`export const BaseServer = Bit;` plus a deprecation log on use). `McpServer` is folded *down into* `Bit` and ultimately becomes a thin compat shim.

A Bit always boots with three **concentric rings**. Inner rings are platform-owned and non-negotiable; outer rings are where each Bit expresses itself.

### 3.2 The three rings

```
┌──────────────────────────────────────────────────────────┐
│  Bit                                                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Platform Ring  (always-on — Brat's surface)       │    │
│  │   • MCP server endpoint (control plane)            │    │
│  │   • Mandatory admin/meta tools: bit.*              │    │
│  │   • Registry self-publish (INTERNAL_MCP_REGISTRATION)│  │
│  │   • Health (/healthz /readyz /livez), tracing,     │    │
│  │     RBAC (MCP_AUTH_TOKEN), counters/metrics        │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Capability Ring  (opt-in profiles / mixins)       │    │
│  │   • Eventing (onMessage / publish / routing slip)  │    │
│  │   • LLM core (provider-factory + prompt-assembly)  │    │
│  │   • Resources (firestore / storage / publisher)    │    │
│  │   • MCP client (consume other Bits' tools)         │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Business Ring  (roams free)                       │    │
│  │   • Whatever this Bit actually does.               │    │
│  │     No platform opinions imposed here.             │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

| Ring | Owner | Mutability | Mapped to today |
|---|---|---|---|
| **Platform Ring** | Platform | Identical everywhere, non-negotiable | `BaseServer` health/config/tracing + `McpServer` transport/registration/RBAC, **promoted to baseline** |
| **Capability Ring** | Platform-provided, Bit-selected | Opt-in via declared profiles | `onMessage` eventing, `common/llm`, `common/resources`, `common/mcp` client |
| **Business Ring** | The Bit | Free | The service's own handlers/domain logic |

**Design rule:** The Platform Ring is what lets Brat boss Bits around uniformly. Capability and Business rings are where a Bit does its own thing. This satisfies the founding ask: *easy to orchestrate/administer, while getting out of the way of the work.*

---

## 4. The Universal MCP Control Plane (the "bossing" mechanism)

### 4.1 The mandatory platform toolset (`bit.*`)

Every Bit exposes a small, **mandatory** platform MCP toolset the moment it boots, regardless of function. This is the contract a Hello-World Bit gets *for free*.

| Tool | Purpose | Backed by (existing) |
|---|---|---|
| `bit.info` | name, version, profile flags, declared topics/secrets | reads `architecture.yaml` service node + project version |
| `bit.health` / `bit.readiness` | structured status mirroring `/readyz` | `registerHealth` / `buildHealthBody` |
| `bit.config.get` / `bit.config.describe` | effective config with **secret redaction** | `getConfig` + `prompt-assembly/redaction.ts` patterns |
| `bit.flags.get` / `bit.flags.set` | live feature-flag inspect/toggle | `feature-flags.ts` + manifest |
| `bit.log.level` | runtime log-level change | `logging.ts` (already supports it) |
| `bit.drain` / `bit.shutdown` | graceful lifecycle | `close(reason)` + signal handlers |

These are registered by the Platform Ring during `Bit` construction — **before** any Business Ring code runs — so they are guaranteed present and identical across the fleet.

### 4.2 Tool surface layering

Domain tools (e.g. `obs.*`, `image.generate`) live **alongside** the platform tools on the same MCP surface. Brat sees both but cares mostly about `bit.*`. Two namespaces, one endpoint:

- `bit.*` — platform control plane (universal, mandatory).
- `<domain>.*` — business tools (per-Bit, optional).

RBAC scopes (`common/mcp/rbac.ts`) decide who may call platform vs. domain tools. `registerTool(name, description, schema, handler, { scopes })` already carries the scope hook.

### 4.3 Brat as a fleet MCP client

Brat already owns the operator surface (`tools/brat`: config / backup / setup, and conceptually orchestration / lb). Under the Bit model Brat becomes a **fleet MCP client**:

```
                 ┌─────────────────────────┐
   registry      │        tool-gateway      │   discovery + RBAC chokepoint
  self-publish   │   (MCP fabric hub)       │
  ───────────►   │                          │ ◄─────────────┐
                 └──────────┬───────────────┘               │
                            │ bit.* / domain.*               │ bit.*
              ┌─────────────┼──────────────┐                 │
              ▼             ▼              ▼                  │
        ┌──────────┐  ┌──────────┐   ┌──────────┐      ┌───────────┐
        │  Bit A   │  │  Bit B   │   │  Bit C   │ ...  │   Brat    │
        │ (llm)    │  │ (gateway)│   │ (core)   │      │  (fleet   │
        └──────────┘  └──────────┘   └──────────┘      │  client)  │
                                                        └───────────┘
                                                              ▲
                                                   llm-bot consumes too
```

1. Bits self-publish to the registry via `INTERNAL_MCP_REGISTRATION_V1` on boot.
2. `tool-gateway` aggregates the fleet (it already does this for the LLM tool loop).
3. Brat (and `llm-bot`) discover Bits via `registry-watcher.ts` / `tool-gateway` and drive them through `bit.*` tools.

"Boss the Bits around" = Brat calling platform MCP tools across the fleet, through one auth/RBAC chokepoint, with a direct-connect break-glass path (see ADR-003).

---

## 5. Capability Profiles (composition over inheritance)

### 5.1 The repeated pattern

`llm-bot`, `query-analyzer`, `stream-analyst`, `image-gen-mcp`, and `story-engine` all re-implement the same scaffolding around `getLlmProvider()` + `prompt-assembly`. This is real duplication that the Capability Ring should absorb.

### 5.2 Profiles as mixins

A Bit **composes profiles**; it does not deepen an inheritance tree. Profiles are mixins/decorators over `Bit`:

```ts
// Illustrative — final API contract to be locked in the implementation plan.
class LlmBot extends Bit {}
applyProfiles(LlmBot, [EventingProfile, LlmProfile, McpClientProfile]);

// Hello-World composes nothing extra and still gets the full Platform Ring.
class HelloBit extends Bit {}
```

Candidate profiles, each backed by existing commons:

| Profile | Bundles | Backed by |
|---|---|---|
| `EventingProfile` | `onMessage` / publish / routing-slip helpers | `base-server` eventing + `common/events` |
| `ResourcesProfile` | firestore / storage / publisher managers | `common/resources` |
| `McpClientProfile` | client-manager + registry-watcher wiring (the dance hand-rolled in `llm-bot`) | `common/mcp` |
| `LlmProfile` | provider resolution + prompt assembly/redaction + LLM admin tools | `common/llm/provider-factory`, `common/prompt-assembly` |

### 5.3 The `LlmBit` profile in detail

`LlmProfile` (the "LlmBit" capability) bundles:

- **Provider resolution** via `common/llm/provider-factory` (`LLM_PROVIDER` / `LLM_MODEL` / keys already standardized in `architecture.yaml`).
- **Prompt assembly + redaction** via `common/prompt-assembly`.
- **Standard MCP-client wiring** (the `McpClientManager` + `RegistryWatcher` choreography currently hand-rolled in `llm-bot`).
- **LLM-admin platform tools** so Brat can inspect/tune any LLM Bit identically:
  - `bit.llm.model` — read/set active provider+model.
  - `bit.llm.promptPreview` — render the assembled prompt (redacted).
  - `bit.llm.toolFilter` — inspect/adjust which discovered tools are exposed to the loop.
- **Memory / behavioral-guidance knobs** (today buried only in `llm-bot`'s `CONFIG_DEFAULTS`), surfaced as profile config.

> Note `bit.llm.*` tools are namespaced under `bit.*` deliberately: they are *platform-level* admin of an LLM capability, distinct from a Bit's domain tools.

### 5.4 Why composition, not inheritance

Inheritance forces a single linearization and produces diamond problems the moment a Bit wants, e.g., LLM + eventing + domain-MCP. Mixins/composition (idiomatic TS) let a Bit pick exactly the rings it needs with no class-tree depth. (See ADR-002.)

---

## 6. Reconciling with `architecture.yaml` (Law #2)

Per `AGENTS.md` precedence, `architecture.yaml` wins, so the Bit model must **extend** the canonical file, not fight it. The existing `services:` map already has the right shape.

### 6.1 Proposed canonical changes

1. **Re-intent, don't rename the key.** Treat the `services:` section as conceptually "Bits" but keep the YAML key `services:` for back-compat (avoids a breaking parse change against `documentation/schemas/architecture.v1.json` and `npm run brat -- config validate`). Document the alias in `llm_guidance.glossary` (a `bit:` entry alongside the existing `brat:` entry).
2. **Add an optional `profile:` field per Bit:** one of `[core | llm | mcp-domain | gateway]`. This replaces the implicit `extends BaseServer` / `extends McpServer` choice with *declarative intent* in the canonical file. Absent ⇒ `core`.
3. **Make MCP capability implicit for every Bit.** `MCP_AUTH_TOKEN` becomes a *default* secret (most Bits already list it) rather than per-service boilerplate, with an `mcp.exposure` knob: `[platform-only | platform+domain]` (Hello-World = `platform-only`).
4. **Surface the conflict explicitly (mandatory).** See §6.3 — this is a real behavioral change that must be justified in `architecture.yaml` *before* implementation, not silently introduced.

### 6.2 Illustrative YAML delta (per-Bit)

```yaml
services:                 # canonical key retained; conceptually "Bits"
  hello-bit:
    description: "Minimal logging Bit"
    profile: core         # [core | llm | mcp-domain | gateway]; default core
    mcp:
      exposure: platform-only   # [platform-only | platform+domain]
    # MCP_AUTH_TOKEN now a platform default secret, not per-service boilerplate

  llm-bot:
    profile: llm          # composes LlmProfile + EventingProfile + McpClientProfile
    mcp:
      exposure: platform+domain
```

A `profile:` maps to a set of Capability-Ring mixins (the canonical file declares *intent*; code composes the matching profiles). The mapping table (`profile` → mixins) lives in this document and is enforced by the `Bit` bootstrap.

### 6.3 The one behavioral conflict to ratify first

Today, 6 services (`llm-bot`, `query-analyzer`, `persistence`, `disposition`, `oauth`, `ingress-egress`) have **no MCP endpoint**. Promoting MCP to universal is a genuine behavioral change for those 6: they will start exposing an MCP control endpoint (even if `platform-only`).

> **Action (Law #2):** This change MUST be ratified in `architecture.yaml` (with justification) before any code promotes MCP to baseline. RBAC + `platform-only` exposure are the mitigations (see §7), but the posture shift is a decision, not an implementation detail. See ADR-001.

---

## 7. Security Posture

Universal MCP means a control endpoint everywhere — i.e. **attack surface everywhere**. The model mitigates this with defense-in-depth rather than by avoiding the capability:

1. **Default-deny exposure.** `mcp.exposure: platform-only` is the default. A Bit only exposes domain tools when it explicitly opts into `platform+domain`. Hello-World and the 6 promoted services stay `platform-only`.
2. **RBAC scopes per tool.** `common/mcp/rbac.ts` + `registerTool(..., { scopes })` gate platform vs. domain tools. `bit.shutdown` / `bit.drain` / `bit.flags.set` require elevated operator scopes; read-only `bit.info` / `bit.health` are low-scope.
3. **Token auth at the transport.** `MCP_AUTH_TOKEN` already guards `/sse` + `/message` (`authMiddleware`). Becoming a platform default secret means *consistent* enforcement, not weaker enforcement.
4. **Single chokepoint.** Brat administers via the `tool-gateway` fabric (one auth/RBAC/discovery point) rather than fanning out direct connections (ADR-003).
5. **Secret redaction.** `bit.config.get` / `bit.config.describe` must redact secrets (reuse `prompt-assembly/redaction.ts`); never return raw `MCP_AUTH_TOKEN` or provider keys.
6. **Sensitive Bits.** `persistence` and `oauth` exposing a control endpoint is the highest-sensitivity case; they remain `platform-only`, behind elevated scopes, and their promotion is the explicit subject of ADR-001.

---

## 8. Migration Shape (low-drama, reversible)

Core-platform only ("not the domain implementations"), exactly as scoped. Each phase is independently shippable and reversible.

### Phase 0 — Alias & fold (behavior-preserving)
- Introduce `Bit`; set `BaseServer = Bit` (deprecated alias, one window).
- Fold the MCP transport + platform-tool registration from `McpServer` *down into* `Bit`, **gated behind `mcp.exposure`** so behavior is unchanged for existing `BaseServer` services until flipped.
- **Exit criteria:** full test suite green; no service changes observable; `extends McpServer` still works unchanged.

### Phase 1 — Platform tools
- Ship the mandatory `bit.*` toolset + registry self-publish for **every** Bit.
- Brat gains fleet `bit.*` orchestration commands (fleet `bit.info` / `bit.health` / `bit.flags` / `bit.drain`).
- **Exit criteria:** Brat can enumerate the fleet and call `bit.*` on every Bit; the 6 promoted services pass health/RBAC checks (gated by ADR-001 ratification).

### Phase 2 — LLM profile
- Extract `llm-bot`'s MCP-client/provider/prompt scaffolding into the reusable `LlmProfile` (a.k.a. `LlmBit`).
- Refit `query-analyzer` and `stream-analyst` onto the profile.
- **Exit criteria:** the three Bits behave identically pre/post; duplication removed; `bit.llm.*` tools available.

### Phase 3 — Deprecate
- `McpServer` becomes a thin compat shim; remove the `BaseServer` vs `McpServer` decision from the developer's vocabulary.
- Retire the `BaseServer` alias at the end of the migration window.
- **Exit criteria:** no production code references `extends McpServer`; CHANGELOG + bootstrap templates updated.

---

## 9. Architecture Decision Records (the four open questions)

These ADRs capture proposed decisions for the open questions; each requires explicit owner sign-off before implementation.

### ADR-001 — MCP everywhere = attack surface everywhere
- **Question:** Are we comfortable that even `persistence` / `oauth` expose an MCP control endpoint?
- **Decision (proposed):** Yes, **conditioned** on default `platform-only` exposure + elevated RBAC scopes for sensitive tools, ratified in `architecture.yaml` per §6.3.
- **Status:** Proposed — requires explicit owner decision (it is a posture change, not an implementation detail).

### ADR-002 — Profiles as composition vs. inheritance
- **Question:** Mixins/composition or a deepening class tree?
- **Decision (proposed):** **Composition / mixins** (TS), so a Bit can be LLM + eventing + domain-MCP without diamond problems. Strongly favored.
- **Status:** Proposed — recommended ACCEPT.

### ADR-003 — Brat administers via fabric or direct-connect?
- **Question:** Does Brat go through `tool-gateway` or connect to each Bit's MCP endpoint directly?
- **Decision (proposed):** **Fabric-through-gateway** as the default (one auth/RBAC chokepoint + discovery), with **direct-connect as a documented break-glass escape hatch**.
- **Status:** Proposed — recommended ACCEPT.

### ADR-004 — Naming: keep `services:` but introduce "Bit"?
- **Question:** Keep `services:` in YAML (back-compat) but introduce "Bit" everywhere in code/docs/`bit.*` tools? Or rename hard?
- **Decision (proposed):** **Soft introduce.** Keep `services:` as the canonical YAML key (back-compat, no breaking parse change); introduce "Bit" in code/docs/`bit.*` tooling and a glossary alias. No hard rename.
- **Status:** Proposed — recommended ACCEPT.

---

## 10. Testing & Definition-of-Done Mapping

Aligns with the project-wide DoD in `AGENTS.md` §3. This is a planning/design artifact; the implementation sprint must satisfy:

- **Platform Ring contract tests:** every Bit (including a `hello-bit` fixture) exposes the full `bit.*` toolset, registers in the registry, and serves health — asserted by a shared conformance test suite run against all Bits.
- **Behavior-preservation tests (Phase 0):** existing `McpServer` and `BaseServer` service tests must pass unchanged.
- **Profile tests:** `LlmProfile` covered by unit tests over provider resolution, prompt assembly/redaction, and MCP-client wiring; `query-analyzer` / `stream-analyst` refit verified against their existing tests.
- **RBAC tests:** platform vs. domain scope enforcement, redaction of secrets in `bit.config.*`.
- **Negative/edge cases:** missing `MCP_AUTH_TOKEN`, `platform-only` Bit refusing domain calls, `bit.shutdown` requiring elevated scope.
- **Stack:** Jest (TypeScript), external services mocked, `npm test` green, integrated into `validate_deliverable.sh`.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| MCP endpoint added to sensitive Bits (`persistence`, `oauth`) widens attack surface | Med | `platform-only` default + elevated RBAC + ADR-001 ratification before code |
| Behavioral drift during fold-down | Med | Phase 0 is behavior-preserving + gated by `mcp.exposure`; full suite must stay green |
| `architecture.yaml` schema breakage | Low | Keep `services:` key; additive optional fields (`profile`, `mcp.exposure`); validate with `brat config validate` |
| Mixin complexity / typing | Low | Constrain to a small fixed set of profiles with a documented `profile` → mixin map |
| Migration window overruns (alias lingers) | Low | Phase 3 exit criteria explicitly retires `BaseServer` alias + `McpServer` shim |

---

## 12. Traceability & Next Step

- **Source vision:** the Architect overview of the "Bit thesis" (this doc is its in-depth technical expansion).
- **Canonical alignment:** all proposed changes are additive extensions to `architecture.yaml`; the single behavioral conflict (§6.3) is flagged for ratification per Law #2.
- **Process note (Rule S1):** No sprint has been started, no branch created, and no implementation code changed by this document. This artifact is the **input** to a future `implementation-plan.md` (built around the Phase 0–3 shape in §8) once an owner says **"Start sprint."** and the ADRs in §9 are signed off.

---

## Appendix A — Profile → Capability mapping (proposed)

| `profile:` value | Composed mixins | Representative Bits |
|---|---|---|
| `core` | (Platform Ring only) | `persistence`, `disposition`, `hello-bit` |
| `llm` | `EventingProfile` + `LlmProfile` + `McpClientProfile` | `llm-bot`, `query-analyzer`, `stream-analyst` |
| `mcp-domain` | `EventingProfile` + `ResourcesProfile` (+ domain tools) | `obs-mcp`, `image-gen-mcp`, `story-engine-mcp`, `state-engine` |
| `gateway` | `McpClientProfile` + fabric/aggregation | `api-gateway`, `tool-gateway`, `event-router`, `ingress-egress` |

> The mapping is the contract between the canonical `profile:` declaration and the code-side composition; it is enforced at `Bit` bootstrap so declared intent and runtime capability can never diverge.
