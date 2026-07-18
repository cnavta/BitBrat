# The Bit Model

> **Status:** Implemented (sprint-324). This is the reader-facing concept page for the Bit model.
> For the full design rationale and ADRs, see
> [The Bit Model & Universal MCP Control Plane](../architecture/bit-model-technical-architecture.md).

## What is a Bit?

A **Bit** is the base unit of the BitBrat platform — the abstraction every service is built on. In
earlier versions a service had to choose between two base classes: it either `extends BaseServer` or
`extends McpServer`. That split was arbitrary, leaked into the platform's vocabulary, and meant
administration was inconsistent across the fleet.

The Bit model collapses that choice. There is now **one base abstraction — `Bit`** — and
**every Bit speaks MCP**. Even a "Hello World" logging Bit exposes a small, standard control surface
the moment it boots. MCP is no longer a *subclass decision*; it is a *baseline capability* of the base
abstraction itself. **Brat** (the platform CLI) administers the whole fleet uniformly through that
universal MCP surface.

> **Glossary alias (`bit:` ↔ `services:`).** The canonical [`architecture.yaml`](../../architecture.yaml)
> keeps the existing `services:` key for back-compat (no breaking parse change), but each entry under it
> is conceptually a **Bit**. The `llm_guidance.glossary.bit` entry documents this alias. So when docs say
> "Bit", the corresponding YAML lives under `services.<name>`. (See ADR-004 in the design doc.)

## The three rings

Every Bit boots with three **concentric rings**. Inner rings are platform-owned and non-negotiable;
outer rings are where each Bit expresses itself.

```
┌──────────────────────────────────────────────────────────┐
│  Bit                                                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Platform Ring  (always-on — Brat's surface)       │    │
│  │   • MCP control-plane endpoint                     │    │
│  │   • Mandatory admin/meta tools: bit.*              │    │
│  │   • Registry self-publish on start()               │    │
│  │   • Health (/healthz /readyz /livez), tracing, RBAC│    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Capability Ring  (opt-in profiles / mixins)       │    │
│  │   • Eventing (onMessage / next / complete)         │    │
│  │   • Resources (persistence / storage / publisher)  │    │
│  │   • MCP client (consume other Bits' tools)         │    │
│  │   • LLM core (provider-factory + prompt-assembly)  │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Business Ring  (roams free)                       │    │
│  │   • Whatever this Bit actually does.               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

| Ring | Owner | What it provides |
|---|---|---|
| **Platform Ring** | Platform (always-on) | The universal `bit.*` control plane, registry self-publish, health, tracing, and RBAC. Identical on every Bit — this is what lets Brat administer Bits uniformly. |
| **Capability Ring** | Platform-provided, Bit-selected | Opt-in **profiles** (mixins): eventing, resources, MCP-client, and LLM core. |
| **Business Ring** | The Bit | The service's own domain logic. No platform opinions imposed here. |

The Platform Ring is how Brat "bosses Bits around"; the Capability and Business rings are where a Bit
does its own work. See the [Bit control-plane reference](../reference/bit-control-plane.md) for the full
`bit.*` toolset and [Capability Profiles](./capability-profiles.md) for the composition model.

## Declaring a Bit in `architecture.yaml`

The Bit model adds two **additive, optional** fields under each `services.<name>` entry. They declare a
Bit's *intent*; the code composes the matching capabilities and wires (or omits) the MCP control plane
accordingly.

```yaml
services:                 # canonical key retained; each entry is conceptually a "Bit"
  hello-bit:
    description: "Minimal logging Bit"
    category: platform         # [platform | domain]; architectural role
    profile: core              # [core | llm | mcp-server | gateway]; default: core
    mcp:
      exposure: platform-only  # [platform-only | platform+domain]; default: platform-only

  llm-bot:
    category: platform
    profile: llm               # composes the LLM capability mixins
    mcp:
      exposure: platform-only

  reflex:
    category: platform         # deterministic act stage
    profile: mcp-server        # serves MCP tools
    mcp:
      exposure: platform+domain
```

### `category:` — architectural role

`category:` is either `platform` or `domain`. It declares the Bit's architectural role:
- **`platform`** — Core agent orchestration (perceive → plan → act → observe). Cannot be removed without breaking the agent loop.
- **`domain`** — Optional extension providing domain-specific capabilities. Can be removed; agent still functions.

See [Choosing Platform vs Domain](../guides/choosing-platform-vs-domain.md) for the decision framework.

### `profile:` — capability intent

`profile:` is one of `core`, `llm`, `mcp-server`, or `gateway`. It declares which Capability-Ring
mixins the Bit composes. Absent ⇒ `core` (Platform Ring only). The declared profile is enforced against
the code's composition at Bit bootstrap, so declared intent can never silently diverge from runtime
capability. See [Capability Profiles](./capability-profiles.md) for the `profile:` → mixin mapping.

### `mcp.exposure:` — control-plane reach

`mcp.exposure:` controls how much of a Bit's MCP surface is served:

- **`platform-only`** (the default) — serve only the universal `bit.*` control plane (the Platform
  Ring). A Hello-World Bit and sensitive Bits (e.g. `persistence`, `oauth`) stay here.
- **`platform+domain`** — also serve the Bit's own domain tools (e.g. `obs.*`, `image.generate`).

Only Bits that explicitly declare an `mcp.exposure` are promoted to serve MCP; unlisted entries (such as
test fixtures) keep legacy behavior. Exposing domain tools is therefore an explicit, per-Bit opt-in.

## Migration & compatibility

- **`Bit` is the base class.** New code should `extend Bit` and declare `mcp.exposure` (or pass
  `mcpExposure` to the constructor).
- **`McpServer`** is now a thin, deprecated compatibility shim over `Bit` (it simply selects
  `platform+domain` exposure).
- The previous **`BaseServer` alias has been retired** — substitute `Bit` wherever older material said
  `BaseServer`.

## Related reading

- [Bit Control-Plane Reference](../reference/bit-control-plane.md) — the mandatory `bit.*` toolset, RBAC
  scopes, redaction, and exposure model.
- [Capability Profiles](./capability-profiles.md) — the `EventingProfile` / `ResourcesProfile` /
  `McpClientProfile` / `LlmProfile` composition model.
- [The `brat fleet` guide](../guides/brat-fleet.md) — driving the `bit.*` plane fleet-wide.
- [The Bit Model & Universal MCP Control Plane](../architecture/bit-model-technical-architecture.md) —
  the full design doc and ADRs.
