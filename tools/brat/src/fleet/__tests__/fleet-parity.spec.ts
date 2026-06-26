import { FleetClient } from '../fleet-client';
import { DirectTransport } from '../transports/direct-transport';
import { FleetIdentity, FleetTool, FleetTransport, RegistryReader } from '../types';

/**
 * BL2-401 — deployment-target parity (TA §8 / §9).
 *
 * The synchronous MCP call path must behave identically regardless of the messaging backend
 * (PubSub on GCP vs NATS on Local/Remote Docker) — the bus is OFF the fleet call path. Discovery
 * resolves each Bit's external URL from the registry self-published value (Cloud Run URL /
 * compose-network host / ssh://-resolved host), so no target-specific host is baked in.
 */

const IDENTITY: FleetIdentity = { token: 't', roles: ['bit:read'], agentName: 'brat' };

function fakeTransport(tools: FleetTool[]): FleetTransport {
  return {
    label: 'gateway',
    listTools: async () => tools,
    callTool: async (id: string) => ({ id, ok: true }),
    close: async () => {},
  };
}

const registry: RegistryReader = {
  listServers: async () => [
    { name: 'auth', profile: 'core', exposure: 'platform-only' },
    { name: 'persistence', profile: 'core', exposure: 'platform-only' },
  ],
};

describe('Fleet deployment-target parity', () => {
  const ORIG = process.env.MESSAGE_BUS_DRIVER;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.MESSAGE_BUS_DRIVER;
    else process.env.MESSAGE_BUS_DRIVER = ORIG;
  });

  it('produces identical discovery + invocation results under MESSAGE_BUS_DRIVER=pubsub and =nats', async () => {
    const tools: FleetTool[] = [{ id: 'mcp:auth/bit.health' }, { id: 'mcp:persistence/bit.health' }];

    const run = async (driver: string) => {
      process.env.MESSAGE_BUS_DRIVER = driver;
      const client = new FleetClient({ transport: fakeTransport(tools), identity: IDENTITY, registry });
      const bits = (await client.discover()).map((b) => b.name);
      const all = (await client.callAll('bit.health')).map((r) => ({ bit: r.bit, ok: r.ok }));
      return { bits, all };
    };

    const pubsub = await run('pubsub');
    const nats = await run('nats');
    expect(pubsub).toEqual(nats);
    expect(pubsub.bits).toEqual(['auth', 'persistence']);
  });

  it('resolves each Bit URL from the registry-published value (no baked-in host) across target shapes', async () => {
    // Cloud Run, compose-network, and ssh-resolved hosts are all just registry-published URLs.
    const urls: Record<string, string> = {
      authGcp: 'https://auth-xyz-uc.a.run.app/sse', // Cloud Run
      authLocal: 'http://auth:3000/sse', // compose network
      authRemote: 'http://10.0.0.5:3000/sse', // ssh://-resolved host
    };

    for (const url of Object.values(urls)) {
      const seen: string[] = [];
      const reg: RegistryReader = { listServers: async () => [{ name: 'auth', url }] };
      const t = new DirectTransport({
        bit: 'auth',
        registry: reg,
        clientFactory: async (resolvedUrl) => {
          seen.push(resolvedUrl);
          return {
            connect: async () => {},
            listTools: async () => ({ tools: [] }),
            callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
            close: async () => {},
          };
        },
      });
      await t.callTool('mcp:auth/bit.health', {}, IDENTITY);
      expect(seen[0]).toBe(url); // connected to exactly the registry-published URL
    }
  });
});
