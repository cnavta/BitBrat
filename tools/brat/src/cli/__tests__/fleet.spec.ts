import { parseFleetArgs, runFleet, FleetDeps } from '../fleet';
import { PermissionError, ConfigurationError } from '../../orchestration/errors';
import { FleetIdentity, FleetTool, FleetTransport, RegistryReader } from '../../fleet';

const IDENTITY: FleetIdentity = { token: 't', roles: ['bit:read'], agentName: 'brat' };

function silentLogger(): any {
  const calls: any[] = [];
  const mk = () => (obj: any, msg?: any) => calls.push({ obj, msg });
  return { info: mk(), warn: mk(), error: mk(), debug: mk(), _calls: calls };
}

/** A recording transport with configurable per-tool behavior. */
class FakeTransport implements FleetTransport {
  readonly label: string;
  calls: Array<{ toolId: string; args: any }> = [];
  constructor(
    label: string,
    private tools: FleetTool[],
    private behavior: (toolId: string) => any = () => ({ ok: true }),
  ) {
    this.label = label;
  }
  async listTools(): Promise<FleetTool[]> { return this.tools; }
  async callTool(toolId: string, args: Record<string, any>): Promise<any> {
    this.calls.push({ toolId, args });
    return this.behavior(toolId);
  }
  async close(): Promise<void> { /* noop */ }
}

const registry: RegistryReader = {
  listServers: async () => [
    { name: 'auth', profile: 'core', exposure: 'platform-only' },
    { name: 'persistence', profile: 'core', exposure: 'platform-only' },
  ],
};

function deps(transport: FleetTransport, out: string[], logger: any, directTransport?: FleetTransport): FleetDeps {
  return {
    resolveIdentityFn: () => IDENTITY,
    gatewayTransportFactory: () => transport,
    directTransportFactory: () => directTransport || transport,
    registryFactory: () => registry,
    out: (l) => out.push(l),
  };
}

describe('brat fleet — parseFleetArgs', () => {
  it('parses subcommand, positionals, and modifiers from cmd/rest', () => {
    const args = parseFleetArgs(
      ['fleet', 'flags', 'auth', 'set'],
      ['--key=k', '--value=v'],
      { json: true },
    );
    expect(args.sub).toBe('flags');
    expect(args.positionals).toEqual(['auth', 'set']);
    expect(args.key).toBe('k');
    expect(args.value).toBe('v');
    expect(args.json).toBe(true);
  });

  it('captures --all, --direct <bit>, --confirm, --describe', () => {
    const args = parseFleetArgs(['fleet', 'info'], ['--all', '--describe'], {});
    expect(args.all).toBe(true);
    expect(args.describe).toBe(true);
    const a2 = parseFleetArgs(['fleet', 'drain'], ['--direct=auth', '--confirm'], {});
    expect(a2.direct).toBe('auth');
    expect(a2.confirm).toBe(true);
  });

  it('captures --target and connection overrides', () => {
    const args = parseFleetArgs(['fleet', 'list'], ['--target=local'], {});
    expect(args.target).toBe('local');
    const a2 = parseFleetArgs(
      ['fleet', 'list'],
      ['--project-id=p', '--emulator-host=localhost:8080', '--database=db'],
      {},
    );
    expect(a2.projectId).toBe('p');
    expect(a2.emulatorHost).toBe('localhost:8080');
    expect(a2.database).toBe('db');
    expect(a2.target).toBeUndefined();
  });
});

