import request from 'supertest';

// Mock the message-bus so we can observe subscribe calls without real IO
const subscribeMock = jest.fn(async () => {
  return async () => {
    // noop unsubscribe
  };
});
const createMessageSubscriberMock = jest.fn(() => ({ subscribe: subscribeMock }));

jest.mock('../../services/message-bus', () => ({
  createMessageSubscriber: () => createMessageSubscriberMock(),
}));

describe('BaseServer helpers', () => {
  // Import after mocks
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BaseServer } = require('../base-server');

  beforeEach(() => {
    subscribeMock.mockClear();
    createMessageSubscriberMock.mockClear();
  });

  it('onHTTPRequest registers GET by default and supports config object with method', async () => {
    class TestServer extends BaseServer {
      constructor() {
        super({ serviceName: 'test' });
        this.onHTTPRequest('/ping', (_req: any, res: any) => res.status(200).json({ ok: true }));
        this.onHTTPRequest({ path: '/echo', method: 'POST' }, (_req: any, res: any) => res.status(204).end());
      }
    }
    const srv = new TestServer();
    const app = srv.getApp();
    await request(app).get('/ping').expect(200);
    await request(app).post('/echo').expect(204);
  });

  it('onMessage skips subscription while in test environment', async () => {
    class TestServer extends BaseServer {
      constructor() {
        super({ serviceName: 'test' });
      }
      async wire() {
        await this.onMessage('internal.test.v1', async () => {});
        await this.onMessage({ destination: 'internal.test2.v1', queue: 'q1', ack: 'explicit' }, async () => {});
      }
    }
    const srv = new TestServer();
    await srv['wire']();
    // Should not even construct subscriber in test mode
    expect(createMessageSubscriberMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it.skip('onMessage subscribes with prefix, queue, and ack when not in test env', async () => {
    // Save env and adjust to bypass skip conditions
    const prevEnv = { ...process.env } as any;
    try {
      delete process.env.JEST_WORKER_ID;
      process.env.NODE_ENV = 'development';
      process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE = '0';
      process.env.BUS_PREFIX = 'bp.';

      class TestServer extends BaseServer {
        constructor() {
          super({ serviceName: 'test' });
        }
        async wire() {
          await this.onMessage({ destination: 'foo', queue: 'qq', ack: 'explicit' }, async () => {});
        }
      }
      const srv = new TestServer();
      await srv['wire']();
      expect(createMessageSubscriberMock).toHaveBeenCalledTimes(1);
      expect(subscribeMock).toHaveBeenCalledTimes(1);
      const calls: any = (subscribeMock as any).mock.calls;
      const call: any = calls[0] || [];
      expect(call[0]).toBe('bp.foo'); // subject with prefix
      // third arg is options
      const opts: any = call[2];
      expect(opts).toBeDefined();
      expect(opts.queue).toBe('qq');
      expect(opts.ack).toBe('explicit');
    } finally {
      // Restore env
      process.env = prevEnv;
    }
  });
});
