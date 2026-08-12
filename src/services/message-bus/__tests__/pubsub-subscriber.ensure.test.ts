import { jest } from '@jest/globals';

// Simple EventEmitter stub for subscription
class SubEmitter {
  private handlers: Record<string, Function[]> = {};
  on(event: string, fn: Function) {
    this.handlers[event] = this.handlers[event] || [];
    this.handlers[event].push(fn);
  }
  removeListener(event: string, fn: Function) {
    this.handlers[event] = (this.handlers[event] || []).filter((f) => f !== fn);
  }
  async close() {
    // noop
  }
}

// Sprint 9: Fixed mock hoisting - jest.doMock() doesn't hoist, use jest.mock() instead
// Use module-scoped mock implementation that can be configured in tests
const mockImpl = {
  topic: jest.fn(),
  getSubscriptions: jest.fn(),
  subscription: jest.fn(),
};

jest.mock('@google-cloud/pubsub', () => ({
  PubSub: class {
    topic(...args: any[]) {
      return mockImpl.topic(...args);
    }
    getSubscriptions(...args: any[]) {
      return mockImpl.getSubscriptions(...args);
    }
    subscription(...args: any[]) {
      return mockImpl.subscription(...args);
    }
  },
}));

// Import after mock is defined
import { PubSubSubscriber } from '../pubsub-driver';

describe('PubSubSubscriber ensure subscription', () => {
  const topicName = 'internal.ingress.v1';
  const subName = `${topicName}.router`;

  beforeEach(() => {
    // Sprint 9: Don't use jest.resetModules() as it clears the hoisted mock
    // jest.resetModules();
    delete process.env.PUBSUB_ENSURE_DISABLE;
    // Reset mock call history for each test (use mockClear, not mockReset which removes implementation)
    mockImpl.topic.mockClear();
    mockImpl.getSubscriptions.mockClear();
    mockImpl.subscription.mockClear();
  });

  it('creates topic and subscription when missing', async () => {
    // Sprint 9: Force PubSub driver mode (not NATS) so ensure logic runs
    process.env.MESSAGE_BUS_DRIVER = 'pubsub';
    // Explicitly ensure PUBSUB_ENSURE_DISABLE is NOT set
    delete process.env.PUBSUB_ENSURE_DISABLE;

    const createSubscription = jest.fn(async () => [{}]);
    const get = jest.fn(async () => [{}]);

    // Configure mocks for this test
    mockImpl.topic.mockReturnValue({ get, createSubscription });
    (mockImpl.getSubscriptions as any).mockResolvedValue([[]]);
    mockImpl.subscription.mockReturnValue(new SubEmitter());

    const sub = new PubSubSubscriber();

    const handler = jest.fn(async () => {});
    await sub.subscribe(topicName, handler, { queue: 'router', ack: 'auto', maxInFlight: 5 });

    // Ensured topic and subscription
    expect(mockImpl.topic).toHaveBeenCalledWith(topicName);
    expect(get).toHaveBeenCalledWith({ autoCreate: true });
    expect(createSubscription).toHaveBeenCalledWith(subName, expect.objectContaining({ ackDeadlineSeconds: expect.any(Number) }));

    // Flow control applied
    expect(mockImpl.subscription).toHaveBeenCalledWith(subName, expect.objectContaining({ flowControl: expect.any(Object) }));
  });

  it('skips ensure when PUBSUB_ENSURE_DISABLE=1', async () => {
    process.env.PUBSUB_ENSURE_DISABLE = '1';

    const createSubscription = jest.fn();
    const get = jest.fn();

    // Configure mocks for this test
    mockImpl.topic.mockReturnValue({ get, createSubscription });
    (mockImpl.getSubscriptions as any).mockResolvedValue([[]]);
    mockImpl.subscription.mockReturnValue(new SubEmitter());

    const sub = new PubSubSubscriber();

    const handler = jest.fn(async () => {});
    await sub.subscribe(topicName, handler, { queue: 'router' });

    expect(createSubscription).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    // But subscription still created for listening
    expect(mockImpl.subscription).toHaveBeenCalledWith(subName, expect.any(Object));
  });
});
