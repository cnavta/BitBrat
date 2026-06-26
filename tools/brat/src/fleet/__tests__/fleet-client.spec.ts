import { PermissionError } from '../../orchestration/errors';
import { resolveIdentity, resolveToken } from '../rbac-context';
import { GatewayTransport } from '../transports/gateway-transport';
import { DirectTransport } from '../transports/direct-transport';
import { FleetClient, classifyFleetError } from '../fleet-client';
import { FleetIdentity, FleetTool, FleetTransport, RegistryReader } from '../types';

const IDENTITY: FleetIdentity = { token: 't0ken', roles: ['bit:read'], agentName: 'brat' };

function silentLogger(): any {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

describe('rbac-context — fail-closed token resolution (OQ3)', () => {
  const ORIG = process.env.MCP_AUTH_TOKEN;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = ORIG;
  });

  it('resolves a token from MCP_AUTH_TOKEN env', () => {
    process.env.MCP_AUTH_TOKEN = 'env-token';
    expect(resolveToken()).toBe('env-token');
    const id = resolveIdentity({ roles: ['bit:read'] });
    expect(id.token).toBe('env-token');
    expect(id.agentName).toBe('brat');
  });

  it('prefers an explicit token over discovery', () => {
    process.env.MCP_AUTH_TOKEN = 'env-token';
    expect(resolveToken({ token: 'explicit' })).toBe('explicit');
  });

  it('fails closed (PermissionError + posture warning) when no token resolves', () => {
    delete process.env.MCP_AUTH_TOKEN;
    const logger = silentLogger();
    const warn = jest.spyOn(logger, 'warn');
    // point cwd at a dir with no secret files
    expect(() => resolveIdentity({ cwd: '/nonexistent-dir-xyz' }, logger)).toThrow(PermissionError);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fleet.auth.posture_warning' }),
      expect.any(String),
    );
  });
});

describe('GatewayTransport (default fabric)', () => {
  it('maps gateway ListTools (qualified ids) to FleetTool and forwards _meta on callTool', async () => {
    const calls: any[] = [];
    const mockClient = {
      connect: async () => {},
      listTools: async () => ({ tools: [{ name: 'mcp:auth/bit.health' }, { name: 'mcp:story.generate' }] }),
      callTool: async (p: any) => { calls.push(p); return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }; },
      close: async () => {},
    };
    const t = new GatewayTransport({ baseUrl: 'http://gw', clientFactory: async () => mockClient });
    const tools = await t.listTools(IDENTITY);
    expect(tools.find((x) => x.id === 'mcp:auth/bit.health')?.name).toBe('bit.health');

    const res = await t.callTool('mcp:auth/bit.health', { a: 1 }, IDENTITY);
    expect(res).toEqual({ ok: true });
    expect(calls[0]._meta).toEqual({ userRoles: ['bit:read'], userId: undefined });
    expect(calls[0].name).toBe('mcp:auth/bit.health');
  });

  it('falls back to the REST mirror (GET /v1/tools, POST /v1/tools/:id) when preferRest', async () => {
    const fetchImpl = jest.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith('/v1/tools') && (!init || init.method === undefined)) {
        return { ok: true, status: 200, json: async () => ({ tools: [{ id: 'mcp:persistence/bit.info', description: 'd' }] }) } as any;
      }
      // POST /v1/tools/:id (id is URL-encoded)
      expect(u).toContain(encodeURIComponent('mcp:persistence/bit.info'));
      return { ok: true, status: 200, json: async () => ({ result: { name: 'persistence' } }) } as any;
    });
    const t = new GatewayTransport({ baseUrl: 'http://gw', preferRest: true, fetchImpl: fetchImpl as any });
    const tools = await t.listTools(IDENTITY);
    expect(tools[0].id).toBe('mcp:persistence/bit.info');
    const res = await t.callTool('mcp:persistence/bit.info', {}, IDENTITY);
    expect(res).toEqual({ name: 'persistence' });
  });

  it('surfaces a 403 as Forbidden over REST (no retry)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) } as any));
    const t = new GatewayTransport({ baseUrl: 'http://gw', preferRest: true, fetchImpl: fetchImpl as any });
    await expect(t.callTool('mcp:auth/bit.shutdown', {}, IDENTITY)).rejects.toThrow('Forbidden');
  });
});

