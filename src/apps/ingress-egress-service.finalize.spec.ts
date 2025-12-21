import { BaseServer } from '../common/base-server';

// Minimal publisher mock shape
function makePublisherMock() {
  return { publishJson: jest.fn(async () => 'mid-1'), flush: jest.fn(async () => {}) } as any;
}

describe('ingress-egress finalize publish', () => {
  const handlers: { destination: string; handler: (msg: any, attr: any, ctx: any) => Promise<void> }[] = [];
  const finalizePublishes: any[] = [];

  beforeAll(() => {
    // Ensure service does not skip subscription logic (treat as non-test runtime)
    delete (process as any).env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'development';
    delete (process as any).env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
    // Capture onMessage registration of egress handler
    jest.spyOn(BaseServer.prototype as any, 'onMessage').mockImplementation(async (opts: any, handler: any) => {
      const destination = opts?.destination || opts?.subject || 'unknown';
      handlers.push({ destination, handler });
      return () => {};
    });

    // Mock TwitchEventSubClient to avoid starting it during finalize tests
    jest.mock('../services/ingress/twitch', () => ({
      ...jest.requireActual('../services/ingress/twitch'),
      TwitchEventSubClient: jest.fn().mockImplementation(() => ({
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        getSnapshot: jest.fn().mockReturnValue({ active: false, subscriptions: 0 })
      }))
    }));

    // Mock publisher resource to capture finalize publish calls
    jest.spyOn(BaseServer.prototype as any, 'getResource').mockImplementation((...args: any[]) => {
      const key = args[0] as string;
      if (key === 'publisher') {
        return {
          create: (_subject: string) => {
            const pub = makePublisherMock();
            const original = pub.publishJson;
            pub.publishJson = jest.fn(async (payload: any, _attrs: any) => {
              finalizePublishes.push({ payload });
              return original(payload, _attrs);
            });
            return pub;
          },
          flushAll: async () => {},
        } as any;
      }
      return undefined;
    });
    // Import app to register handlers
    const mod = require('./ingress-egress-service');
    if (typeof mod.createApp === 'function') mod.createApp();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('publishes internal.persistence.finalize.v1 with status SENT after successful send', async () => {
    const h = handlers.find((x) => String(x.destination || '').startsWith('internal.egress.v1.'));
    expect(h).toBeTruthy();
    // Patch twitchClient.sendText to no-op success
    // Access private via prototype chain: swap sendText on the server instance by mocking method on TwitchIrcClient prototype if needed
    // For our test route we simulate via event delivering and the handler will call mocked publisher
    const ack = jest.fn(async () => {});
    const ctx = { ack };
    const evt = {
      correlationId: 'fx-1',
      annotations: [{ id: 'a1', kind: 'intent', source: 'unit', createdAt: new Date().toISOString(), label: 'greeting' }],
      candidates: [
        { id: 'c1', kind: 'text', source: 't', createdAt: new Date().toISOString(), status: 'proposed', priority: 1, text: 'hello' },
        { id: 'c2', kind: 'text', source: 't', createdAt: new Date().toISOString(), status: 'proposed', priority: 2, text: 'alt' },
      ],
    };
    // Also stub send operation by monkey-patching the server instance method through prototype
    // Temporarily override TwitchIrcClient.prototype.sendText to resolve
    const twitch = require('../services/ingress/twitch');
    const originalSend = twitch.TwitchIrcClient.prototype.sendText;
    twitch.TwitchIrcClient.prototype.sendText = jest.fn(async () => {});
    try {
      await h!.handler(evt, {}, ctx);
    } finally {
      twitch.TwitchIrcClient.prototype.sendText = originalSend;
    }
    expect(ack).toHaveBeenCalled();
    const last = finalizePublishes[finalizePublishes.length - 1]?.payload;
    expect(last).toBeTruthy();
    expect(last.correlationId).toBe('fx-1');
    expect(last.status).toBe('SENT');
    // Finalize payload should include candidates with one marked selected and annotations
    expect(Array.isArray(last.candidates)).toBe(true);
    const selected = last.candidates.find((c: any) => c.status === 'selected');
    expect(selected).toBeTruthy();
    expect(Array.isArray(last.annotations)).toBe(true);
    expect(last.annotations[0]?.id).toBe('a1');
  });
});
