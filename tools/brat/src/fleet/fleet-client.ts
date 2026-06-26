import type { Logger } from '../orchestration/logger';
import { Queue } from '../orchestration/queue';
import {
  FleetBit,
  FleetCallResult,
  FleetCallStatus,
  FleetIdentity,
  FleetTool,
  FleetTransport,
  RegistryReader,
} from './types';

/**
 * BL-204 §4.3 / §9 — the Brat-side fleet MCP client.
 *
 * Transport-agnostic: composes a {@link FleetTransport} (gateway by default, direct break-glass) and
 * an optional {@link RegistryReader}. It discovers Bits, lists them, and invokes the universal
 * `bit.*` control plane on one Bit (`call`) or fanned out read-only across the fleet (`callAll`).
 * Identity is always forwarded; RBAC is server-authoritative (the client never self-authorizes).
 */

export interface FleetClientOptions {
  transport: FleetTransport;
  identity: FleetIdentity;
  /** Optional registry read so platform-only Bits (zero domain tools) still appear in `list`. */
  registry?: RegistryReader;
  logger?: Logger;
  /** Bounded concurrency for read fan-out (`--all`). Defaults to 5. */
  concurrency?: number;
  /**
   * The tool-gateway's own service/registry name. The gateway is itself a Bit and self-registers in
   * `mcp_servers`, but it is the fabric chokepoint — it does not proxy the universal `bit.*` plane to
   * itself, so `mcp:<gateway>/bit.*` is never routable. We therefore never render it as a fleet
   * member. Defaults to `tool-gateway`.
   */
  gatewayServiceName?: string;
}

/**
 * Is this `mcp_servers` entry a genuine Bit (vs. a manually-registered external MCP server)?
 *
 * Bits self-register over the internal bus on boot and the tool-gateway stamps the resulting document
 * with `discoverySource: 'auto-registration'`. Non-Bit MCP servers (e.g. a stdio web-search tool an
 * operator adds by hand) carry no such marker and do NOT expose the `bit.*` control plane, so they
 * must not appear in the fleet. This is only consulted on the registry FALLBACK path (gateway
 * unreachable); when the fabric is reachable, fleet membership is derived from it directly.
 */
export function isBitRegistryEntry(entry: { discoverySource?: string }): boolean {
  return entry.discoverySource === 'auto-registration';
}

/** Build a Bit-qualified discovery id for a platform tool (e.g. `mcp:auth/bit.health`). */
export function qualifiedToolId(bit: string, tool: string): string {
  return `mcp:${bit}/${tool}`;
}

/**
 * Classify a failed `bit.*` call so the CLI can label it accurately rather than treating every
 * failure as `unreachable`:
 *  - `forbidden`   — server-authoritative RBAC denial (the Bit is reachable; the operator identity
 *                    lacks the required scope — supply elevated `--roles`). Never retried.
 *  - `unreachable` — a transport/connection failure (ECONNREFUSED / fetch failed / ENOTFOUND /
 *                    timeout / socket hang up): the Bit is down or not reachable.
 *  - `error`       — any other operational failure surfaced by the Bit.
 */
export function classifyFleetError(message: string): FleetCallStatus {
  const m = (message || '').toLowerCase();
  if (/forbidden|unauthorized|-32001|\b401\b|\b403\b/.test(m)) return 'forbidden';
  if (/econnrefused|enotfound|eai_again|fetch failed|socket hang up|network|timed? ?out|etimedout|econnreset|tunnel|getaddrinfo/.test(m)) {
    return 'unreachable';
  }
  return 'error';
}

/** Parse the owning Bit out of a qualified platform-tool id; undefined for unqualified domain ids. */
export function bitFromToolId(id: string): string | undefined {
  if (!id.startsWith('mcp:')) return undefined;
  const rest = id.slice('mcp:'.length);
  const slash = rest.indexOf('/');
  return slash > 0 ? rest.slice(0, slash) : undefined;
}

export class FleetClient {
  private readonly transport: FleetTransport;
  private readonly identity: FleetIdentity;
  private readonly registry?: RegistryReader;
  private readonly logger?: Logger;
  private readonly concurrency: number;
  private readonly gatewayServiceName: string;

  constructor(opts: FleetClientOptions) {
    this.transport = opts.transport;
    this.identity = opts.identity;
    this.registry = opts.registry;
    this.logger = opts.logger;
    this.concurrency = Math.max(1, opts.concurrency || 5);
    this.gatewayServiceName = opts.gatewayServiceName || 'tool-gateway';
  }

  /** Raw tool enumeration through the active transport. */
  async listTools(): Promise<FleetTool[]> {
    return this.transport.listTools(this.identity);
  }