describe('DirectTransport (break-glass)', () => {
  const registry: RegistryReader = {
    listServers: async () => [{ name: 'auth', url: 'http://auth-bit/sse', exposure: 'platform-only' }],
  };

  it('resolves the single Bit URL and strips the qualifier before calling upstream', async () => {
    const calls: any[] = [];
    const mockClient = {
      connect: async () => {},
      listTools: async () => ({ tools: [{ name: 'bit.health' }] }),
      callTool: async (p: any) => { calls.push(p); return { content: [{ type: 'text', text: 'OK' }] }; },
      close: async () => {},
    };
    const t = new DirectTransport({ bit: 'auth', registry, clientFactory: async () => mockClient });
    const res = await t.callTool('mcp:auth/bit.health', {}, IDENTITY);
    expect(res).toBe('OK');
    expect(calls[0].name).toBe('bit.health'); // qualifier stripped
  });

  it('throws when the target Bit is not in the registry', async () => {
    const empty: RegistryReader = { listServers: async () => [] };
    const t = new DirectTransport({ bit: 'ghost', registry: empty, clientFactory: async () => ({} as any) });
    await expect(t.callTool('mcp:ghost/bit.health', {}, IDENTITY)).rejects.toThrow(/not found in the MCP registry/);
  });
});

describe('FleetClient', () => {
  function fakeTransport(tools: FleetTool[], onCall?: (id: string) => any): FleetTransport {
    return {
      label: 'gateway',
      listTools: async () => tools,
      callTool: async (id: string) => (onCall ? onCall(id) : { id }),
      close: async () => {},
    };
  }

  it('discover() merges fabric + genuine registry Bits so a platform-only Bit (no domain tools) appears', async () => {
    const transport = fakeTransport([
      { id: 'mcp:auth/bit.info' },
      { id: 'mcp:story.generate' }, // domain tool, no qualifier => no Bit derived
    ]);
    const registry: RegistryReader = {
      listServers: async () => [
        { name: 'auth', profile: 'core', exposure: 'platform-only', discoverySource: 'auto-registration' },
        // platform-only, not surfaced by the fabric tools above, but a genuine self-registered Bit.
        { name: 'persistence', profile: 'core', exposure: 'platform-only', discoverySource: 'auto-registration' },
      ],
    };
    const client = new FleetClient({ transport, identity: IDENTITY, registry, logger: silentLogger() });
    const bits = await client.discover();
    const names = bits.map((b) => b.name);
    expect(names).toContain('auth');
    expect(names).toContain('persistence');
    expect(bits.find((b) => b.name === 'persistence')?.platformOnly).toBe(true);
  });

  it('discover() excludes non-Bit MCP servers and the gateway itself (regression: spurious "Tool not found" rows)', async () => {
    const transport = fakeTransport([{ id: 'mcp:auth/bit.info' }]);
    const registry: RegistryReader = {
      listServers: async () => [
        { name: 'auth', exposure: 'platform-only', discoverySource: 'auto-registration' },
        // A genuine platform-only Bit not surfaced by the fabric tools above — kept.
        { name: 'persistence', exposure: 'platform-only', discoverySource: 'auto-registration' },
        // The gateway itself is a Bit but is never a fleet member (not its own routable upstream).
        { name: 'tool-gateway', discoverySource: 'auto-registration' },
        // Manually-registered external MCP servers (no auto-registration marker) -> not Bits.
        { name: 'Simple Web Search' },
        { name: 'Twitch Information' },
      ],
    };
    const client = new FleetClient({ transport, identity: IDENTITY, registry, logger: silentLogger() });
    const names = (await client.discover()).map((b) => b.name);
    expect(names).toEqual(['auth', 'persistence']);
  });

  it('discover() still excludes non-Bits/gateway when the fabric is unreachable', async () => {
    const transport: FleetTransport = {
      label: 'gateway',
      listTools: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3000'); },
      callTool: async () => ({}),
      close: async () => {},
    };
    const registry: RegistryReader = {
      listServers: async () => [
        { name: 'auth', exposure: 'platform-only', discoverySource: 'auto-registration' },
        { name: 'persistence', exposure: 'platform-only', discoverySource: 'auto-registration' },
        { name: 'tool-gateway', discoverySource: 'auto-registration' }, // gateway excluded
        { name: 'Simple Web Search' }, // non-Bit excluded
        { name: 'Twitch Information' }, // non-Bit excluded
      ],
    };
    const client = new FleetClient({ transport, identity: IDENTITY, registry, logger: silentLogger() });
    const names = (await client.discover()).map((b) => b.name);
    expect(names).toEqual(['auth', 'persistence']);
  });

  it('call() builds the Bit-qualified id', async () => {
    const seen: string[] = [];
    const transport = fakeTransport([], (id) => { seen.push(id); return { ok: true }; });
    const client = new FleetClient({ transport, identity: IDENTITY });
    await client.call('auth', 'bit.health', {});
    expect(seen[0]).toBe('mcp:auth/bit.health');
  });

  it('callAll() fans out read-only and tolerates one unreachable Bit (partial failure)', async () => {
    const transport: FleetTransport = {
      label: 'gateway',
      listTools: async () => [{ id: 'mcp:auth/bit.health' }, { id: 'mcp:persistence/bit.health' }],
      callTool: async (id: string) => {
        if (id.startsWith('mcp:persistence/')) throw new Error('connect ECONNREFUSED');
        return { status: 'ok' };
      },
      close: async () => {},
    };
    const client = new FleetClient({ transport, identity: IDENTITY });
    const results = await client.callAll('bit.health', {});
    const auth = results.find((r) => r.bit === 'auth');
    const persistence = results.find((r) => r.bit === 'persistence');
    expect(auth?.ok).toBe(true);
    expect(persistence?.ok).toBe(false);
    expect(persistence?.status).toBe('unreachable');
    expect(results.length).toBe(2); // the rest still returns
  });

  it('callAll() classifies a Forbidden Bit distinctly from an unreachable one (regression: "unreachable (Forbidden)")', async () => {
    const transport: FleetTransport = {
      label: 'gateway',
      listTools: async () => [
        { id: 'mcp:auth/bit.info' },
        { id: 'mcp:scheduler/bit.info' },
        { id: 'mcp:persistence/bit.info' },
      ],
      callTool: async (id: string) => {
        if (id.startsWith('mcp:scheduler/')) throw new Error('Forbidden'); // server-authoritative RBAC denial
        if (id.startsWith('mcp:persistence/')) throw new Error('connect ECONNREFUSED 127.0.0.1:3000');
        return { name: 'auth' };
      },
      close: async () => {},
    };
    const client = new FleetClient({ transport, identity: IDENTITY });
    const results = await client.callAll('bit.info', {});
    const scheduler = results.find((r) => r.bit === 'scheduler');
    const persistence = results.find((r) => r.bit === 'persistence');
    expect(scheduler).toMatchObject({ ok: false, status: 'forbidden', error: 'Forbidden' });
    expect(persistence?.status).toBe('unreachable'); // NOT conflated with forbidden
  });
});

describe('classifyFleetError', () => {
  it('classifies RBAC denials as forbidden', () => {
    expect(classifyFleetError('Forbidden')).toBe('forbidden');
    expect(classifyFleetError('MCP error -32001: unauthorized')).toBe('forbidden');
    expect(classifyFleetError('Gateway POST /v1/tools failed: 403')).toBe('forbidden');
  });

  it('classifies connection failures as unreachable', () => {
    expect(classifyFleetError('connect ECONNREFUSED 127.0.0.1:3000')).toBe('unreachable');
    expect(classifyFleetError('fetch failed')).toBe('unreachable');
    expect(classifyFleetError('getaddrinfo ENOTFOUND scheduler.bitbrat.local')).toBe('unreachable');
    expect(classifyFleetError('socket hang up')).toBe('unreachable');
  });

  it('falls back to a generic error for anything else', () => {
    expect(classifyFleetError('MCP error -32603: Tool not found')).toBe('error');
    expect(classifyFleetError('boom')).toBe('error');
  });
});
