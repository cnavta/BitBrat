import { TwilioSmsIngressClient } from './twilio-sms-ingress-client';
import { SmsEnvelopeBuilder } from './envelope-builder';
import type { IngressPublisher } from '../core';
import type { IConfig } from '../../../types';

// Mock @twilio/conversations
let mockConversationsHandlers: Record<string, Array<(...args: any[]) => any>> = {};

jest.mock('@twilio/conversations', () => ({
  Client: class {
    on(event: string, fn: (...args: any[]) => any) {
      (mockConversationsHandlers[event] ||= []).push(fn);
      return this;
    }
    async updateToken(_token: string) { return this; }
    async shutdown() {}
  }
}));

// Mock twilio
const mockConversationsMessagesCreate = jest.fn();
jest.mock('twilio', () => {
  const actual = jest.requireActual('twilio');
  class mockTwilio {
    conversations = {
      v1: {
        conversations: (_sid: string) => ({
          messages: {
            create: mockConversationsMessagesCreate
          }
        })
      }
    };
  }
  return {
    ...actual,
    Twilio: mockTwilio,
    jwt: actual.jwt
  };
});

describe('TwilioSmsIngressClient', () => {
  const builder = new SmsEnvelopeBuilder();
  let published: any[];
  let publisher: IngressPublisher;
  let cfg: IConfig;
  let client: TwilioSmsIngressClient | null = null;
  const prevEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    mockConversationsHandlers = {};
    published = [];
    publisher = { publish: async (evt: any) => { published.push(evt); } } as IngressPublisher;
    cfg = {
      port: 0,
      logLevel: 'debug',
      twilioEnabled: true,
      twilioAccountSid: 'AC' + 'a'.repeat(32), // Needs to look somewhat valid for the real jwt helper
      twilioAuthToken: 'token',
      twilioApiKey: 'SK' + 'k'.repeat(32),
      twilioApiSecret: 's'.repeat(32),
      twilioConversationsServiceSid: 'IS' + 's'.repeat(32),
      twilioIdentity: 'Bot'
    } as unknown as IConfig;
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if (client) {
      await client.stop();
      client = null;
    }
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env.NODE_ENV = prevEnv;
  });

  function emitConversations(event: string, ...args: any[]) {
    (mockConversationsHandlers[event] || []).forEach(fn => fn(...args));
  }

  it('starts and listens for messages', async () => {
    client = new TwilioSmsIngressClient(builder, publisher, cfg);
    await client.start();
    
    emitConversations('messageAdded', {
      sid: 'IM1',
      author: '+123',
      body: 'hello',
      dateCreated: new Date(),
      attributes: {},
      conversation: { sid: 'CH1' }
    });

    expect(published.length).toBe(1);
    expect(published[0].source).toBe('ingress.twilio.sms');
    expect(published[0].message.text).toBe('hello');
  });

  it('ignores messages from itself', async () => {
    client = new TwilioSmsIngressClient(builder, publisher, cfg);
    await client.start();
    
    emitConversations('messageAdded', {
      sid: 'IM2',
      author: 'Bot',
      body: 'echo hello',
      dateCreated: new Date(),
      attributes: {},
      conversation: { sid: 'CH1' }
    });

    expect(published.length).toBe(0);
  });

  it('sends text via REST API', async () => {
    client = new TwilioSmsIngressClient(builder, publisher, cfg);
    await client.start();
    
    mockConversationsMessagesCreate.mockResolvedValue({ sid: 'IM3' });
    await client.sendText('reply', 'CH1');

    expect(mockConversationsMessagesCreate).toHaveBeenCalledWith({
      body: 'reply',
      author: 'Bot'
    });
  });

  it('provides a snapshot of its state', async () => {
    client = new TwilioSmsIngressClient(builder, publisher, cfg);
    expect(client.getSnapshot().state).toBe('DISCONNECTED');
    
    await client.start();
    emitConversations('connectionStateChanged', 'connected');
    
    expect(client.getSnapshot().state).toBe('CONNECTED');
  });
});
