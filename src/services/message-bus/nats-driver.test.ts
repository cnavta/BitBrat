import { jest } from '@jest/globals';

describe('NatsPublisher headers behavior', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('publishJson builds NATS Headers with encode() when attributes are provided', async () => {
    const publishMock = jest.fn(async (_subj: string, _data: Uint8Array, opts: any) => {
      expect(opts).toBeTruthy();
      expect(opts.headers).toBeTruthy();
      expect(typeof opts.headers.encode).toBe('function');
      return { seq: 1 } as any;
    });

    jest.doMock('nats', () => ({
      connect: async () => ({
        jetstream: () => ({ publish: publishMock }),
        jetstreamManager: async () => ({
          streams: {
            list: () => ({
              next: async () => [{ config: { name: 'BITBRAT', subjects: ['local.>'] } }]
            })
          }
        }),
        flush: async () => {},
      }),
      StringCodec: () => ({ encode: (s: string) => Buffer.from(s) }),
      headers: () => ({
        set: jest.fn(),
        encode: jest.fn(() => new Uint8Array()),
        entries: jest.fn(() => []),
      }),
      consumerOpts: () => ({}),
      createInbox: () => 'inbox',
    }));

    const { NatsPublisher } = await import('./nats-driver');

    const pub = new NatsPublisher('internal.ingress.v1');
    const id = await pub.publishJson({ hello: 'world' }, { correlationId: 'c1', type: 'chat.message.v1' });

    expect(id).toBe('1');
    expect(publishMock).toHaveBeenCalledTimes(1);
    const call = publishMock.mock.calls[0];
    expect(call[0]).toContain('internal.ingress.v1');
  });

  it('publishJson omits headers when attributes are empty/undefined', async () => {
    const publishMock = jest.fn(async (_subj: string, _data: Uint8Array, opts: any) => {
      // opts.headers should be undefined when no attrs provided
      expect(opts.headers).toBeUndefined();
      return { seq: 2 } as any;
    });

    jest.doMock('nats', () => ({
      connect: async () => ({
        jetstream: () => ({ publish: publishMock }),
        jetstreamManager: async () => ({
          streams: {
            list: () => ({
              next: async () => [{ config: { name: 'BITBRAT', subjects: ['local.>'] } }]
            })
          }
        }),
        flush: async () => {},
      }),
      StringCodec: () => ({ encode: (s: string) => Buffer.from(s) }),
      headers: () => ({ set: jest.fn(), encode: jest.fn(() => new Uint8Array()) }),
      consumerOpts: () => ({}),
      createInbox: () => 'inbox',
    }));

    const { NatsPublisher } = await import('./nats-driver');

    const pub = new NatsPublisher('internal.ingress.v1');
    const id1 = await pub.publishJson({ a: 1 }, undefined as any);
    const id2 = await pub.publishJson({ b: 2 }, {} as any);

    expect(id1).toBe('2');
    expect(id2).toBe('2');
    expect(publishMock).toHaveBeenCalledTimes(2);
  });
});

describe('NatsSubscriber behavior', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('subscribe calls deliverTo even when queue is provided', async () => {
    const deliverToMock = jest.fn();
    const queueMock = jest.fn();
    const durableMock = jest.fn();
    const subscribeMock = jest.fn(async () => ({
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
      drain: async () => {},
    }));

    jest.doMock('nats', () => ({
      connect: async () => ({
        jetstream: () => ({ subscribe: subscribeMock }),
        jetstreamManager: async () => ({
          streams: {
            list: () => ({
              next: async () => [{ config: { name: 'BITBRAT', subjects: ['local.>'] } }]
            })
          }
        }),
      }),
      consumerOpts: () => {
        const o: any = {
          durable: durableMock,
          deliverTo: deliverToMock,
          queue: queueMock,
          manualAck: jest.fn(),
          ackExplicit: jest.fn(),
          maxAckPending: jest.fn(),
        };
        o.durable.mockReturnValue(o);
        o.deliverTo.mockReturnValue(o);
        o.queue.mockReturnValue(o);
        o.manualAck.mockReturnValue(o);
        o.ackExplicit.mockReturnValue(o);
        o.maxAckPending.mockReturnValue(o);
        return o;
      },
      createInbox: () => 'inbox',
      headers: () => ({}),
      StringCodec: () => ({}),
    }));

    const { NatsSubscriber } = await import('./nats-driver');
    const sub = new NatsSubscriber();
    await sub.subscribe('test.subject', async () => {}, { queue: 'test-group' });

    expect(subscribeMock).toHaveBeenCalled();
    expect(deliverToMock).toHaveBeenCalledWith('inbox');
    expect(queueMock).toHaveBeenCalledWith('test-group');
    expect(durableMock).toHaveBeenCalledWith(expect.stringContaining('test-group'));
  });
});
