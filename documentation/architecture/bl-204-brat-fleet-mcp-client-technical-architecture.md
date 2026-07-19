# Technical Architecture: BL-204 — Brat as a Fleet MCP Client

> **Status:** Implemented (sprint-325, BL-204). This design shipped as the `brat fleet` command group; see the [`brat fleet` guide](../guides/brat-fleet.md) and the [`brat` CLI reference](../tools/brat.md#brat-fleet).
> **Author role:** Architect
> **Backlog item:** `BL-204` (Phase 1, Gate G1, ADR-003) — *"Brat as fleet MCP client: `bit.*` orchestration via tool-gateway fabric + direct-connect break-glass."*
> **Precedence:** Per `AGENTS.md` Law #2, `architecture.yaml` is the canonical source of truth. This document proposes **no** new behavioral change to `architecture.yaml`; it consumes the already-ratified `bit.*` control plane and `mcp.exposure`/`profile` model.
> **Scope:** The Brat operator surface only (`tools/brat/**`) plus a small, additive read-path enhancement to `tool-gateway` for per-Bit fleet addressing. **Not** the domain logic of any Bit, and **not** the `bit.*` toolset itself (already shipped in sprint-324).
> **Companion docs:** `documentation/architecture/bit-model-technical-architecture.md` (the parent model); `planning/bit-model/execution-plan.md` and `planning/sprint-324-00782d/backlog.yaml` (BL-204 acceptance criteria).

---

## 1. Executive Summary

Sprint-324 delivered the **universal `bit.*` control plane**: every MCP-enabled Bit now exposes an identical, RBAC-scoped admin surface (`bit.info`, `bit.health`, `bit.readiness`, `bit.config.*`, `bit.flags.*`, `bit.log.level`, `bit.drain`, `bit.shutdown`) and self-publishes to the MCP registry on boot. What is still missing — and what **BL-204** delivers — is the **operator-side consumer** of that surface: a way for **Brat** to enumerate the fleet and *drive* `bit.*` across every Bit from one place.

This document specifies **`brat fleet`**: a new Brat command group that turns Brat into a **fleet MCP client**. Per **ADR-003** the default path is **fabric-through-`tool-gateway`** (one discovery + auth + RBAC chokepoint), with a **documented direct-connect break-glass** behind an explicit `--direct <bit>` flag for when the gateway itself is unhealthy.

The work is deliberately small: the MCP client primitives (`McpClientManager`, `RegistryWatcher`, `McpBridge`, `RbacEvaluator`) already exist and are reused as-is; the gateway already aggregates the fleet. The one genuinely new piece of platform code is a **per-Bit addressing** affordance, because the existing aggregation flattens every Bit's identically-named `bit.*` tools into one registry namespace (see §4.2).

---

## 2. Current State (Grounded in the Repo)

### 2.1 What already exists (reused, not rebuilt)

| Building block | File | What it gives BL-204 |
|---|---|---|
| `bit.*` control plane | `src/common/base-server.ts` → `registerPlatformTools()` | The tools to call. Scopes: `bit:read` (info/health/readiness/config.*/flags.get) and `bit:operate` (flags.set/log.level/drain/shutdown). |
| Registry self-publish | `Bit` → `publishRegistration()` → `INTERNAL_MCP_REGISTRATION_V1` | Every Bit announces itself (transport `sse`, external URL, bearer from `MCP_AUTH_TOKEN`). |
| MCP registry | Firestore `mcp_servers` collection | The discoverable list of live Bits, keyed by Bit name. |
| `RegistryWatcher` | `src/common/mcp/registry-watcher.ts` | Subscribes to `mcp_servers` snapshots → `onServerActive(config)` / `onServerInactive(name)`. |
| `McpClientManager` | `src/common/mcp/client-manager.ts` | SSE/stdio connect, discovery, reconnect-with-backoff, bridge wiring, `getInvoker()`. |
| `McpBridge` | `src/common/mcp/bridge.ts` | Translates a remote MCP tool into an invocable `BitBratTool` (`execute(args, context)`); forwards `{ userRoles, userId }` via `_meta`. |
| `RbacEvaluator` | `src/common/mcp/rbac.ts` | Role/agent-allowlist evaluation against `McpServerConfig` + `SessionContext`. |
| `tool-gateway` fabric | `src/apps/tool-gateway.ts` | Aggregates the fleet (registry-watcher + client-manager), exposes a session MCP server on `/sse` + `POST /message`, and a REST mirror (`GET /v1/tools`, `POST /v1/tools/:id`). Enforces RBAC at both discovery and invocation. |
| Brat CLI dispatch | `tools/brat/src/cli/index.ts` | Flat command router (`if (c1 === 'docker') …`), `parseArgs`, `parseKeyValueFlags`, structured logger. |

### 2.2 What is missing

- Brat has **no MCP client**. Its only live-platform command, `brat chat` (`tools/brat/src/cli/chat.ts`), speaks **WebSocket** to `api-gateway` for the *user* chat plane — it is not an admin/control-plane client.
- There is therefore **no operator command** to list Bits, read `bit.health` fleet-wide, flip a flag on one Bit, or drain/shutdown a Bit.
- The `tool-gateway` aggregation **flattens identity**: `McpBridge.translateTool` assigns every discovered tool the id `mcp:<toolName>` and stores it in a single `ToolRegistry`. Because *every* Bit exposes `bit.info`, the last writer wins — there is currently **no way to address `bit.info` on a *specific* Bit through the fabric** (see §4.2). This is the core gap BL-204 must close.

> **Key insight:** BL-204 is a *client + addressing* problem, not a *control-plane* problem. The tools, transport, discovery, and RBAC primitives are all present; what is new is (a) a Brat-side fleet client that composes them and (b) a per-Bit addressing scheme so a fleet command can target one Bit (or fan out to all).

---

## 3. Goals & Non-Goals

### 3.1 Goals
1. A `brat fleet` command group that **lists** Bits and **invokes `bit.*`** on one Bit or across the whole fleet.
2. **Default = fabric-through-gateway** (ADR-003): discovery and invocation flow through `tool-gateway`, the single auth/RBAC/discovery chokepoint.
3. **Direct-connect break-glass** behind an explicit `--direct <bit>` flag, for when the gateway is down or a Bit must be reached out-of-band.
4. **Fail-closed RBAC:** fleet commands carry an authorized token/roles or they refuse to run; `bit:operate` actions (`drain`/`shutdown`/`flags.set`) demand elevated scope.
5. **Deployment-target parity:** identical behavior on cloud platforms (Cloud Run/Pub/Sub), local development (Docker Compose/NATS), and remote Docker deployments (`ssh://`).

### 3.2 Non-Goals
- No change to the `bit.*` toolset or its scopes (shipped in sprint-324; BL-200/201).
- No new behavioral change to `architecture.yaml` (this is a consumer; Law #2 has nothing to ratify here).
- No GUI/TUI; this is a CLI feature. (A future dashboard could reuse the same fleet client.)
- Not a replacement for `brat chat` (user plane) or for the `llm-bot` tool loop (which already consumes the fabric for *domain* tools).

---

## 4. Design

### 4.1 Command surface (`brat fleet`)

A new top-level command group dispatched from `tools/brat/src/cli/index.ts` (mirroring the existing `docker`/`backup` blocks). Each subcommand maps to a `bit.*` tool:

```
brat fleet list                         # enumerate live Bits (name, profile, exposure, health)
brat fleet info    [<bit> | --all]      # bit.info
brat fleet health  [<bit> | --all]      # bit.health  / bit.readiness
brat fleet config  <bit> [--describe]   # bit.config.get / bit.config.describe (redacted)
brat fleet flags   <bit> [get|set] [--key K] [--value V]   # bit.flags.*
brat fleet log     <bit> --level <error|warn|info|debug>   # bit.log.level
brat fleet drain   <bit>                # bit.drain     (elevated)
brat fleet shutdown <bit>               # bit.shutdown  (elevated)

# Global modifiers
  --all                 fan out across every discovered Bit (read-only ops; see §7)
  --direct <bit>        BREAK-GLASS: bypass the gateway, connect to the Bit's MCP URL directly
  --json                machine-readable output (consistent with existing brat commands)
  --env <name>          select environment (reuses the existing global flag + BITBRAT_ENV)
```

Defaults: no `--direct` ⇒ fabric path. `--all` is permitted for **read-only** (`bit:read`) operations by default; mutating fan-out requires an explicit confirmation flag (§7).

### 4.2 The addressing problem and its resolution (per-Bit targeting)

The fabric flattens identity (`mcp:bit.info` for *all* Bits). BL-204 needs to call `bit.info` on, say, `auth` specifically. Three options were considered:

| Option | Mechanism | Verdict |
|---|---|---|
| **A. Gateway-side prefixed aggregation** | Aggregate per-Bit tools under a Bit-qualified id (e.g. `mcp:<bit>/bit.info`), driven by the registration `name` / `toolPrefix` already present in `McpServerConfig`. | **Chosen.** Smallest change, keeps one chokepoint, leverages the existing `toolPrefix` field (`McpServerConfig.toolPrefix`) and `originServer` already tracked per tool. |
| B. Gateway fleet façade | Add a dedicated gateway tool, e.g. `fleet.call({ bit, tool, args })`, that proxies to a named upstream. | More moving parts; duplicates routing the registry already knows. Rejected for now (could layer on later). |
| C. Direct-connect only | Brat connects to each Bit's MCP URL from the registry; no gateway involvement. | Violates ADR-003 default (no single chokepoint); kept **only** as the break-glass path (§5). |

**Chosen approach (A):** extend the gateway's aggregation so that platform (`bit.*`) tools are addressable per origin Bit. Concretely, the `tool-gateway` already records `originServer` on every registered tool and already holds each upstream's `McpServerConfig`. The additive change is to **expose a Bit-qualified discovery id** for platform tools (e.g. id `mcp:<bit>/bit.health`, `displayName` unchanged) so a client can both *enumerate which Bit owns which `bit.*` tool* and *invoke it unambiguously*. Domain tools are unaffected (they already carry distinct names). This is a **read-path/aggregation** change inside `tool-gateway` — no `bit.*` tool definition changes, no `architecture.yaml` change.

> Implementation note (for the sprint, not binding here): the qualifier should derive from the registry document key (Bit `name`), which is exactly what `RegistryWatcher` keys on and what `publishRegistration()` emits — so it is already unique and already deployment-target-agnostic.

### 4.3 The fleet client module (Brat side)

A new `tools/brat/src/fleet/` module with a single `FleetClient` abstraction and two transports behind one interface:

```
tools/brat/src/fleet/
  fleet-client.ts        # FleetClient: discover() / list() / call(bit, tool, args) / callAll(tool, args)
  transports/
    gateway-transport.ts # DEFAULT: MCP SSE client → tool-gateway /sse (+ REST /v1 fallback)
    direct-transport.ts  # BREAK-GLASS: MCP SSE client → a single Bit's MCP URL
  rbac-context.ts        # builds SessionContext (roles/agentName) + bearer token resolution
  __tests__/
```

- **Discovery.** `FleetClient.discover()` reads the live fleet. Default: ask the gateway (its `ListTools` + the qualified ids from §4.2, or `GET /v1/tools`). It MAY also read the Firestore `mcp_servers` registry directly (same source `RegistryWatcher` uses) to render `name/profile/exposure` even for Bits with zero domain tools — this is how `brat fleet list` shows a `platform-only` Bit.
- **Invocation.** `call(bit, 'bit.health', args)` issues an MCP `CallTool` for the **Bit-qualified** id over the chosen transport, forwarding identity via `_meta: { userRoles, userId }` (the same channel `McpBridge`/`getRequestContext` already honor).
- **Reuse.** Where practical the client reuses the platform SDK wrappers (`@modelcontextprotocol/sdk` `Client` + `SSEClientTransport`, exactly as `McpClientManager` does) rather than re-implementing transport.

### 4.4 Topology

```
  ┌──────────┐   brat fleet (default)        ┌──────────────────────┐   bit.* (qualified)  ┌────────┐
  │  Brat    │ ───────────────────────────► │     tool-gateway      │ ───────────────────► │ Bit A  │
  │ (fleet   │   MCP SSE / x-mcp-token        │  (discovery + RBAC    │                      ├────────┤
  │  client) │ ◄─────────────────────────── │   chokepoint, fabric)  │ ◄─────────────────── │ Bit B  │
  └────┬─────┘   results                      └──────────────────────┘                      ├────────┤
       │                                                                                     │ Bit C  │
       │  brat fleet --direct <bit>   (BREAK-GLASS: gateway bypass, explicit flag)           └────────┘
       └───────────────────────────────────────────────────────────────────────────────────────►
```

---

## 5. Fabric vs. Direct-Connect (ADR-003)

| Aspect | **Fabric (default)** | **Direct-connect (`--direct`, break-glass)** |
|---|---|---|
| Path | Brat → `tool-gateway` → Bit | Brat → Bit's MCP `/sse` (URL from registry) |
| Discovery | Gateway aggregation (+ optional registry read) | Registry lookup of the one Bit's external URL |
| AuthN | `MCP_AUTH_TOKEN` to the gateway | `MCP_AUTH_TOKEN` to the Bit directly |
| AuthZ (RBAC) | Enforced at the gateway (discovery + invocation) **and** at the Bit | Enforced at the Bit only |
| When to use | Always, by default | Gateway unhealthy/unreachable, or isolating a misbehaving Bit |
| Guardrails | — | Requires explicit `--direct <bit>`; emits a **`fleet.break_glass`** audit log line (who/which Bit/why); single Bit only (no `--all`) |

Rationale: one chokepoint (fabric) gives consistent auth, RBAC, discovery, and observability. Direct-connect is the escape hatch when the chokepoint itself is the problem — so it must be *explicit, audited, and narrow*.

---

## 6. Security Posture

1. **Fail-closed.** No resolvable bearer token ⇒ the command refuses to run (non-zero exit), never a silent unauthenticated call. Token resolution order mirrors existing Brat/secret conventions: `MCP_AUTH_TOKEN` env → environment-target secret (cloud secret manager / `.secure.local` / `ssh://`-synced `.env.brat`). This matches OQ3's posture: an absent token preserves prior behavior but is logged as a **posture warning**.
2. **Scope-aware.** Read commands (`list`/`info`/`health`/`config`/`flags get`) need only `bit:read`. Mutating commands (`flags set`/`log`/`drain`/`shutdown`) require `bit:operate`; the client surfaces a clear `Forbidden`/insufficient-scope error rather than retrying.
3. **RBAC is server-authoritative.** Brat sends identity (`_meta.userRoles`/`userId`); the gateway (`RbacEvaluator` + `getRequestContext`) and the Bit make the allow/deny decision. Brat never self-authorizes.
4. **Secret redaction preserved.** `bit.config.*` already redacts secrets server-side (`safeConfig`); Brat displays whatever the Bit returns and performs **no** de-redaction.
5. **Break-glass is auditable.** `--direct` logs an explicit audit event and is constrained to a single named Bit.
6. **No new secrets in code.** Tokens are resolved at runtime from the environment/target; never embedded in Brat or in `architecture.yaml`.

---

## 7. Fan-out (`--all`) Semantics

- **Read-only by default.** `--all` is allowed for `bit:read` operations (`info`/`health`); it concurrently queries every discovered Bit and renders a per-Bit table (or `--json` array), tolerating partial failures (a down Bit shows `unreachable`, the command still returns the rest).
- **Mutations gated.** Fleet-wide `drain`/`shutdown`/`flags set` are high-blast-radius. They are **not** implied by `--all`; they require an additional explicit `--confirm` (consistent with `brat backup import`'s confirm-to-write convention) and are executed sequentially with per-Bit logging.
- **Concurrency.** Read fan-out reuses a bounded concurrency model (the existing `Queue` in `tools/brat/src/orchestration/queue.ts`) so a large fleet does not open unbounded connections.

---

## 8. Deployment-Target Parity (owner approval condition)

The fleet client must behave identically across all three current targets. The design avoids any target-specific assumption:

| Concern | Cloud Platform (Cloud Run / Pub/Sub) | Local Development (Compose / NATS) | Remote Docker (`ssh://`) |
|---|---|---|---|
| Discovery source | Database `mcp_servers` + gateway | same (local/emulator database) | same |
| Bit external URL | Cloud Run URL (from registration) | `http://<service>:<port>` (compose network) | resolved via the remote host (from registration) |
| Token source | Cloud secret manager | `.secure.local` / `.env.local` | `ssh://`-synced `.env.brat` |
| Messaging backend | Pub/Sub | NATS | NATS |

Because discovery uses the **registry self-published URL** (not a hard-coded host) and the bus backend is irrelevant to the synchronous MCP call path, no PubSub-only or Compose-only assumption is baked in. Parity is asserted in tests (§9) by driving the fleet client against a mocked gateway/registry under both bus drivers, consistent with the BL-500 harness.

---

## 9. Testing & Definition-of-Done Mapping

Aligns with `AGENTS.md` §3 and the BL-204 acceptance criteria.

- **Discovery tests:** `FleetClient.discover()` lists Bits (incl. a `platform-only` Bit with no domain tools) from a mocked registry + gateway.
- **Invocation tests:** `call(bit, 'bit.health')` and per-Bit addressing (§4.2) hit the correct upstream; `--all` fan-out aggregates and tolerates a single unreachable Bit.
- **RBAC / fail-closed tests:** missing token ⇒ refuse + posture warning; `bit:read` token cannot `bit.shutdown` (expects `Forbidden`); `bit:operate` succeeds.
- **Break-glass tests:** `--direct <bit>` bypasses the gateway, emits the audit log line, and is rejected when combined with `--all`.
- **Gateway addressing tests:** the additive Bit-qualified aggregation in `tool-gateway` exposes/invokes `mcp:<bit>/bit.*` without regressing existing domain-tool aggregation or RBAC (extends `tests/` gateway coverage).
- **Parity test:** fleet path exercised under both `MESSAGE_BUS_DRIVER=pubsub` and `=nats` (mockable), per BL-500.
- **Stack:** Jest (TypeScript), external services mocked, `npm test` green, wired into `validate_deliverable.sh`.

**Definition of Done (BL-204):** Brat discovers Bits and offers fleet `bit.info`/`bit.health`/`bit.flags`/`bit.drain`; default path is fabric-through-gateway; a documented `--direct` break-glass exists; commands honor RBAC and fail closed without an authorized token; parity holds across cloud platforms/local development/remote Docker; tests green.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gateway flattening makes per-Bit `bit.*` unaddressable | High (known gap) | §4.2 additive Bit-qualified aggregation using existing `originServer`/`toolPrefix`/registry name |
| Fleet-wide mutation footgun (`--all drain`) | Med | `--all` read-only by default; mutations require explicit `--confirm`, run sequentially with logging |
| Break-glass becomes the lazy default | Med | `--direct` is explicit, single-Bit, audited; docs frame it as emergency-only |
| Token sprawl / accidental unauth calls | Med | Fail-closed resolution; posture warning on absent token; never embed tokens |
| Target-specific URL/host assumptions | Low | Discovery uses registry-published external URL; bus backend off the call path (§8) |
| New Brat MCP-client divergence from `McpClientManager` | Low | Reuse the same `@modelcontextprotocol/sdk` `Client`/`SSEClientTransport` wrappers |

---

## 11. Traceability & Next Step

- **Backlog:** `BL-204` (Phase 1 / Gate G1), currently `status: todo`, `deferred: true` in `planning/sprint-324-00782d/backlog.yaml` — explicitly carried forward from sprint-324, which shipped the `bit.*` fabric it consumes.
- **ADR:** Implements **ADR-003** (fabric default + documented direct-connect break-glass), already **ACCEPTED**.
- **Open-question alignment:** Honors **OQ3** (token-required-to-engage; absent ⇒ posture warning) and **OQ4** (direct-connect break-glass behind an explicit CLI flag).
- **Process note (Rule S1):** This is a pre-sprint design artifact. No sprint is started and no implementation code is changed by this document. It is the **input** to the next sprint's `implementation-plan.md`, where the `brat fleet` command surface (§4.1), the fleet client module (§4.3), and the additive gateway addressing change (§4.2) become trackable tasks.

---

## Appendix A — `bit.*` → `brat fleet` command mapping

| `bit.*` tool | Scope | `brat fleet` command | Notes |
|---|---|---|---|
| `bit.info` | `bit:read` | `brat fleet info [<bit>\|--all]` | identity/profile/exposure/topics/secret names |
| `bit.health` / `bit.readiness` | `bit:read` | `brat fleet health [<bit>\|--all]` | mirrors `/healthz` / `/readyz` |
| `bit.config.get` / `bit.config.describe` | `bit:read` | `brat fleet config <bit> [--describe]` | secrets redacted server-side |
| `bit.flags.get` | `bit:read` | `brat fleet flags <bit> get [--key K]` | inspect/list flags |
| `bit.flags.set` | `bit:operate` | `brat fleet flags <bit> set --key K --value V` | elevated |
| `bit.log.level` | `bit:operate` | `brat fleet log <bit> --level <lvl>` | elevated |
| `bit.drain` | `bit:operate` | `brat fleet drain <bit>` | elevated; `--all` needs `--confirm` |
| `bit.shutdown` | `bit:operate` | `brat fleet shutdown <bit>` | elevated; `--all` needs `--confirm` |
