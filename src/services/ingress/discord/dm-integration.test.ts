import { DiscordIngressClient } from './discord-ingress-client';
import { buildDiscordEnvelope } from './envelope-builder';
import { ChannelType } from 'discord.js';

describe('Discord DM Integration (DM-009)', () => {
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

  describe('DM Ingress: Receive DM and normalize to dm.message.v1', () => {
    it('should detect DM via channel.type === ChannelType.DM and publish as dm.message.v1', async () => {
      process.env.NODE_ENV = 'development';

      // Mock discord.js
      jest.doMock('discord.js', () => {
        let lastClient: any = null;
        class Client {
          listeners: Record<string, Function[]> = {};
          users = {
            fetch: jest.fn(async (userId: string) => ({
              id: userId,
              username: 'testuser',
              createDM: jest.fn(async () => ({
                id: 'dm-channel-123',
                send: jest.fn(async (msg: string) => ({ content: msg })),
              })),
            })),
          };
          login = jest.fn(async (_token: string) => {});
          destroy = jest.fn(async () => {});
          constructor(_opts: any) { lastClient = this; }
          on(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
          once(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
          emit(event: string, ...args: any[]) {
            const fns = this.listeners[event];
            if (fns) {
              fns.forEach(fn => fn(...args));
            }
          }
        }
        const GatewayIntentBits = {
          Guilds: 1,
          GuildMessages: 2,
          MessageContent: 4,
          DirectMessages: 8,
        };
        const Partials = { Channel: 1, Message: 2 };
        const ChannelType = { DM: 1, GUILD_TEXT: 0 };
        function __getLastClient() { return lastClient; }
        return { Client, GatewayIntentBits, Partials, ChannelType, __getLastClient };
      }, { virtual: true });

      const published: any[] = [];
      const publisher = { publish: async (evt: any) => { published.push(evt); } };

      const cfg: any = {
        discordEnabled: true,
        discordBotToken: 'test-token',
        discordGuildId: 'g1',
        discordChannels: ['c1'],
        busPrefix: 'test.',
      };
      const egressDest = 'internal.egress.v1.proc-xyz';
      const client = new DiscordIngressClient(
        buildDiscordEnvelope,
        publisher as any,
        cfg as any,
        { egressDestinationTopic: egressDest }
      );

      await client.start();

      // Get mock client and emit a DM message
      const DJ: any = require('discord.js');
      const mockClient = DJ.__getLastClient();
      expect(mockClient).toBeTruthy();

      const dmMessage = {
        guild: null,  // DMs don't have guilds
        channel: {
          id: 'dm-channel-987',
          type: 1,  // ChannelType.DM
        },
        id: 'msg-dm-123',
        content: 'Hello! This is a DM.',
        author: {
          id: 'user-111',
          username: 'testuser',
          globalName: 'Test User',
          bot: false,
        },
        createdAt: Date.now(),
        mentions: { users: new Map() },
        member: null,  // No member object in DMs
      };

      mockClient.emit('messageCreate', dmMessage);

      // Verify event was published as dm.message.v1
      expect(published.length).toBe(1);
      const evt = published[0];
      expect(evt).toBeTruthy();
      expect(evt.ingress.source).toBe('ingress.discord');
      expect(evt.type).toBe('dm.message.v1');  // Should be DM, not chat
      expect(evt.message?.text).toBe('Hello! This is a DM.');
      expect(evt.identity?.external?.id).toBe('user-111');
      expect(evt.identity?.external?.displayName).toMatch(/testuser|Test User/);
      expect(evt.egress?.destination).toBe(egressDest);
      expect(evt.egress?.type).toBe('dm');

      await client.stop();
    });

    it('should not publish bot DMs (author.bot === true)', async () => {
      process.env.NODE_ENV = 'development';

      jest.doMock('discord.js', () => {
        let lastClient: any = null;
        class Client {
          listeners: Record<string, Function[]> = {};
          login = jest.fn(async () => {});
          destroy = jest.fn(async () => {});
          constructor(_opts: any) { lastClient = this; }
          on(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
          once(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
          emit(event: string, ...args: any[]) {
            const fns = this.listeners[event];
            if (fns) fns.forEach(fn => fn(...args));
          }
        }
        const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 };
        const Partials = { Channel: 1, Message: 2 };
        const ChannelType = { DM: 1, GUILD_TEXT: 0 };
        function __getLastClient() { return lastClient; }
        return { Client, GatewayIntentBits, Partials, ChannelType, __getLastClient };
      }, { virtual: true });

      const published: any[] = [];
      const publisher = { publish: async (evt: any) => { published.push(evt); } };

      const cfg: any = {
        discordEnabled: true,
        discordBotToken: 'test-token',
        discordGuildId: 'g1',
        discordChannels: ['c1'],
      };
      const client = new DiscordIngressClient(
        buildDiscordEnvelope,
        publisher as any,
        cfg as any,
        {}
      );

      await client.start();

      const DJ: any = require('discord.js');
      const mockClient = DJ.__getLastClient();

      const botDM = {
        guild: null,
        channel: { id: 'dm-999', type: 1 },
        id: 'msg-bot-dm',
        content: 'Bot message',
        author: {
          id: 'bot-222',
          username: 'botuser',
          bot: true,  // Bot message should be filtered
        },
        createdAt: Date.now(),
        mentions: { users: new Map() },
        member: null,
      };

      mockClient.emit('messageCreate', botDM);

      // Should not publish bot messages
      expect(published.length).toBe(0);

      await client.stop();
    });
  });

  describe('DM Egress: Send DM via sendDM()', () => {
    it('should send DM by fetching user and creating DM channel', async () => {
      process.env.NODE_ENV = 'development';

      jest.doMock('discord.js', () => {
        const mockUser = {
          id: 'user-123',
          username: 'testuser',
          createDM: jest.fn(async () => ({
            id: 'dm-channel-new',
            send: jest.fn(async (content: string) => ({ id: 'sent-msg', content })),
          })),
        };

        let lastClient: any = null;
        class Client {
          listeners: Record<string, Function[]> = {};
          users = {
            fetch: jest.fn(async (userId: string) => {
              if (userId === 'user-123') return mockUser;
              throw new Error('User not found');
            }),
          };
          login = jest.fn(async () => {
            // Emit ready event after login to set state to CONNECTED
            setImmediate(() => {
              const fns = this.listeners['ready'];
              if (fns) fns.forEach(fn => fn());
            });
          });
          destroy = jest.fn(async () => {});
          constructor(_opts: any) { lastClient = this; }
          on(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
          once(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
        }
        const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 };
        const Partials = { Channel: 1, Message: 2 };
        const ChannelType = { DM: 1 };
        function __getLastClient() { return lastClient; }
        function __getMockUser() { return mockUser; }
        return { Client, GatewayIntentBits, Partials, ChannelType, __getLastClient, __getMockUser };
      }, { virtual: true });

      const published: any[] = [];
      const publisher = { publish: async (evt: any) => { published.push(evt); } };

      const cfg: any = {
        discordEnabled: true,
        discordBotToken: 'test-token',
        discordGuildId: 'g1',
        discordChannels: ['c1'],  // Required for client validation
      };
      const client = new DiscordIngressClient(
        buildDiscordEnvelope,
        publisher as any,
        cfg as any,
        {}
      );

      await client.start();

      // Wait for ready event to be processed
      await new Promise(resolve => setImmediate(resolve));

      // Send DM
      await client.sendDM('Test DM content', 'user-123');

      // Verify interactions
      const DJ: any = require('discord.js');
      const mockClient = DJ.__getLastClient();
      const mockUser = DJ.__getMockUser();

      expect(mockClient.users.fetch).toHaveBeenCalledWith('user-123');
      expect(mockUser.createDM).toHaveBeenCalled();

      await client.stop();
    });

    it('should handle user not found error gracefully', async () => {
      process.env.NODE_ENV = 'development';

      jest.doMock('discord.js', () => {
        let lastClient: any = null;
        class Client {
          listeners: Record<string, Function[]> = {};
          users = {
            fetch: jest.fn(async (userId: string) => {
              throw new Error('Unknown User');
            }),
          };
          login = jest.fn(async () => {
            // Emit ready event after login to set state to CONNECTED
            setImmediate(() => {
              const fns = this.listeners['ready'];
              if (fns) fns.forEach(fn => fn());
            });
          });
          destroy = jest.fn(async () => {});
          constructor(_opts: any) { lastClient = this; }
          on(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
          once(event: string, fn: Function) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
          }
        }
        const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 4 };
        const Partials = { Channel: 1, Message: 2 };
        const ChannelType = { DM: 1 };
        function __getLastClient() { return lastClient; }
        return { Client, GatewayIntentBits, Partials, ChannelType, __getLastClient };
      }, { virtual: true });

      const published: any[] = [];
      const publisher = { publish: async (evt: any) => { published.push(evt); } };

      const cfg: any = {
        discordEnabled: true,
        discordBotToken: 'test-token',
        discordGuildId: 'g1',
        discordChannels: ['c1'],  // Required for client validation
      };
      const client = new DiscordIngressClient(
        buildDiscordEnvelope,
        publisher as any,
        cfg as any,
        {}
      );

      await client.start();

      // Wait for ready event to be processed
      await new Promise(resolve => setImmediate(resolve));

      // Attempt to send DM to non-existent user
      await expect(client.sendDM('Test', 'invalid-user')).rejects.toThrow('Unknown User');

      await client.stop();
    });
  });
});
