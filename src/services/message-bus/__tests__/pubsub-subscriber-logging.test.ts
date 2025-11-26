import { jest } from '@jest/globals';

// Mock @google-cloud/pubsub so we can trigger on('message') manually
let __handlers: Record<string, Function> = {};
let lastSubscriptionOptions: any = null;
let lastSubscriptionName: string | null = null;

jest.mock('@google-cloud/pubsub', () => {
  __handlers = {};
  lastSubscriptionOptions = null;
  lastSubscriptionName = null;
  class MockSubscription {
    on = jest.fn((event: string, cb: Function) => {
      __handlers[event] = cb;
      return this;
    });
    removeListener = jest.fn();
    async close() {/* noop */}
  }
  return {
    PubSub: class {
      subscription(name: string, opts: any) {
        lastSubscriptionName = name;
        lastSubscriptionOptions = opts;
        return new MockSubscription();
      }
    },
    // expose for tests
    __getHandlers: () => __handlers,
    __getLastSubName: () => lastSubscriptionName,
    __getLastSubOpts: () => lastSubscriptionOptions,
  };
});

// Reduce noise from console in test output
const dbg = jest.spyOn(console, 'debug').mockImplementation(() => {});
const err = jest.spyOn(console, 'error').mockImplementation(() => {});

function getLogs(spy: any): string[] {
  return spy.mock.calls.map((c: any[]) => String(c[0]));
}

function containsLog(spy: any, needle: string): boolean {
  return getLogs(spy).some((s: string) => s.includes(needle));
}

describe('PubSubSubscriber logging', () => {
  beforeEach(async () => {
    jest.resetModules();
    dbg.mockClear();
    err.mockClear();
    // set logger to debug so debug logs are emitted
    const logging = await import('../../../common/logging');
    logging.logger.setLevel('debug');
  });

  it('logs receive, process.ok, and ack on successful handler', async () => {
    const { PubSubSubscriber } = await import('../pubsub-driver');
    const sub = new PubSubSubscriber();
    const unsub = await sub.subscribe('topic.test', async () => {
      // success
    }, { ack: 'auto' });

    // trigger message
    const m = {
      id: 'm1',
      data: Buffer.from('{"x":1}'),
      attributes: { a: 'b' },
      ack: jest.fn(),
      nack: jest.fn(),
    };
    const mocked = jest.requireMock('@google-cloud/pubsub') as any;
    const handlers = mocked.__getHandlers();
    await handlers['message'](m);

    expect(containsLog(dbg, 'message_consumer.receive')).toBe(true);
    expect(containsLog(dbg, 'message_consumer.process.ok')).toBe(true);
    expect(containsLog(dbg, 'message_consumer.ack')).toBe(true);

    await unsub();
  });

  it('logs receive, process.error, and nack on failing handler', async () => {
    const { PubSubSubscriber } = await import('../pubsub-driver');
    const sub = new PubSubSubscriber();
    const unsub = await sub.subscribe('topic.test', async () => {
      throw new Error('boom');
    }, { ack: 'auto' });

    const m = {
      id: 'm2',
      data: Buffer.from('{"x":2}'),
      attributes: { a: 'b' },
      ack: jest.fn(),
      nack: jest.fn(),
    };
    const mocked = jest.requireMock('@google-cloud/pubsub') as any;
    const handlers = mocked.__getHandlers();
    await handlers['message'](m);

    expect(containsLog(dbg, 'message_consumer.receive')).toBe(true);
    expect(containsLog(err, 'message_consumer.process.error')).toBe(true);
    expect(containsLog(dbg, 'message_consumer.nack')).toBe(true);

    await unsub();
  });
});
