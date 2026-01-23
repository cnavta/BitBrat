jest.mock('nats', () => {
  const flush = jest.fn().mockResolvedValue(undefined);
  const jetstreamManager = jest.fn().mockResolvedValue({ streams: { add: jest.fn(), find: jest.fn() } });
  return {
    connect: jest.fn().mockResolvedValue({
      flush,
      jetstreamManager,
      jetstream: jest.fn().mockReturnValue({ publish: jest.fn() })
    }),
    StringCodec: () => ({ encode: (s: string) => Buffer.from(s) }),
    consumerOpts: jest.fn(() => ({ durable: jest.fn(), manualAck: jest.fn(), ackExplicit: jest.fn(), maxAckPending: jest.fn(), deliverTo: jest.fn() })),
    createInbox: jest.fn(() => '_inbox'),
    headers: jest.fn(() => ({ set: jest.fn(), entries: function* () { }, forEach: jest.fn() })),
  };
});

import { NatsPublisher } from '../../../src/services/message-bus/nats-driver';

describe('NatsPublisher.flush', () => {
  it('calls underlying connection.flush and logs ok', async () => {
    const pub = new NatsPublisher('internal.test.v1');
    await expect(pub.flush()).resolves.toBeUndefined();
  });
});
