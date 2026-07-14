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
| `bit.info` | Bit identity: name, version, declared `category` (platform\|domain), `profile`, `exposure`, declared topics, and secret **names** (never values). | `bit:read` |
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

## Routing Helpers

In addition to the MCP control plane, every Bit inheriting from the `Bit` base class has access to **routing helper methods** for participating in the agent flow. These are part of the `EventingProfile` capability and are fundamental to the [enrich-and-next pattern](../concepts/agent-flow-patterns.md).

### `this.next(event, status?)`

**Purpose:** Advance the routing slip to the next step. **This is the default choice for most services.**

**Signature:**
```typescript
protected async next(event: InternalEventV2, status?: string): Promise<void>
```

**Behavior:**
1. Marks the current routing step as complete with the given status (default: `'OK'`)
2. Advances `routing.slip.currentIndex` to the next step
3. Publishes the event to the `nextTopic` of the next step
4. If no more steps remain, publishes to `internal.egress.v1` (egress)

**When to use:**
- ✅ Your service enriched the event (added annotations, candidates, etc.)
- ✅ Downstream services should continue processing
- ✅ You want the routing slip to progress naturally
- ✅ **Default choice when unsure**

**Example:**
```typescript
// File: src/apps/auth-service.ts
await this.onMessage<InternalEventV2>('internal.contextualization.v1', async (event, attrs, ctx) => {
  // 1. ENRICH: Add user identity
  event.annotations.push({
    kind: 'user',
    value: { id: 'user-123', displayName: 'User' },
    source: this.name,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  });

  // 2. NEXT: Advance routing slip
  await this.next(event);  // ← Progresses to next step (typically Analysis)
  await ctx.ack();
});
```

---

### `this.complete(event, status?)`

**Purpose:** Skip remaining routing steps and publish directly to egress. **Only use when intentionally short-circuiting.**

**Signature:**
```typescript
protected async complete(event: InternalEventV2, status?: string): Promise<void>
```

**Behavior:**
1. Marks the current routing step as complete with the given status (default: `'OK'`)
2. **Skips all remaining routing steps**
3. Publishes the event directly to `internal.egress.v1` (egress)

**When to use:**
- ✅ Your service executed the final action (e.g., Reflex executed a tool)
- ✅ No further processing is needed
- ✅ You want to short-circuit the routing slip
- ⚠️ **Use sparingly — most services should use `next()`**

**Example:**
```typescript
// File: src/apps/reflex-service.ts
await this.onMessage<InternalEventV2>('internal.reflex.v1', async (event, attrs, ctx) => {
  // 1. Pattern match and execute tool
  const result = await this.executeTool(event);
  event.candidates.push({
    kind: 'text',
    text: result,
    source: this.name,
    id: randomUUID()
  });

  // 2. COMPLETE: Skip remaining steps, go to egress
  await this.complete(event);  // ← Skips Analysis and Reaction stages
  await ctx.ack();
});
```

---

### Decision Tree: next() vs complete()

**RULE: Use `next()` by default. Use `complete()` ONLY when intentionally short-circuiting.**

```
Is this the final processing step for this event?
├─ No → Use next(event)
└─ Yes
    ├─ Should downstream services still process it? → Use next(event)
    └─ Skip all remaining routing steps? → Use complete(event)
```

**Examples by Stage:**

| Service | Stage | Method | Reason |
|---------|-------|--------|--------|
| `auth` | Contextualization | `next()` | Always advance to Analysis |
| `query-analyzer` | Contextualization | `next()` | Advance to Analysis |
| `llm-bot` | Analysis | `next()` | Allow Reaction stage to execute tools |
| `reflex` | Analysis | `complete()` | Action executed, skip to egress |
| `state-engine` | Reaction | `complete()` | Final mutations, ready for egress |
| `disposition` | Reaction | `complete()` | Final transformations, ready for egress |

See [Agent Flow Patterns](../concepts/agent-flow-patterns.md) for comprehensive documentation.

---

### Common Patterns

#### Pattern 1: Enrich-and-Next (Most Common)

```typescript
// ENRICH: Add annotation
event.annotations.push({ kind: 'data', value: data, source: this.name, id: randomUUID(), createdAt: new Date().toISOString() });

// NEXT: Advance routing slip
await this.next(event);

// ACKNOWLEDGE: Required for message bus
await ctx.ack();
```

**Use for:** Contextualization and Analysis stages, most Reaction stages

#### Pattern 2: Execute-and-Complete (Terminal Actions)

```typescript
// EXECUTE: Perform final action
await this.performAction(event);

// COMPLETE: Skip to egress
await this.complete(event);

// ACKNOWLEDGE
await ctx.ack();
```

**Use for:** Reflexes, final reaction services, short-circuit scenarios

#### Pattern 3: Conditional Routing

```typescript
// Conditional: Short-circuit on spam
if (event.annotations.some(a => a.kind === 'risk' && a.value?.level === 'high')) {
  this.getLogger().info('short-circuit.spam', { correlationId: event.correlationId });
  await this.complete(event);  // Skip remaining steps
} else {
  await this.next(event);  // Continue processing
}
await ctx.ack();
```

**Use for:** Risk filtering, spam detection, conditional orchestration

---

### Anti-Patterns

**❌ NEVER: Enrich without calling next() or complete()**
```typescript
// BAD: Annotations added, but event never progresses
event.annotations.push({ kind: 'data', value: data, source: this.name });
await ctx.ack();  // ← Event stalls here!
```

**❌ NEVER: Use complete() when next() is appropriate**
```typescript
// BAD: Auth service skips Analysis stage
await this.onMessage('internal.contextualization.v1', async (event, attrs, ctx) => {
  event.annotations.push({ kind: 'user', value: user, source: this.name });
  await this.complete(event);  // ← Skips Analysis! Should use next()
  await ctx.ack();
});
```

**❌ NEVER: Forget to call ctx.ack()**
```typescript
// BAD: Message never acknowledged, will be redelivered
await this.next(event);
// Missing: await ctx.ack();
```

---

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
