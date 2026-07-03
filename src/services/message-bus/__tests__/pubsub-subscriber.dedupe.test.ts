import { jest } from '@jest/globals';

// Subscription stub that lets the test emit 'message' events and capture options.
class SubEmitter {
  private handlers: Record<string, Function[]> = {};
  on(event: string, fn: Function) {
    (this.handlers[event] = this.handlers[event] || []).push(fn);
  }
  removeListener(event: string, fn: Function) {
    this.handlers[event] = (this.handlers[event] || []).filter((f) => f !== fn);
  }
  async emit(event: string, payload: any) {
    for (const fn of this.handlers[event] || []) await fn(payload);
  }
  async close() {}
}

function makeMessage(id: string, attributes: Record<string, string>) {
  return {
    id,
    data: Buffer.from(JSON.stringify({ id })),
    attributes,
    ack: jest.fn(),
    nack: jest.fn(),
  };
}

describe('PubSubSubscriber – slow-Bit duplicate response prevention', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.PUBSUB_ENSURE_DISABLE = '1';
    delete process.env.MESSAGE_DEDUP_DISABLE;
  });

  async function setup() {
    const emitter = new SubEmitter();
    const subscription = jest.fn(() => emitter);
    jest.doMock('@google-cloud/pubsub', () => ({
      PubSub: class {
        subscription = subscription as any;
        topic = jest.fn(() => ({ get: jest.fn(), createSubscription: jest.fn() })) as any;
      },
      Duration: { from: (d: any) => ({ __duration: d }) },
    }));
    const { PubSubSubscriber } = await import('../pubsub-driver');
    const { __resetDedupe } = await import('../dedupe');
    __resetDedupe();
    return { emitter, subscription, PubSubSubscriber };
  }

  it('configures lease extension (maxExtensionTime) on the subscription', async () => {
    const { subscription, PubSubSubscriber } = await setup();
    const sub = new PubSubSubscriber();
    await sub.subscribe('internal.bot.requests.v1', async () => {}, { queue: 'llm-bot' });
    const opts = (subscription as any).mock.calls[0][1];
    expect(opts.maxExtensionTime).toBeDefined();
  });

  it('processes a slow message once and drops the redelivery (single egress)', async () => {
    const { emitter, PubSubSubscriber } = await setup();
    const sub = new PubSubSubscriber();

    let egress = 0;
    const handler = jest.fn(async () => {
      // simulate a slow handler producing exactly one egress
      await new Promise((r) => setTimeout(r, 10));
      egress += 1;
    });
    await sub.subscribe('internal.bot.requests.v1', handler as any, { queue: 'llm-bot', ack: 'auto' });

    const attrs = { correlationId: 'corr-1', step: 'respond', attempt: '1' };
    const first = makeMessage('msg-1', attrs);
    const redelivery = makeMessage('msg-1', attrs); // same logical message redelivered

    await emitter.emit('message', first);
    await emitter.emit('message', redelivery);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(egress).toBe(1);
    // Both deliveries are acked: the original after processing, the duplicate when dropped.
    expect(first.ack).toHaveBeenCalledTimes(1);
    expect(redelivery.ack).toHaveBeenCalledTimes(1);
  });

  it('drops redelivery even when the message carries no correlation attributes (messageId fallback)', async () => {
    const { emitter, PubSubSubscriber } = await setup();
    const sub = new PubSubSubscriber();

    const handler = jest.fn(async () => {});
    await sub.subscribe('internal.bot.requests.v1', handler as any, { ack: 'auto' });

    const a = makeMessage('same-id', {});
    const b = makeMessage('same-id', {});
    await emitter.emit('message', a);
    await emitter.emit('message', b);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
