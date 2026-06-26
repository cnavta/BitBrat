import type { Logger } from '../orchestration/logger';
import { Queue } from '../orchestration/queue';
import {
  FleetBit,
  FleetCallResult,
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
}

/** Build a Bit-qualified discovery id for a platform tool (e.g. `mcp:auth/bit.health`). */
export function qualifiedToolId(bit: string, tool: string): string {
  return `mcp:${bit}/${tool}`;
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

  constructor(opts: FleetClientOptions) {
    this.transport = opts.transport;
    this.identity = opts.identity;
    this.registry = opts.registry;
    this.logger = opts.logger;
    this.concurrency = Math.max(1, opts.concurrency || 5);
  }

  /** Raw tool enumeration through the active transport. */
  async listTools(): Promise<FleetTool[]> {
    return this.transport.listTools(this.identity);
  }

  /**
   * Discover the live fleet. Derives Bits that own platform (`bit.*`) tools from the gateway's
   * qualified ids, then merges any registry entries (so a platform-only Bit still shows up with its
   * profile/exposure even if aggregation hasn't surfaced it).
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
      if (bit && !byName.has(bit)) {
        byName.set(bit, { name: bit });
      }
    }

    // 2. From the registry (optional): profile/exposure + platform-only Bits.
    if (this.registry) {
      try {
        const servers = await this.registry.listServers();
        for (const s of servers) {
          const existing = byName.get(s.name) || { name: s.name };
          existing.profile = s.profile ?? existing.profile;
          existing.exposure = s.exposure ?? existing.exposure;
          if (existing.exposure === 'platform-only') existing.platformOnly = true;
          byName.set(s.name, existing);
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
            return { bit: b.name, ok: false, error: /forbidden/i.test(msg) ? 'Forbidden' : (msg || 'unreachable') };
          }
        }),
      ),
    );
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
