jest.mock('nats', () => {
  const publish = jest.fn().mockResolvedValue({ seq: 42 });
  const jetstream = jest.fn(() => ({ publish }));
  const jetstreamManager = jest.fn().mockResolvedValue({ streams: { add: jest.fn(), find: jest.fn() } });
  const flush = jest.fn().mockResolvedValue(undefined);
  const connect = jest.fn().mockResolvedValue({ jetstream, flush, jetstreamManager });
  const hdrStore: Record<string, string> = {};
  const headers = jest.fn(() => ({
    set: (k: string, v: string) => {
      hdrStore[k] = v;
    },
    entries: function* () {
      for (const [k, v] of Object.entries(hdrStore)) yield [k, v];
    },
  }));
  const StringCodec = () => ({ encode: (s: string) => Buffer.from(s) });
  const consumerOpts = jest.fn(() => ({ durable: jest.fn(), manualAck: jest.fn(), ackExplicit: jest.fn(), maxAckPending: jest.fn(), deliverTo: jest.fn() }));
  const createInbox = jest.fn(() => '_inbox');
  return { connect, headers, StringCodec, consumerOpts, createInbox, publish };
});

import { NatsPublisher } from '../../../src/services/message-bus/nats-driver';

describe('NatsPublisher attribute normalization', () => {
  it('normalizes attribute keys to lowerCamelCase and stringifies values', async () => {
    const pub = new NatsPublisher('internal.test.v1');
    await pub.publishJson({ ok: true }, {
      Correlation_ID: 'c1',
      'trace-parent': 123,
      STEP_ID: 's1',
      idempotency_key: null,
    } as any);
    const nats: any = require('nats');
    // publish should have been called once
    expect(nats.publish).toHaveBeenCalledTimes(1);
    const call = nats.publish.mock.calls[0];
    const opts = call[2];
    expect(opts).toBeDefined();
    // headers should contain normalized keys
    const entries: [string, string][] = Array.from(opts.headers.entries());
    const keys = entries.map(([k]) => k).sort();
    expect(keys).toEqual(['correlationId', 'stepId', 'traceParent']);
  });
});
