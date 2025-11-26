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

describe('PubSubSubscriber ensure subscription', () => {
  const topicName = 'internal.ingress.v1';
  const subName = `${topicName}.router`;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.PUBSUB_ENSURE_DISABLE;
  });

  it('creates topic and subscription when missing', async () => {
    const createSubscription = jest.fn(async () => [{}]);
    const get = jest.fn(async () => [{}]);
    const topic = jest.fn(() => ({ get, createSubscription }));
    const getSubscriptions = jest.fn(async () => [[]]);
    const subscription = jest.fn(() => new SubEmitter());

    jest.doMock('@google-cloud/pubsub', () => ({
      PubSub: class {
        topic = topic as any;
        getSubscriptions = getSubscriptions as any;
        subscription = subscription as any;
      },
    }));

    const { PubSubSubscriber } = await import('../pubsub-driver');
    const sub = new PubSubSubscriber();

    const handler = jest.fn(async () => {});
    await sub.subscribe(topicName, handler, { queue: 'router', ack: 'auto', maxInFlight: 5 });

    // Ensured topic and subscription
    expect(topic).toHaveBeenCalledWith(topicName);
    expect(get).toHaveBeenCalledWith({ autoCreate: true });
    expect(createSubscription).toHaveBeenCalledWith(subName, expect.objectContaining({ ackDeadlineSeconds: expect.any(Number) }));

    // Flow control applied
    expect(subscription).toHaveBeenCalledWith(subName, expect.objectContaining({ flowControl: expect.any(Object) }));
  });

  it('skips ensure when PUBSUB_ENSURE_DISABLE=1', async () => {
    process.env.PUBSUB_ENSURE_DISABLE = '1';

    const createSubscription = jest.fn();
    const get = jest.fn();
    const topic = jest.fn(() => ({ get, createSubscription }));
    const getSubscriptions = jest.fn(async () => [[]]);
    const subscription = jest.fn(() => new SubEmitter());

    jest.doMock('@google-cloud/pubsub', () => ({
      PubSub: class {
        topic = topic as any;
        getSubscriptions = getSubscriptions as any;
        subscription = subscription as any;
      },
    }));

    const { PubSubSubscriber } = await import('../pubsub-driver');
    const sub = new PubSubSubscriber();

    const handler = jest.fn(async () => {});
    await sub.subscribe(topicName, handler, { queue: 'router' });

    expect(createSubscription).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    // But subscription still created for listening
    expect(subscription).toHaveBeenCalledWith(subName, expect.any(Object));
  });
});