  /**
   * Discover the live fleet — the Bits that expose the universal `bit.*` control plane.
   *
   * Derives Bits from the fabric (the gateway Bit-qualifies platform `bit.*` tools as
   * `mcp:<bit>/bit.*`; domain tools from any MCP server stay unqualified), then merges the
   * `mcp_servers` registry so a platform-only Bit with zero domain tools still appears with its
   * profile/exposure (BL2-203).
   *
   * The registry, however, is the gateway's UPSTREAM catalog — it also contains non-Bit MCP servers
   * (e.g. a manually-added stdio web-search tool) and the gateway itself, neither of which expose the
   * `bit.*` plane. Those previously leaked into the fleet and then failed every `bit.*` call with
   * `unreachable (Tool not found)`. So the registry contribution is filtered to GENUINE, self-
   * registered Bits ({@link isBitRegistryEntry}) and the gateway's own service is never rendered (it
   * is the fabric chokepoint, not its own routable upstream).
   */
  async discover(): Promise<FleetBit[]> {
    const byName = new Map<string, FleetBit>();

    // 1. From the fabric: which Bits own which bit.* tools (qualified ids).
    let tools: FleetTool[] = [];
    try {
      tools = await this.transport.listTools(this.identity);
    } catch (e: any) {
      this.logger?.warn({ action: 'fleet.discover.list_failed', error: e?.message || String(e) },
        'Fleet tool enumeration failed; relying on registry (if available)');
    }
    for (const t of tools) {
      const bit = bitFromToolId(t.id);
      if (bit && bit !== this.gatewayServiceName && !byName.has(bit)) {
        byName.set(bit, { name: bit });
      }
    }

    // 2. From the registry (optional): profile/exposure + platform-only Bits — but ONLY for genuine
    //    self-registered Bits (never non-Bit MCP servers) and never the gateway itself.
    if (this.registry) {
      try {
        const servers = await this.registry.listServers();
        for (const s of servers) {
          if (s.name === this.gatewayServiceName) continue; // the gateway is never a fleet member
          const existing = byName.get(s.name);
          if (existing) {
            // The fabric already surfaced this Bit — enrich it regardless of the registry marker.
            existing.profile = s.profile ?? existing.profile;
            existing.exposure = s.exposure ?? existing.exposure;
            if (existing.exposure === 'platform-only') existing.platformOnly = true;
            continue;
          }
          // Registry-only entry: include it only if it is a genuine Bit; skip non-Bit MCP servers.
          if (!isBitRegistryEntry(s)) {
            this.logger?.debug?.(
              { action: 'fleet.discover.non_bit_skipped', name: s.name, discoverySource: s.discoverySource },
              `Registry entry '${s.name}' is not a Bit (no auto-registration marker); excluded from the fleet`,
            );
            continue;
          }
          const fb: FleetBit = { name: s.name, profile: s.profile, exposure: s.exposure };
          if (fb.exposure === 'platform-only') fb.platformOnly = true;
          byName.set(s.name, fb);
        }
      } catch (e: any) {
        this.logger?.warn({ action: 'fleet.discover.registry_failed', error: e?.message || String(e) },
          'Registry read failed; rendering Bits from the fabric only');
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Alias of {@link discover} — `brat fleet list` renders this. */
  async list(): Promise<FleetBit[]> {
    return this.discover();
  }

  /** Invoke a `bit.*` tool on a single named Bit, forwarding identity. */
  async call(bit: string, tool: string, args: Record<string, any> = {}): Promise<any> {
    return this.transport.callTool(qualifiedToolId(bit, tool), args, this.identity);
  }

  /**
   * Read-only fan-out: invoke `tool` on every discovered Bit using a bounded queue, tolerating
   * partial failure (a down Bit is reported `unreachable`, the rest still return). Never used for
   * mutations (the command layer gates those behind `--confirm` and runs them sequentially).
   */
  async callAll(tool: string, args: Record<string, any> = {}): Promise<FleetCallResult[]> {
    const bits = await this.discover();
    const queue = new Queue(this.concurrency);
    return Promise.all(
      bits.map((b) =>
        queue.add<FleetCallResult>(async () => {
          try {
            const result = await this.call(b.name, tool, args);
            return { bit: b.name, ok: true, result };
          } catch (e: any) {
            const msg = e?.message || String(e);
            const status = classifyFleetError(msg);
            // Preserve a clean, stable message for the common RBAC case; otherwise surface the raw error.
            const error = status === 'forbidden' ? 'Forbidden' : (msg || 'unreachable');
            return { bit: b.name, ok: false, status, error };
          }
        }),
      ),
    );
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