describe('brat fleet — deployment target resolution (--target)', () => {
  it('resolves --target to the emulator connection and builds the registry from it', async () => {
    const t = new FakeTransport('gateway', [], () => ({}));
    const out: string[] = [];
    const seenConnect: any[] = [];
    const cleanup = jest.fn(async () => {});
    const resolved = {
      connectOptions: { emulatorHost: 'localhost:8080', projectId: 'bitbrat-local', databaseId: '(default)' },
      isEmulator: true,
      targetName: 'local',
      description: "target 'local' -> Firestore emulator localhost:8080 (project 'bitbrat-local')",
      cleanup,
    };
    const resolver = jest.fn(async () => resolved as any);
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: () => t,
      registryFactory: (connect) => {
        seenConnect.push(connect);
        return registry;
      },
      connectionResolverFn: resolver as any,
      out: (l) => out.push(l),
    };
    const bits = await runFleet(parseFleetArgs(['fleet', 'list'], ['--target=local'], { json: true }), {}, silentLogger(), d);
    // The resolver was consulted and its emulator connect options reached the registry factory.
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(seenConnect[0]).toEqual(resolved.connectOptions);
    // The registry (emulator-backed) still rendered Bits even though the gateway returned nothing.
    expect(bits.map((b: any) => b.name).sort()).toEqual(['auth', 'persistence']);
    // Any tunnel/handle opened for the target is torn down.
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does NOT consult the target resolver when no --target is given', async () => {
    const t = new FakeTransport('gateway', [], () => ({}));
    const out: string[] = [];
    const resolver = jest.fn(async () => { throw new Error('should not be called'); });
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: () => t,
      registryFactory: () => registry,
      connectionResolverFn: resolver as any,
      out: (l) => out.push(l),
    };
    await runFleet(parseFleetArgs(['fleet', 'list'], [], { json: true }), {}, silentLogger(), d);
    expect(resolver).not.toHaveBeenCalled();
  });

  // --target is a property of the shared runFleet path, not of any single subcommand. These cases
  // prove parity: every read AND mutating subcommand resolves --target through the same resolver and
  // threads the resolved (emulator) connect options into the registry — not just `list`.
  const TARGET_CASES: Array<{ name: string; cmd: string[]; rest: string[] }> = [
    { name: 'list', cmd: ['fleet', 'list'], rest: ['--target=local'] },
    { name: 'info', cmd: ['fleet', 'info', 'auth'], rest: ['--target=local'] },
    { name: 'health', cmd: ['fleet', 'health', 'auth'], rest: ['--target=local'] },
    { name: 'config', cmd: ['fleet', 'config', 'auth'], rest: ['--target=local'] },
    { name: 'flags get', cmd: ['fleet', 'flags', 'auth', 'get'], rest: ['--target=local'] },
    { name: 'flags set', cmd: ['fleet', 'flags', 'auth', 'set'], rest: ['--target=local', '--key=k', '--value=v'] },
    { name: 'log', cmd: ['fleet', 'log', 'auth'], rest: ['--target=local', '--level=debug'] },
    { name: 'drain', cmd: ['fleet', 'drain', 'auth'], rest: ['--target=local'] },
    { name: 'shutdown', cmd: ['fleet', 'shutdown', 'auth'], rest: ['--target=local'] },
  ];

  it.each(TARGET_CASES)('honors --target for `$name` (resolver + emulator connect reach the registry)', async ({ cmd, rest }) => {
    const t = new FakeTransport('gateway', [], () => ({ ok: true }));
    const out: string[] = [];
    const seenConnect: any[] = [];
    const resolved = {
      connectOptions: { emulatorHost: 'localhost:8080', projectId: 'bitbrat-local', databaseId: '(default)' },
      isEmulator: true,
      targetName: 'local',
      description: "target 'local' -> Firestore emulator localhost:8080 (project 'bitbrat-local')",
      cleanup: jest.fn(async () => {}),
    };
    const resolver = jest.fn(async () => resolved as any);
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: () => t,
      registryFactory: (connect) => { seenConnect.push(connect); return registry; },
      connectionResolverFn: resolver as any,
      out: (l) => out.push(l),
    };
    await runFleet(parseFleetArgs(cmd, rest, {}), {}, silentLogger(), d);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(seenConnect[0]).toEqual(resolved.connectOptions);
    expect(resolved.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('brat fleet — local Docker host-port mapping (regression: always used :3000)', () => {
  const LOCAL_RESOLVED = {
    connectOptions: { emulatorHost: 'localhost:8080', projectId: 'bitbrat-local', databaseId: '(default)' },
    isEmulator: true,
    targetName: 'local',
    targetKind: 'local' as const,
    description: "target 'local' -> Firestore emulator localhost:8080 (project 'bitbrat-local')",
    cleanup: jest.fn(async () => {}),
  };

  it('derives the gateway URL from the tool-gateway PUBLISHED host port (not the internal 3000)', async () => {
    let baseUrl = '';
    const seenResolve: Array<{ service: string; containerPort: number }> = [];
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: (url) => { baseUrl = url; return new FakeTransport('gateway', [], () => ({})); },
      registryFactory: () => registry,
      connectionResolverFn: jest.fn(async () => LOCAL_RESOLVED) as any,
      hostPortResolverFn: (service, containerPort) => { seenResolve.push({ service, containerPort }); return 3006; },
      out: () => {},
    };
    await runFleet(parseFleetArgs(['fleet', 'list'], ['--target=local'], { json: true }), {}, silentLogger(), d);
    // The published host port for the tool-gateway (3006) is used — not the hardcoded internal 3000.
    expect(baseUrl).toBe('http://localhost:3006');
    expect(seenResolve).toEqual([{ service: 'tool-gateway', containerPort: 3000 }]);
  });

  it('does NOT probe docker host ports without a target (gateway stays on :3000)', async () => {
    let baseUrl = '';
    const hostPortResolverFn = jest.fn(() => 9999);
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: (url) => { baseUrl = url; return new FakeTransport('gateway', [], () => ({})); },
      registryFactory: () => registry,
      hostPortResolverFn,
      out: () => {},
    };
    await runFleet(parseFleetArgs(['fleet', 'list'], [], { json: true }), {}, silentLogger(), d);
    expect(hostPortResolverFn).not.toHaveBeenCalled();
    expect(baseUrl).toBe('http://localhost:3000');
  });

  it('an explicit --url / TOOL_GATEWAY_URL always wins over docker discovery', async () => {
    let baseUrl = '';
    const hostPortResolverFn = jest.fn(() => 3006);
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: (url) => { baseUrl = url; return new FakeTransport('gateway', [], () => ({})); },
      registryFactory: () => registry,
      connectionResolverFn: jest.fn(async () => LOCAL_RESOLVED) as any,
      hostPortResolverFn,
      out: () => {},
    };
    await runFleet(parseFleetArgs(['fleet', 'list'], ['--target=local'], { json: true }), { url: 'http://localhost:9000/' }, silentLogger(), d);
    expect(baseUrl).toBe('http://localhost:9000');
    expect(hostPortResolverFn).not.toHaveBeenCalled();
  });

  it('passes a per-Bit URL rewriter to the direct transport for a local docker target', async () => {
    let seenRewriter: ((url: string, bit: string) => string) | undefined;
    const direct = new FakeTransport('direct:auth', [], () => ({ ok: true }));
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: () => new FakeTransport('gateway', [], () => ({})),
      directTransportFactory: (_bit, _registry, _logger, urlRewriter) => { seenRewriter = urlRewriter; return direct; },
      registryFactory: () => registry,
      connectionResolverFn: jest.fn(async () => LOCAL_RESOLVED) as any,
      hostPortResolverFn: () => 3006,
      out: () => {},
    };
    await runFleet(parseFleetArgs(['fleet', 'info', 'auth'], ['--target=local', '--direct=auth'], { json: true }), {}, silentLogger(), d);
    expect(typeof seenRewriter).toBe('function');
    // The rewriter remaps an internal compose URL to the published host port via the resolver.
    expect(seenRewriter!('http://auth.bitbrat.local:3000/sse', 'auth')).toBe('http://localhost:3006/sse');
  });

  it('does NOT pass a URL rewriter to the direct transport without a target', async () => {
    let seenRewriter: ((url: string, bit: string) => string) | undefined = (() => 'sentinel') as any;
    const direct = new FakeTransport('direct:auth', [], () => ({ ok: true }));
    const d: FleetDeps = {
      resolveIdentityFn: () => IDENTITY,
      gatewayTransportFactory: () => new FakeTransport('gateway', [], () => ({})),
      directTransportFactory: (_bit, _registry, _logger, urlRewriter) => { seenRewriter = urlRewriter; return direct; },
      registryFactory: () => registry,
      out: () => {},
    };
    await runFleet(parseFleetArgs(['fleet', 'info', 'auth'], ['--direct=auth'], { json: true }), {}, silentLogger(), d);
    expect(seenRewriter).toBeUndefined();
  });
});

