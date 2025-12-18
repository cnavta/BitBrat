import { DiscordIngressClient } from './discord-ingress-client';
import { DiscordEnvelopeBuilder } from './envelope-builder';

jest.mock('../../../common/logging', () => {
  const info = jest.fn();
  const debug = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  return { logger: { info, debug, warn, error } };
});

// Minimal virtual mock for discord.js used by DiscordIngressClient
jest.mock('discord.js', () => {
  class MockClient {
    private events: Record<string, Function> = {};
    once(name: string, fn: any) { this.events[`once:${name}`] = fn; }
    on(name: string, fn: any) { this.events[name] = fn; }
    async login(_token: string) { const ready = this.events['once:ready']; if (ready) ready(); }
    async destroy() { /* no-op */ }
    emit(name: string, payload: any) { const fn = this.events[name]; if (fn) return fn(payload); }
  }
  return {
    Client: MockClient,
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 },
    Partials: { Channel: 'Channel', Message: 'Message' },
  };
}, { virtual: true });

describe('Discord observability logging', () => {
  const { logger } = require('../../../common/logging');
  const ORIG_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    logger.info.mockReset();
    logger.debug.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIG_ENV;
  });

  it('logs disabled mode without secrets', async () => {
    process.env.NODE_ENV = 'test'; // ensures disabled path
    const cfg: any = { discordEnabled: false };
    const builder = new DiscordEnvelopeBuilder();
    const publisher = { publish: jest.fn() };
    const client = new DiscordIngressClient(builder, publisher as any, cfg);
    await client.start();
    expect(logger.debug).toHaveBeenCalledWith('ingress-egress.discord.disabled');
    // ensure no token logs by scanning calls for typical token substring
    const args = [...logger.info.mock.calls, ...logger.debug.mock.calls, ...logger.error.mock.calls].flat().join(' ');
    expect(args).not.toMatch(/token/i);
  });

  it('logs publish path with expected namespace', async () => {
    process.env.NODE_ENV = 'development';
    const cfg: any = { discordEnabled: true, discordBotToken: 'x.y.z', discordGuildId: 'g1', discordChannels: ['c1'] };
    const builder = new DiscordEnvelopeBuilder();
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const client = new DiscordIngressClient(builder as any, publisher as any, cfg, { egressDestinationTopic: 'internal.egress.v1.test' });
    await client.start();
    // emit a valid message
    const { Client } = require('discord.js');
    const mock = (client as any).client as InstanceType<typeof Client> | any;
    // If client.start() created a Client, it should be attached internally
    expect(mock).toBeTruthy();
    const message = {
      guild: { id: 'g1' },
      channel: { id: 'c1' },
      id: 'm1',
      content: 'hello',
      author: { id: 'u1', username: 'user', bot: false },
      mentions: { users: new Map() },
      member: { roles: { cache: new Map() } },
    };
    // Use the mock client to emit messageCreate
    (mock as any).emit('messageCreate', message);
    // allow async handler to complete
    await new Promise((r) => setTimeout(r, 0));
    expect(publisher.publish).toHaveBeenCalled();
    // Look for our observability log
    const infoCalls = logger.info.mock.calls.map((c: any[]) => c[0]);
    expect(infoCalls).toContain('ingress-egress.discord.message.published');
    // Ensure token string did not leak
    const combined = [...logger.info.mock.calls, ...logger.debug.mock.calls, ...logger.error.mock.calls].flat().join(' ');
    expect(combined).not.toContain('x.y.z');
  });
});
