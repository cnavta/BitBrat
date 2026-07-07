# Guide: Choosing Platform vs Domain for Your Bit

When creating a new Bit in the BitBrat platform, one of the key decisions is whether it should be categorized as a **Platform Bit** or a **Domain Bit**. This guide helps you make that determination.

## TL;DR

**Platform Bits** = Core agent orchestration (perceive → plan → act → observe)
**Domain Bits** = Optional capabilities and extensions

If removing your Bit would break the agent loop → **Platform**
If removing your Bit would just remove a feature → **Domain**

---

## The Distinction

### Platform Bits

Platform Bits form the **essential agent orchestration loop** and provide infrastructure that other Bits depend on. They implement the core stages of agent operation:

- **Perceive**: Normalize external events into internal format
- **Plan**: Match rules, attach routing slips, orchestrate flow
- **Act**: Execute reasoning (deterministic or LLM-based) and call tools
- **Observe**: Persist state, capture behavior, remember

**Key Characteristic**: Platform Bits cannot be removed without breaking core orchestration.

### Domain Bits

Domain Bits **extend the platform** with optional, domain-specific capabilities. They add tools, integrate with external services, or provide specialized functionality for particular use cases.

**Key Characteristic**: Domain Bits can be removed without breaking the agent loop. The platform still functions; you just lose that specific capability.

---

## Current Categorization

### Platform Bits (10)

| Bit | Stage | Why Platform? |
|-----|-------|---------------|
| **ingress-egress** | Perceive & Observe | Normalizes ALL external events; delivers ALL responses |
| **api-gateway** | Perceive & Observe | HTTP/WebSocket ingress/egress alternative |
| **event-router** | Plan | Attaches routing slips; orchestrates entire flow |
| **auth** | Plan | Enriches events with identity/roles for RBAC |
| **llm-bot** | Act | LLM-based reasoning path (core capability) |
| **query-analyzer** | Act | Fast pre-analysis for routing decisions |
| **reflex** | Act | Deterministic execution path (core capability) |
| **tool-gateway** | Act | MCP fabric proxy; all tool calls go through here |
| **state-engine** | Observe | Persistent state mutations (core memory) |
| **persistence** | Observe | Event audit trail (core memory) |
| **disposition-service** | Observe | Short-term behavior analysis |

### Domain Bits (6+)

| Bit | Purpose | Why Domain? |
|-----|---------|-------------|
| **obs-mcp** | OBS Studio control | Streaming-specific; removable |
| **image-gen-mcp** | DALL-E generation | Creative domain; removable |
| **story-engine-mcp** | Collaborative storytelling | Narrative domain; removable |
| **stream-analyst** | Analytics/summarization | Analytics domain; removable |
| **scheduler** | Periodic tasks | Automation domain; removable |
| **oauth-flow** | OAuth2 flows | Authentication domain; removable |

---

## Decision Framework

Ask yourself these questions:

### 1. What happens if I remove this Bit?

- **Agent loop breaks** → Platform
- **Specific feature missing, but agent still works** → Domain

### 2. What does this Bit do?

- **Provides infrastructure other Bits use** → Platform
- **Adds a specific capability** → Domain

### 3. How general is this Bit?

- **Works across all use cases (streaming, chat-ops, webhooks, etc.)** → Platform
- **Specific to a use case or vertical** → Domain

### 4. Where does it fit in the agent loop?

- **Essential stage (perceive, plan, act, observe)** → Platform
- **Optional enhancement or extension** → Domain

---

## Examples

### Example 1: Creating an Email Integration

You want to add email as an ingress/egress platform alongside Twitch/Discord.

**Question**: Does removing email break the agent loop?
**Answer**: No, the loop still works with other platforms.

**Decision**: **Domain Bit** (domain-specific ingress adapter)

```bash
npm run brat -- bit create email-adapter \
  --category domain \
  --profile gateway \
  --exposure platform-only
```

### Example 2: Creating a New LLM Provider

You want to add Claude as an LLM provider alongside OpenAI.

**Question**: Does removing Claude break the Act stage?
**Answer**: No, the Act stage still works with OpenAI.

**Decision**: **Domain Bit** (LLM provider is swappable)

However, if you're creating a **new Act mechanism** (like reflex was), that would be Platform.

### Example 3: Creating a Caching Layer

You want to add a caching service that speeds up repeated tool calls.

**Question**: Does removing the cache break the agent loop?
**Answer**: No, tools still work, just slower.

**Decision**: **Domain Bit** (performance optimization, not core requirement)

### Example 4: Creating a New Routing Strategy

You want to add graph-based routing as an alternative to the Event Router's rule-based approach.

**Question**: Does the agent loop need routing orchestration?
**Answer**: Yes, Plan stage is essential.

**Decision**: If it **replaces** Event Router → **Platform**
If it's an **optional enhancement** → **Domain**

---

## Gray Areas

Some Bits are harder to categorize. Here are the nuances:

### disposition-service

**Current**: Platform (observe stage)
**Rationale**: Provides short-term behavior analysis used by other Platform Bits
**Gray Area**: Could be argued as Domain (behavioral analysis is optional)

### api-gateway

**Current**: Platform (perceive/observe stage)
**Rationale**: Alternative ingress/egress mechanism
**Gray Area**: Could be argued as Domain (HTTP is just one platform)

### scheduler

**Current**: Domain (automation domain)
**Rationale**: Periodic tasks are optional
**Gray Area**: Many systems need scheduling; could be Platform

**Guideline**: When in doubt, start with **Domain**. You can always recategorize as the platform evolves.

---

## Profile vs Category

Don't confuse `category` with `profile`:

| Concept | What it means | Values |
|---------|---------------|--------|
| **category** | Architectural role | `platform` \| `domain` |
| **profile** | Capability mixin | `core` \| `gateway` \| `llm` \| `mcp-server` |

Examples:
- `reflex`: category=`platform`, profile=`mcp-server` (Platform Bit that serves MCP tools)
- `obs-mcp`: category=`domain`, profile=`mcp-server` (Domain Bit that serves MCP tools)
- `llm-bot`: category=`platform`, profile=`llm` (Platform Bit with LLM capabilities)

**Key Insight**: Both Platform and Domain Bits can have any profile. Category describes *architectural role*, profile describes *technical capabilities*.

---

## When to Recategorize

As the platform evolves, categorization may change:

- A Domain Bit becomes so essential it's used by all deployments → consider Platform
- A Platform Bit becomes optional with good alternatives → consider Domain
- Requirements change and the agent loop is redefined → reassess

Document your reasoning in the `architecture.yaml` comment for that service.

---

## Summary

**Platform Bits**:
- Form the minimal viable agent
- Cannot be removed without breaking orchestration
- Provide infrastructure or implement core agent stages
- 10 currently defined

**Domain Bits**:
- Extend the platform with optional capabilities
- Can be removed; agent loop still functions
- Domain-specific or use-case-specific
- 6+ currently defined (grows with use cases)

**When creating a new Bit**: Use `--category platform` if it's essential to the agent loop, `--category domain` if it's an optional extension.

**When in doubt**: Start with `domain`. It's easier to promote to `platform` than demote.

---

## See Also

- [The Bit Model](../concepts/bit-model.md) — Base abstraction and three rings
- [Capability Profiles](../concepts/capability-profiles.md) — Profile vs category distinction
- [Platform Flow Overview](../concepts/platform-flow.md) — Agent loop stages
- [architecture.yaml](../../architecture.yaml) — Canonical categorization
