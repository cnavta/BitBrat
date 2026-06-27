# Capability Profiles

> **Status:** Implemented (sprint-324). For the base model, see [The Bit Model](./bit-model.md); for the
> design rationale and ADRs (notably ADR-002), see the
> [design doc](../architecture/bit-model-technical-architecture.md).

A [Bit](./bit-model.md)'s **Capability Ring** is built from **profiles** — small, reusable capability
bundles. A Bit **composes** profiles rather than deepening an inheritance tree, so it can pick exactly the
rings it needs (e.g. LLM + eventing + MCP-client) without diamond problems. This is
composition-over-inheritance (ADR-002), idiomatic for TypeScript.

## Composition with `applyProfiles`

Profiles are applied to a Bit subclass as a class-level decoration (no new inheritance depth). At
construction, the Bit collects the applied profiles (including those declared on ancestor classes),
enforces the [`profile:` contract](#profile--mixin-mapping), and installs each profile onto the instance.

```ts
// Illustrative.
class LlmBot extends Bit {}
applyProfiles(LlmBot, [EventingProfile, LlmProfile, McpClientProfile]);

// A Hello-World Bit composes nothing extra and still gets the full Platform Ring.
class HelloBit extends Bit {}
```

`applyProfiles` is idempotent per `(class, profile.name)` — re-applying the same-named profile to the same
class is ignored.

## The shipped profiles

Each profile is backed by existing platform commons (`src/common/profiles/`):

| Profile | `name` | Bundles | Backed by |
|---|---|---|---|
| `EventingProfile` | `eventing` | `onMessage` / publish / routing-slip helpers (`next` / `complete`) | base eventing + `common/events` |
| `ResourcesProfile` | `resources` | firestore / storage / publisher managers | `common/resources` |
| `McpClientProfile` | `mcp-client` | MCP client-manager + registry-watcher wiring (consume other Bits' tools) | `common/mcp` |
| `LlmProfile` | `llm` | provider resolution + prompt assembly/redaction + the `bit.llm.*` admin tools | `common/llm/provider-factory`, `common/prompt-assembly` |

The `LlmProfile` also registers the [`bit.llm.*` control-plane tools](../reference/bit-control-plane.md#llm-admin-tools-bitllm)
(`bit.llm.model`, `bit.llm.promptPreview`, `bit.llm.toolFilter`) — but only when the Bit actually serves an
MCP control plane, so a plain/MCP-off Bit is unaffected.

## `profile:` → mixin mapping

The optional `profile:` field in [`architecture.yaml`](../../architecture.yaml) declares a Bit's *intent*;
the code composes the matching profiles. The mapping is the contract between the declared `profile:` value
and the code-side composition, and it is **enforced at Bit bootstrap** (fail-fast) so declared intent and
runtime capability can never diverge.

| `profile:` value | Composed capabilities | Representative Bits |
|---|---|---|
| `core` (default) | Platform Ring only (no extra mixins required) | `persistence`, `disposition`, a Hello-World Bit |
| `llm` | `EventingProfile` + `LlmProfile` + `McpClientProfile` (the `llm` mixin is **required**) | `llm-bot`, `query-analyzer`, `stream-analyst` |
| `mcp-domain` | `EventingProfile` + `ResourcesProfile` (+ domain tools) | `obs-mcp`, `image-gen-mcp`, `story-engine-mcp`, `state-engine` |
| `gateway` | `McpClientProfile` + fabric/aggregation | `api-gateway`, `tool-gateway`, `event-router`, `ingress-egress` |

> **Enforcement detail.** Only `profile: llm` currently *requires* a specific mixin (`llm`). The other
> profiles layer eventing/resources/mcp-client on for convenience, so those can be added freely without
> tripping the contract. Declaring an unknown `profile:` value, or declaring `profile: llm` without the
> `LlmProfile` applied, fails fast at Bit bootstrap.

## Related reading

- [The Bit Model](./bit-model.md)
- [Bit Control-Plane Reference](../reference/bit-control-plane.md)
- [The Bit Model & Universal MCP Control Plane (design doc)](../architecture/bit-model-technical-architecture.md)