describe('brat fleet — read commands (bit:read)', () => {
  it('info <bit> calls bit.info on the qualified id', async () => {
    const t = new FakeTransport('gateway', [], () => ({ name: 'auth' }));
    const out: string[] = [];
    await runFleet(parseFleetArgs(['fleet', 'info', 'auth'], [], { json: true }), {}, silentLogger(), deps(t, out, silentLogger()));
    expect(t.calls[0].toolId).toBe('mcp:auth/bit.info');
  });

  it('config <bit> --describe maps to bit.config.describe', async () => {
    const t = new FakeTransport('gateway', [], () => ({ cfg: true }));
    const out: string[] = [];
    await runFleet(parseFleetArgs(['fleet', 'config', 'auth'], ['--describe'], {}), {}, silentLogger(), deps(t, out, silentLogger()));
    expect(t.calls[0].toolId).toBe('mcp:auth/bit.config.describe');
  });

  it('--all fans out read-only and tolerates an unreachable Bit', async () => {
    const tools: FleetTool[] = [{ id: 'mcp:auth/bit.health' }, { id: 'mcp:persistence/bit.health' }];
    const t = new FakeTransport('gateway', tools, (id) => {
      if (id.startsWith('mcp:persistence/')) throw new Error('ECONNREFUSED');
      return { status: 'ok' };
    });
    const out: string[] = [];
    const results = await runFleet(parseFleetArgs(['fleet', 'health'], ['--all'], { json: true }), {}, silentLogger(), deps(t, out, silentLogger()));
    expect(results.find((r: any) => r.bit === 'auth').ok).toBe(true);
    expect(results.find((r: any) => r.bit === 'persistence').ok).toBe(false);
  });
});

