import { DiscordIngressClient } from './discord-ingress-client';
import { DiscordEnvelopeBuilder } from './envelope-builder';

describe('Discord – integration behavior (disabled mode and publish path)', () => {
  const realEnv = process.env.NODE_ENV;

  afterAll(() => {
    process.env.NODE_ENV = realEnv;
    jest.resetModules();
    jest.clearAllMocks();
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('IE-DIS-09: start() performs no network I/O when disabled (NODE_ENV=test) and reaches CONNECTED snapshot', async () => {
    process.env.NODE_ENV = 'test';

    // If the client ever tries to load discord.js in disabled mode, this mock will throw.
    jest.doMock('discord.js', () => {
      throw new Error('discord.js should not load in disabled mode');
    }, { virtual: true });

    const builder = new DiscordEnvelopeBuilder();
    const published: any[] = [];
    const publisher = { publish: async (evt: any) => { published.push(evt); } };

    const cfg: any = { discordEnabled: false };
    const client = new DiscordIngressClient(builder as any, publisher as any, cfg as any, {});

    await client.start();
    const snap = client.getSnapshot() as any;

    expect(snap.state).toBe('CONNECTED');
    expect(published.length).toBe(0);
  });

  it('IE-DIS-09: publishes normalized event to internal.ingress.v1 via mock publisher (no real network)', async () => {
    // Enable runtime path (not disabled) while keeping a full mock of discord.js
    process.env.NODE_ENV = 'development';

    // Minimal virtual mock for discord.js used by DiscordIngressClient.start()
    jest.doMock('discord.js', () => {
      let lastClient: any = null;
      class Client {
        listeners: Record<string, Function> = {};
        login = jest.fn(async (_token: string) => {});
        destroy = jest.fn(async () => {});
        constructor(_opts: any) { lastClient = this; }
        on(event: string, fn: Function) { this.listeners[event] = fn; }
        once(event: string, fn: Function) { this.listeners[event] = fn; }
        emit(event: string, ...args: any[]) { const fn = this.listeners[event]; if (fn) { fn(...args); } }
      }
      const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 4 };
      const Partials = { Channel: 1, Message: 2 };
      function __getLastClient() { return lastClient; }
      return { Client, GatewayIntentBits, Partials, __getLastClient };
    }, { virtual: true });

    const builder = new DiscordEnvelopeBuilder();
    const published: any[] = [];
    const publisher = { publish: async (evt: any) => { published.push(evt); } };

    const cfg: any = {
      discordEnabled: true,
      discordBotToken: 'x',
      discordGuildId: 'g1',
      discordChannels: ['c1'],
      busPrefix: 'test.',
    };
    const egressDest = 'internal.egress.v1.proc-xyz';
    const client = new DiscordIngressClient(builder as any, publisher as any, cfg as any, { egressDestinationTopic: egressDest });

    await client.start();

    // Retrieve mock client instance and emit a messageCreate that passes filters
    const DJ: any = require('discord.js');
    const mockClient = DJ.__getLastClient();
    expect(mockClient).toBeTruthy();

    const msg = {
      guild: { id: 'g1' },
      channel: { id: 'c1' },
      id: 'm1',
      content: 'Hello Discord',
      author: { id: 'a1', username: 'Alpha', bot: false },
      createdAt: Date.now(),
      mentions: { users: new Map([['u2', { id: 'u2' }]]) },
      member: { roles: { cache: new Map([['r1', {}]]) } },
    };

    mockClient.emit('messageCreate', msg);

    expect(published.length).toBe(1);
    const evt = published[0];
    expect(evt).toBeTruthy();
    expect(evt.source).toBe('ingress.discord');
    expect(evt.type).toBe('chat.message.v1');
    expect(evt.message?.text).toBe('Hello Discord');
    expect(evt.egress?.destination).toBe(egressDest);
    expect(evt.egress?.type).toBe('chat');
    // annotations include a custom entry with source=discord
    const hasDiscordAnno = Array.isArray(evt.annotations) && evt.annotations.some((a: any) => a?.source === 'discord' && a?.label === 'source');
    expect(hasDiscordAnno).toBe(true);
  });
});
