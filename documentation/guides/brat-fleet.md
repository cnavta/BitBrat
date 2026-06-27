# Guide: Driving the Fleet with `brat fleet`

> **Status:** Implemented (sprint-325, BL-204). This guide explains how to operate the fleet over the
> universal [`bit.*` control plane](../reference/bit-control-plane.md). For the command-by-command
> summary, see the [`brat` CLI reference](../tools/brat.md#brat-fleet).

Under the [Bit model](../concepts/bit-model.md), **every Bit speaks MCP** and exposes a mandatory
`bit.*` control plane. **`brat fleet`** turns Brat into a *fleet MCP client* over that plane, so an
operator can inspect and administer every Bit through one consistent surface.

## Default path: the `tool-gateway` fabric

By default, `brat fleet` drives Bits **through the `tool-gateway` fabric** — a single
auth/RBAC/discovery chokepoint (ADR-003). Discovery comes from the registry (`mcp_servers`) that each Bit
self-publishes to on boot; the gateway aggregates the fleet and forwards calls to the right Bit.

```bash
# Enumerate live Bits (name, profile, exposure)
npm run brat -- fleet list

# Read-only checks
npm run brat -- fleet info llm-bot
npm run brat -- fleet health --all
npm run brat -- fleet config persistence --describe
```

## Break-glass: `--direct`

`--direct <bit>` is an explicit, **audited** escape hatch that bypasses the gateway and connects directly
to a single Bit. Use it only for emergencies — e.g. the gateway is unhealthy, or you need to isolate a
misbehaving Bit. It is logged as `fleet.break_glass` and **can never be combined with `--all`**.

```bash
npm run brat -- fleet health --direct tool-gateway
```

## Read-only fan-out (`--all`) and gated mutations (`--confirm`)

- `--all` fans a **read-only** subcommand (`info`, `health`) out across every discovered Bit.
- **Mutations are never fanned out implicitly.** Fleet-wide / high-blast-radius mutations require an
  explicit `--confirm`, and run sequentially.

```bash
# Read-only across the whole fleet
npm run brat -- fleet info --all

# Mutating a single Bit (elevated)
npm run brat -- fleet log llm-bot --level debug
npm run brat -- fleet flags llm-bot set --key some.flag --value true

# High-blast-radius mutation requires --confirm
npm run brat -- fleet drain state-engine --confirm
```

## RBAC posture

RBAC is **server-authoritative**: Brat forwards the operator's identity (user id / roles) and never
self-authorizes. Subcommands map onto control-plane scopes:

- **`bit:read`** — `list`, `info`, `health`, `config`, `flags ... get`.
- **`bit:operate`** — `flags ... set`, `log`, `drain`, `shutdown`.

Commands **fail closed**: without a resolvable `MCP_AUTH_TOKEN` they refuse to run.

## Targeting a deployment (`--target`)

`--target <name>` selects a docker deployment target (e.g. `local` | `staging`) and reads that stack's
**Firestore emulator** registry instead of real GCP. For a local docker target, the gateway (and any
`--direct` Bit) is reached on its **published host port** — resolved from `<SERVICE>_HOST_PORT` or a
`docker ps` probe (e.g. `localhost:3001`), not the internal `:3000`. Without `--target`, GCP/ADC is used.
Set `TOOL_GATEWAY_URL` / `--url` to override the gateway endpoint explicitly.

```bash
npm run brat -- fleet list --target local
```

## Related reading

- [Bit Control-Plane Reference](../reference/bit-control-plane.md) — the `bit.*` tools and scopes.
- [The Bit Model](../concepts/bit-model.md)
- [`brat` CLI reference](../tools/brat.md)
- [Brat as a Fleet MCP Client (design doc)](../architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md)