describe('brat fleet — mutating commands (bit:operate)', () => {
  it('flags set maps to bit.flags.set with key/value', async () => {
    const t = new FakeTransport('gateway', [], () => ({ set: true }));
    const out: string[] = [];
    await runFleet(parseFleetArgs(['fleet', 'flags', 'auth', 'set'], ['--key=feature', '--value=on'], {}), {}, silentLogger(), deps(t, out, silentLogger()));
    expect(t.calls[0].toolId).toBe('mcp:auth/bit.flags.set');
    expect(t.calls[0].args).toEqual({ key: 'feature', value: 'on' });
  });

  it('surfaces Forbidden from an insufficient-scope shutdown and does not retry', async () => {
    const t = new FakeTransport('gateway', [], () => { throw new Error('Forbidden'); });
    const out: string[] = [];
    await expect(
      runFleet(parseFleetArgs(['fleet', 'shutdown', 'auth'], [], {}), {}, silentLogger(), deps(t, out, silentLogger())),
    ).rejects.toThrow('Forbidden');
    expect(t.calls.length).toBe(1); // single attempt
  });

  it('fleet-wide shutdown is NOT implied by --all without --confirm', async () => {
    const t = new FakeTransport('gateway', [{ id: 'mcp:auth/bit.health' }], () => ({}));
    const out: string[] = [];
    await expect(
      runFleet(parseFleetArgs(['fleet', 'shutdown'], ['--all'], {}), {}, silentLogger(), deps(t, out, silentLogger())),
    ).rejects.toThrow(ConfigurationError);
    expect(t.calls.length).toBe(0); // refused before any call
  });

  it('fleet-wide shutdown with --confirm runs sequentially across discovered Bits', async () => {
    const t = new FakeTransport('gateway', [{ id: 'mcp:auth/bit.info' }], () => ({ ok: true }));
    const out: string[] = [];
    const results = await runFleet(parseFleetArgs(['fleet', 'shutdown'], ['--all', '--confirm'], { json: true }), {}, silentLogger(), deps(t, out, silentLogger()));
    const bits = results.map((r: any) => r.bit).sort();
    expect(bits).toEqual(['auth', 'persistence']);
  });
});

describe('brat fleet — break-glass (--direct) guardrails', () => {
  it('emits a fleet.break_glass audit line and uses the direct transport', async () => {
    const gateway = new FakeTransport('gateway', [], () => ({}));
    const direct = new FakeTransport('direct:auth', [], () => ({ via: 'direct' }));
    const logger = silentLogger();
    const out: string[] = [];
    const res = await runFleet(parseFleetArgs(['fleet', 'info', 'auth'], ['--direct=auth'], { json: true }), {}, logger, deps(gateway, out, logger, direct));
    expect(res).toEqual({ via: 'direct' });
    expect(direct.calls[0].toolId).toBe('mcp:auth/bit.info');
    expect(gateway.calls.length).toBe(0); // gateway bypassed
    expect(logger._calls.some((c: any) => c.obj?.action === 'fleet.break_glass')).toBe(true);
  });

  it('rejects --direct combined with --all', async () => {
    const t = new FakeTransport('gateway', [], () => ({}));
    const out: string[] = [];
    await expect(
      runFleet(parseFleetArgs(['fleet', 'info'], ['--direct=auth', '--all'], {}), {}, silentLogger(), deps(t, out, silentLogger())),
    ).rejects.toThrow(/cannot be combined with --all/);
  });
});

describe('brat fleet — fail-closed (OQ3)', () => {
  const ORIG = process.env.MCP_AUTH_TOKEN;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = ORIG;
  });

  it('refuses to run (PermissionError) when no token resolves', async () => {
    delete process.env.MCP_AUTH_TOKEN;
    const t = new FakeTransport('gateway', [], () => ({}));
    const out: string[] = [];
    // Do NOT inject resolveIdentityFn — exercise the real fail-closed path with an empty cwd.
    const noIdentityDeps: FleetDeps = {
      gatewayTransportFactory: () => t,
      registryFactory: () => registry,
      out: (l) => out.push(l),
    };
    const prevCwd = process.cwd();
    process.chdir('/');
    try {
      await expect(
        runFleet(parseFleetArgs(['fleet', 'info', 'auth'], [], {}), {}, silentLogger(), noIdentityDeps),
      ).rejects.toThrow(PermissionError);
    } finally {
      process.chdir(prevCwd);
    }
    expect(t.calls.length).toBe(0);
  });
});

describe('brat fleet — help', () => {
  it('prints the command surface for no subcommand', async () => {
    const out: string[] = [];
    const t = new FakeTransport('gateway', [], () => ({}));
    const res = await runFleet(parseFleetArgs(['fleet'], [], {}), {}, silentLogger(), deps(t, out, silentLogger()));
    expect(res).toEqual({ help: true });
    expect(out.join('\n')).toMatch(/brat fleet/);
  });
});
