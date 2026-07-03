# Bit Control-Plane Reference (`bit.*`)

> **Status:** Implemented (sprint-324). This is the reference for the mandatory universal control plane
> every Bit exposes. For the concept, see [The Bit Model](../concepts/bit-model.md); for the design
> rationale and ADRs, see the
> [design doc](../architecture/bit-model-technical-architecture.md).

Under the [Bit model](../concepts/bit-model.md), **every MCP-enabled Bit** exposes a small, **mandatory**
platform MCP toolset the moment it boots — the `bit.*` namespace (the Platform Ring). This is the contract
even a "Hello World" Bit gets for free, and it is what [`brat fleet`](../guides/brat-fleet.md) uses to
administer the fleet uniformly. The tools are registered by the Platform Ring during construction —
*before* any business logic runs — so they are guaranteed present and identical across the fleet.

## Two namespaces, one endpoint

A Bit's MCP surface can carry two kinds of tools on the same endpoint:

- **`bit.*`** — the platform control plane (universal, mandatory).
- **`<domain>.*`** — business tools (per-Bit, optional; e.g. `obs.*`, `image.generate`).

Whether a Bit serves its domain tools is governed by [`mcp.exposure`](#exposure-model).

## Mandatory `bit.*` toolset

Every Bit registers the following platform tools. Each is backed by an existing platform primitive and
carries an RBAC [scope](#rbac-scopes).

| Tool | Purpose | Scope |
|---|---|---|
| `bit.info` | Bit identity: name, version, declared `profile`, `exposure`, declared topics, and secret **names** (never values). | `bit:read` |
| `bit.health` | Structured health status (mirrors `/healthz`). | `bit:read` |
| `bit.readiness` | Structured readiness status (mirrors `/readyz`). | `bit:read` |
| `bit.config.get` | Effective configuration, **secrets redacted**. | `bit:read` |
| `bit.config.describe` | Effective configuration plus the required env keys for this Bit (secrets redacted). | `bit:read` |
| `bit.flags.get` | Inspect a feature flag, or list all known canonical keys. | `bit:read` |
| `bit.flags.set` | Set an in-memory feature-flag override (empty value clears it). | `bit:operate` |
| `bit.log.level` | Change the runtime log level (`error` \| `warn` \| `info` \| `debug`). | `bit:operate` |
| `bit.drain` | Gracefully drain and release resources (alias of shutdown) via `close(reason)`. | `bit:operate` |
| `bit.shutdown` | Gracefully shut the Bit down via `close(reason)`. | `bit:operate` |
| `bit.restart` | Gracefully restart: `close(reason)` then exit so the orchestrator (Cloud Run min-instances / local supervisor) respawns a fresh instance. Returns `{ restarting: true, reason }`. | `bit:operate` |

> These map 1:1 onto the [`brat fleet`](../guides/brat-fleet.md) subcommands (`info`, `health`, `config`,
> `flags`, `log`, `drain`, `shutdown`, `restart`).

## LLM admin tools (`bit.llm.*`)

Bits that compose the [LLM profile](../concepts/capability-profiles.md) (`profile: llm`) additionally
register LLM-admin platform tools, so Brat can inspect and tune any LLM Bit identically. They are
deliberately namespaced under `bit.*` because they are *platform-level* admin of an LLM capability —
distinct from a Bit's domain tools — and are only registered when the Bit actually serves an MCP control
plane.

| Tool | Purpose | Scope |
|---|---|---|
| `bit.llm.model` | Read or set the active LLM provider and model for this Bit. | `bit:operate` |
| `bit.llm.promptPreview` | Render the assembled prompt for given inputs, with secrets/PII redacted. | `bit:read` |
| `bit.llm.toolFilter` | Inspect or adjust which discovered MCP tools are exposed to the LLM loop. | `bit:operate` |

## RBAC scopes

Tools are gated by two scopes (`src/common/mcp/rbac.ts` + the `{ scopes }` option on `registerTool`):

- **`bit:read`** — low-privilege, read-only tools (`bit.info`, `bit.health`, `bit.readiness`,
  `bit.config.*`, `bit.flags.get`, `bit.llm.promptPreview`).
- **`bit:operate`** — elevated operator tools that change state or lifecycle (`bit.flags.set`,
  `bit.log.level`, `bit.drain`, `bit.shutdown`, `bit.restart`, `bit.llm.model`, `bit.llm.toolFilter`).

RBAC is **server-authoritative**: clients (including Brat) only forward identity (user id / roles) and
never self-authorize.

## Secret redaction

`bit.config.get` / `bit.config.describe` always return configuration with secrets **redacted** (via the
same `safeConfig()` used by the debug-config route). `bit.info` returns secret *names* only, never values.
Raw `MCP_AUTH_TOKEN` and provider API keys are never exposed through the control plane.

## Transport & auth

The control plane is served over MCP via SSE (`/sse` + `POST /message`). When `MCP_AUTH_TOKEN` is set, the
transport requires a matching token (`x-mcp-token` header, `?token=` query, or `Authorization: Bearer`).
On boot, every MCP-enabled Bit self-publishes its registration (`internal.mcp.registration.v1`) so the
`tool-gateway` can discover it — see [MCP Auto-Discovery](../technical-architecture/mcp-auto-discovery.md).

## Exposure model

`mcp.exposure` (declared per-Bit in [`architecture.yaml`](../../architecture.yaml)) controls how much of
the surface is served:

- **`platform-only`** (default) — serve only the universal `bit.*` control plane.
- **`platform+domain`** — also serve the Bit's domain tools.

Only Bits that explicitly declare an `mcp.exposure` are promoted to serve MCP; unlisted entries (e.g. test
fixtures) keep legacy behavior. This default-deny posture means a control endpoint is added everywhere with
attack surface minimized: sensitive Bits (e.g. `persistence`, `oauth`) stay `platform-only` behind elevated
scopes. See the [design doc §7 (Security Posture)](../architecture/bit-model-technical-architecture.md).

## Related reading

- [The Bit Model](../concepts/bit-model.md)
- [Capability Profiles](../concepts/capability-profiles.md)
- [The `brat fleet` Guide](../guides/brat-fleet.md)
- [`brat` CLI reference](../tools/brat.md)
