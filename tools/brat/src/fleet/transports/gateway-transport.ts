import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Logger } from '../../orchestration/logger';
import { FleetIdentity, FleetTool, FleetTransport } from '../types';

/**
 * BL-204 §4.3 / §5 — DEFAULT (fabric) transport.
 *
 * Drives the universal `bit.*` control plane through the `tool-gateway` fabric — the single
 * auth/RBAC/discovery chokepoint (ADR-003). Reuses the platform `@modelcontextprotocol/sdk`
 * `Client` + `SSEClientTransport` wrappers (exactly as `McpClientManager` does) rather than
 * re-implementing transport. When SSE is unavailable it falls back to the gateway's REST mirror
 * (`GET /v1/tools`, `POST /v1/tools/:id`). Identity is forwarded via MCP `_meta.{userRoles,userId}`
 * and the `x-mcp-token`/`Authorization` header so RBAC (server-authoritative) can allow/deny.
 */

/** Minimal MCP client surface this transport relies on (the SDK `Client` satisfies it). */
export interface McpClientLike {
  connect(transport: any): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string }> }>;
  callTool(params: { name: string; arguments?: any; _meta?: any }, schema?: any): Promise<any>;
  close(): Promise<void>;
}

export interface GatewayTransportOptions {
  /** Base URL of the tool-gateway, e.g. `http://localhost:3000`. */
  baseUrl: string;
  logger?: Logger;
  /** Override the MCP client factory (tests inject a mock). Default builds an SDK SSE client. */
  clientFactory?: (baseUrl: string, identity: FleetIdentity) => Promise<McpClientLike>;
  /** Override fetch (tests inject a mock). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Force the REST mirror and skip SSE entirely (useful when SSE is known-down). */
  preferRest?: boolean;
}

/** Extract a usable payload from an MCP CallToolResult-style `{ content: [...] }` envelope. */
export function parseMcpResult(result: any): any {
  if (result == null) return result;
  const content = (result as any).content;
  if (Array.isArray(content)) {
    const text = content
      .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
    if (text.length > 0) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return content;
  }
  return result;
}

export class GatewayTransport implements FleetTransport {
  readonly label = 'gateway';
  private readonly baseUrl: string;
  private readonly logger?: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly clientFactory: (baseUrl: string, identity: FleetIdentity) => Promise<McpClientLike>;
  private readonly preferRest: boolean;
  private client?: McpClientLike;

  constructor(opts: GatewayTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.logger = opts.logger;
    this.fetchImpl = opts.fetchImpl || (globalThis.fetch as typeof fetch);
    this.preferRest = !!opts.preferRest;
    this.clientFactory = opts.clientFactory || defaultClientFactory;
  }

  private authHeaders(identity: FleetIdentity): Record<string, string> {
    return {
      Authorization: `Bearer ${identity.token}`,
      'x-mcp-token': identity.token,
      'x-agent-name': identity.agentName,
      ...(identity.roles.length ? { 'x-roles': identity.roles.join(',') } : {}),
      ...(identity.userId ? { 'x-user-id': identity.userId } : {}),
    };
  }

  private async getClient(identity: FleetIdentity): Promise<McpClientLike> {
    if (!this.client) {
      this.client = await this.clientFactory(this.baseUrl, identity);
    }
    return this.client;
  }

  async listTools(identity: FleetIdentity): Promise<FleetTool[]> {
    if (!this.preferRest) {
      try {
        const client = await this.getClient(identity);
        const res = await client.listTools();
        return (res.tools || []).map((t) => ({ id: t.name, name: unqualify(t.name), description: t.description }));
      } catch (e: any) {
        this.logger?.warn({ action: 'fleet.gateway.sse_list_failed', error: e?.message || String(e) },
          'Gateway SSE ListTools failed; falling back to REST GET /v1/tools');
      }
    }
    return this.restListTools(identity);
  }

  private async restListTools(identity: FleetIdentity): Promise<FleetTool[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/tools`, { headers: this.authHeaders(identity) });
    if (!res.ok) throw new Error(`Gateway GET /v1/tools failed: ${res.status}`);
    const body: any = await res.json();
    return (body.tools || []).map((t: any) => ({ id: t.id, name: unqualify(t.id), description: t.description }));
  }

  async callTool(toolId: string, args: Record<string, any>, identity: FleetIdentity): Promise<any> {
    if (!this.preferRest) {
      try {
        const client = await this.getClient(identity);
        const result = await client.callTool({
          name: toolId,
          arguments: args,
          _meta: { userRoles: identity.roles, userId: identity.userId },
        });
        if (result && (result as any).isError) {
          throw new Error(`MCP error: ${JSON.stringify((result as any).content)}`);
        }
        return parseMcpResult(result);
      } catch (e: any) {
        // A Forbidden / authorization decision is server-authoritative — surface it, do NOT retry on REST.
        if (isForbidden(e)) throw new Error('Forbidden');
        this.logger?.warn({ action: 'fleet.gateway.sse_call_failed', toolId, error: e?.message || String(e) },
          'Gateway SSE CallTool failed; falling back to REST POST /v1/tools/:id');
      }
    }
    return this.restCallTool(toolId, args, identity);
  }

  private async restCallTool(toolId: string, args: Record<string, any>, identity: FleetIdentity): Promise<any> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/tools/${encodeURIComponent(toolId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders(identity) },
      body: JSON.stringify({ args }),
    });
    if (res.status === 403) throw new Error('Forbidden');
    if (!res.ok) {
      let msg = `Gateway POST /v1/tools failed: ${res.status}`;
      try {
        const body: any = await res.json();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const body: any = await res.json();
    return body.result;
  }

  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = undefined;
    }
  }
}

/** Strip the `mcp:` / `mcp:<bit>/` qualifier to recover the human tool name. */
function unqualify(id: string): string {
  const noScheme = id.startsWith('mcp:') ? id.slice('mcp:'.length) : id;
  const slash = noScheme.indexOf('/');
  return slash >= 0 ? noScheme.slice(slash + 1) : noScheme;
}

function isForbidden(e: any): boolean {
  const m = (e?.message || String(e || '')).toLowerCase();
  return m.includes('forbidden') || m.includes('-32001') || m.includes('unauthorized');
}

async function defaultClientFactory(baseUrl: string, identity: FleetIdentity): Promise<McpClientLike> {
  const transport = new SSEClientTransport(new URL(`${baseUrl}/sse`), {
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
  const client = new Client({ name: 'brat-fleet', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport as any);
  return client as unknown as McpClientLike;
}
