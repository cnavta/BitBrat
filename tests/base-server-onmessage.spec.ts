// Verify that BaseServer.onMessage parses JSON and delivers typed data to handler

// Mock the message-bus to capture the subscribed handler and invoke it manually
const subscribeMock = jest.fn(async (_subject: string, handler: any, _opts?: any) => {
  ;(global as any).__capturedHandler = handler;
  return async () => {};
});
const createMessageSubscriberMock = jest.fn(() => ({ subscribe: subscribeMock }));

jest.mock('../src/services/message-bus', () => ({
  createMessageSubscriber: () => createMessageSubscriberMock(),
}));

describe('BaseServer.onMessage<T>() JSON parsing', () => {
  // Import after mocks
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BaseServer } = require('../src/common/base-server');

  class TestServer extends BaseServer {
    constructor() { super({ serviceName: 'test' }); }
    async wire(handler: (d: any, a: any, c: any) => Promise<void> | void) {
      await this.onMessage('internal.test.json', handler);
    }
  }

  beforeEach(() => {
    subscribeMock.mockClear();
    createMessageSubscriberMock.mockClear();
    delete (global as any).__capturedHandler;
    delete process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE;
  });

  test('delivers parsed object to typed handler', async () => {
    const srv = new TestServer();
    let received: any = null;
    await srv['wire'](async (data: any) => {
      received = data;
    });
    const handler = (global as any).__capturedHandler;
    expect(typeof handler).toBe('function');
    const payload = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8');
    const ctx = { ack: async () => {}, nack: async () => {} };
    await handler(payload, {}, ctx);
    expect(received).toEqual({ foo: 'bar' });
  });
});
