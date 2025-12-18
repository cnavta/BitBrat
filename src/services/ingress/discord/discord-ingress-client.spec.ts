import { DiscordIngressClient } from './discord-ingress-client';
import { DiscordEnvelopeBuilder } from './envelope-builder';
import type { IngressPublisher } from '../core';
import type { IConfig } from '../../../types';

// Mock discord.js to avoid any network I/O and to expose helpers for emitting events
let handlers: Record<string, Array<(...args: any[]) => any>> = {};
let lastClient: any = null;

jest.mock('discord.js', () => {
  handlers = {};
  lastClient = null;
  class MockClient {
    on(event: string, fn: (...args: any[]) => any) {
      (handlers[event] ||= []).push(fn);
      return this;
    }
    once(event: string, fn: (...args: any[]) => any) {
      (handlers[event] ||= []).push(fn);
      return this;
    }
    async login(_token: string) {
      // no-op
    }
    async destroy() {
      // no-op
    }
    constructor() {
      lastClient = this;
    }
  }
  const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 4 } as const;
  const Partials = { Channel: 1, Message: 2 } as const;
  return {
    Client: MockClient,
    GatewayIntentBits,
    Partials,
    __mock: {
      emit: (event: string, ...args: any[]) => {
        (handlers[event] || []).forEach((fn) => fn(...args));
      },
      reset: () => {
        handlers = {};
        lastClient = null;
      },
      getHandlers: () => handlers,
      getLastClient: () => lastClient,
    },
  };
}, { virtual: true });

describe('DiscordIngressClient filters', () => {
  const builder = new DiscordEnvelopeBuilder();
  let published: any[];
  let publisher: IngressPublisher;
  let cfg: IConfig;
  const prevEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    published = [];
    publisher = { publish: async (evt: any) => { published.push(evt); } } as IngressPublisher;
    cfg = {
      port: 0,
      logLevel: 'debug',
      twitchScopes: [],
      twitchChannels: [],
      discordEnabled: true,
      discordBotToken: 'token',
      discordGuildId: 'g1',
      discordChannels: ['c1'],
    } as unknown as IConfig;
  });

  afterAll(() => {
    process.env.NODE_ENV = prevEnv;
  });

  function mockMessage(overrides: Partial<any> = {}) {
    return {
      id: 'm1',
      guild: { id: 'g1' },
      channel: { id: 'c1' },
      content: 'hi',
      author: { id: 'u1', username: 'Bob', bot: false },
      createdAt: Date.now(),
      mentions: { users: new Map<string, string>() },
      member: { roles: { cache: new Map<string, string>() } },
      ...overrides,
    };
  }

  it('publishes for allowed guild/channel and non-bot user', async () => {
    const client = new DiscordIngressClient(builder as any, publisher, cfg, { egressDestinationTopic: 'internal.egress.v1.test' });
    await client.start();
    const mod: any = require('discord.js');
    mod.__mock.emit('messageCreate', mockMessage());
    expect(published.length).toBe(1);
    expect(published[0].source).toBe('ingress.discord');
    expect(published[0].message.text).toBe('hi');
    expect(published[0].egressDestination).toBe('internal.egress.v1.test');
  });

  it('ignores messages from other guilds', async () => {
    const client = new DiscordIngressClient(builder as any, publisher, cfg);
    await client.start();
    const mod: any = require('discord.js');
    mod.__mock.emit('messageCreate', mockMessage({ guild: { id: 'other' } }));
    expect(published.length).toBe(0);
  });

  it('ignores messages from non-allowlisted channels', async () => {
    const client = new DiscordIngressClient(builder as any, publisher, cfg);
    await client.start();
    const mod: any = require('discord.js');
    mod.__mock.emit('messageCreate', mockMessage({ channel: { id: 'zzz' } }));
    expect(published.length).toBe(0);
  });

  it('ignores bot messages and non-text content', async () => {
    const client = new DiscordIngressClient(builder as any, publisher, cfg);
    await client.start();
    const mod: any = require('discord.js');
    mod.__mock.emit('messageCreate', mockMessage({ author: { id: 'u1', username: 'Bot', bot: true } }));
    mod.__mock.emit('messageCreate', mockMessage({ content: undefined }));
    mod.__mock.emit('messageCreate', mockMessage({ content: 123 as any }));
    expect(published.length).toBe(0);
  });
});
