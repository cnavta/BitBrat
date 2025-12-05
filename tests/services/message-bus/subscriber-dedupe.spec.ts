import { EventEmitter } from 'events';

// Simple Subscription mock built on EventEmitter
class SubscriptionMock extends EventEmitter {
  close = jest.fn(async () => {});
}

const subscriptionMock = new SubscriptionMock();

// Mock @google-cloud/pubsub to provide our subscription
jest.mock('@google-cloud/pubsub', () => {
  return {
    PubSub: class {
      topic() { return { createSubscription: jest.fn(async () => {}) }; }
      subscription() { return subscriptionMock as any; }
    }
  };
});

import { PubSubSubscriber } from '../../../src/services/message-bus/pubsub-driver';

function makeMessage(id: string, data: any, attrs: Record<string, string>) {
  return {
    id,
    data: Buffer.from(JSON.stringify(data)),
    attributes: attrs,
    ack: jest.fn(),
    nack: jest.fn(),
  } as any;
}

describe('PubSubSubscriber dedupe', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, MESSAGE_DEDUP_DISABLE: '0', MESSAGE_DEDUP_TTL_MS: '60000', PUBSUB_ENSURE_DISABLE: '1' } as any;
    subscriptionMock.removeAllListeners();
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('drops duplicate within TTL (same idempotencyKey) and acks duplicate; handler runs once', async () => {
    const handler = jest.fn(async (_d: Buffer, _a: Record<string,string>, ctx: { ack: () => Promise<void> }) => {
      await ctx.ack();
    });
    const sub = new PubSubSubscriber();
    const unsub = await sub.subscribe('internal.test.v1', handler, { queue: 'q', ack: 'explicit' });

    const attrs = { idempotencyKey: 'k-1', type: 't' } as any;
    const msg1 = makeMessage('m1', { a: 1 }, attrs);
    const msg2 = makeMessage('m2', { a: 1 }, attrs);

    // Emit duplicate messages; dedupe should drop second
    subscriptionMock.emit('message', msg1);
    subscriptionMock.emit('message', msg2);

    await new Promise((r) => setImmediate(r));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(msg1.ack).toHaveBeenCalledTimes(1);
    // Duplicate is acked by driver
    expect(msg2.ack).toHaveBeenCalledTimes(1);

    await unsub();
  });
});
