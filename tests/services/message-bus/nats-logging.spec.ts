jest.mock('nats', () => {
  const publish = jest.fn().mockResolvedValue({ seq: 1 });
  const jetstream = jest.fn(() => ({ publish }));
  const jetstreamManager = jest.fn().mockResolvedValue({ streams: { add: jest.fn(), find: jest.fn() } });
  const flush = jest.fn().mockResolvedValue(undefined);
  const connect = jest.fn().mockResolvedValue({ jetstream, flush, jetstreamManager });
  const headers = jest.fn(() => ({ set: jest.fn() }));
  const StringCodec = () => ({ encode: (s: string) => Buffer.from(s) });
  const consumerOpts = jest.fn(() => ({ durable: jest.fn(), manualAck: jest.fn(), ackExplicit: jest.fn(), maxAckPending: jest.fn(), deliverTo: jest.fn() }));
  const createInbox = jest.fn(() => '_inbox');
  return { connect, headers, StringCodec, consumerOpts, createInbox, __publish: publish };
});

jest.mock('../../../src/common/logging', () => {
  const calls: any[] = [];
  const logger = {
    info: jest.fn((msg: string, ctx?: any) => calls.push({ level: 'info', msg, ctx })),
    debug: jest.fn((msg: string, ctx?: any) => calls.push({ level: 'debug', msg, ctx })),
    warn: jest.fn(),
    error: jest.fn((msg: string, ctx?: any) => calls.push({ level: 'error', msg, ctx })),
  };
  return { logger, __calls: calls };
});

import { NatsPublisher } from '../../../src/services/message-bus/nats-driver';
const loggingMock: any = jest.requireMock('../../../src/common/logging');
const logCalls: any[] = loggingMock.__calls;

describe('NatsPublisher structured logging', () => {
  beforeEach(() => {
    (logCalls as any).length = 0;
  });

  it('emits start and ok logs on successful publish', async () => {
    const pub = new NatsPublisher('internal.test.v1');
    await pub.publishJson({ a: 1 }, { correlationId: 'c1' });
    const msgs = (logCalls as any).map((c: any) => c.msg);
    expect(msgs).toContain('message_publisher.publish.start');
    expect(msgs).toContain('message_publisher.publish.ok');
  });

  it('emits error log when publish throws', async () => {
    const natsMod: any = require('nats');
    natsMod.__publish.mockRejectedValueOnce(new Error('kaboom'));
    const pub = new NatsPublisher('internal.test.v1');
    await expect(pub.publishJson({ a: 1 }, { correlationId: 'c2' })).rejects.toThrow('kaboom');
    const msgs = (logCalls as any).map((c: any) => c.msg);
    expect(msgs).toContain('message_publisher.publish.error');
  });
});
