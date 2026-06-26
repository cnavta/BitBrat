import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Logger } from '../../orchestration/logger';
import { ConfigurationError } from '../../orchestration/errors';
import { FleetIdentity, FleetTool, FleetTransport, RegistryReader } from '../types';
import { McpClientLike, parseMcpResult } from './gateway-transport';

/**
 * BL-204 §4.3 / §5 — BREAK-GLASS (direct-connect) transport.
 *
 * Bypasses the `tool-gateway` fabric and connects to exactly ONE Bit's registry-published MCP `/sse`
 * URL, sending the token to the Bit directly. RBAC is then enforced at the Bit only. This is the
 * escape hatch for when the gateway itself is unhealthy (OQ4) — it targets a single named Bit, never
 * aggregates, and never fans out. Because the Bit serves the un-qualified `bit.*` names, this
 * transport strips any `mcp:<bit>/` qualifier before calling upstream.
 */
export interface DirectTransportOptions {
  /** The single Bit this transport targets. */
  bit: string;
  /** Reader used to look up the Bit's external MCP URL (Firestore `mcp_servers`). */
  registry: RegistryReader;
  logger?: Logger;
  /** Override the MCP client factory (tests inject a mock). */
  clientFactory?: (url: string, identity: FleetIdentity) => Promise<McpClientLike>;
  /**
   * Optional rewrite of the registry-published URL before connecting. Used for local Docker targets
   * to remap a Bit's internal `http://<svc>.bitbrat.local:<containerPort>/sse` to the operator-
   * reachable `http://localhost:<publishedHostPort>/sse`.
   */
  urlRewriter?: (url: string, bit: string) => string;
}

/** Recover the upstream (un-qualified) tool name from a possibly-qualified discovery id. */
export function toUpstreamToolName(toolId: string): string {
  const noScheme = toolId.startsWith('mcp:') ? toolId.slice('mcp:'.length) : toolId;
  const slash = noScheme.indexOf('/');
  return slash >= 0 ? noScheme.slice(slash + 1) : noScheme;
}

export class DirectTransport implements FleetTransport {
  readonly label: string;
  private readonly bit: string;
  private readonly registry: RegistryReader;
  private readonly logger?: Logger;
  private readonly clientFactory: (url: string, identity: FleetIdentity) => Promise<McpClientLike>;
  private readonly urlRewriter?: (url: string, bit: string) => string;
  private client?: McpClientLike;

  constructor(opts: DirectTransportOptions) {
    this.bit = opts.bit;
    this.label = `direct:${opts.bit}`;
    this.registry = opts.registry;
    this.logger = opts.logger;
    this.clientFactory = opts.clientFactory || defaultDirectClientFactory;
    this.urlRewriter = opts.urlRewriter;
  }

  private async resolveUrl(): Promise<string> {
    const servers = await this.registry.listServers();
    const entry = servers.find((s) => s.name === this.bit);
    if (!entry || !entry.url) {
      throw new ConfigurationError(
        `Direct-connect target '${this.bit}' not found in the MCP registry (no self-published URL).`,
      );
    }
    if (this.urlRewriter) {
      const rewritten = this.urlRewriter(entry.url, this.bit);
      if (rewritten !== entry.url) {
        this.logger?.info(
          { action: 'fleet.direct.url_remapped', bit: this.bit, from: entry.url, to: rewritten },
          `Remapped Bit '${this.bit}' registry URL to local host port`,
        );
      }
      return rewritten;
    }
    return entry.url;
  }

  private async getClient(identity: FleetIdentity): Promise<McpClientLike> {
    if (!this.client) {
      const url = await this.resolveUrl();
      this.logger?.info({ action: 'fleet.direct.connect', bit: this.bit, url }, `Direct-connecting to Bit '${this.bit}'`);
      this.client = await this.clientFactory(url, identity);
    }
    return this.client;
  }

  async listTools(identity: FleetIdentity): Promise<FleetTool[]> {
    const client = await this.getClient(identity);
    const res = await client.listTools();
    return (res.tools || []).map((t) => ({ id: t.name, name: t.name, description: t.description }));
  }

  async callTool(toolId: string, args: Record<string, any>, identity: FleetIdentity): Promise<any> {
    const client = await this.getClient(identity);
    const name = toUpstreamToolName(toolId);
    const result = await client.callTool({
      name,
      arguments: args,
      _meta: { userRoles: identity.roles, userId: identity.userId },
    });
    if (result && (result as any).isError) {
      const msg = JSON.stringify((result as any).content || '');
      if (/forbidden|unauthorized/i.test(msg)) throw new Error('Forbidden');
      throw new Error(`MCP error: ${msg}`);
    }
    return parseMcpResult(result);
  }

  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = undefined;
    }
  }
}

async function defaultDirectClientFactory(url: string, identity: FleetIdentity): Promise<McpClientLike> {
  const transport = new SSEClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${identity.token}`,
        'x-mcp-token': identity.token,
        'x-agent-name': identity.agentName,
        ...(identity.roles.length ? { 'x-roles': identity.roles.join(',') } : {}),
        ...(identity.userId ? { 'x-user-id': identity.userId } : {}),
      },
    },
  });
  const client = new Client({ name: 'brat-fleet-direct', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport as any);
  return client as unknown as McpClientLike;
}
