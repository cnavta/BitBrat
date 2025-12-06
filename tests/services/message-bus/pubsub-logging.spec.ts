jest.mock('@google-cloud/pubsub', () => {
  const publishMessage = jest.fn().mockResolvedValue(['mid-2']);
  class PubSubMock {
    topic(_name: string, _opts?: any) {
      return { publishMessage };
    }
  }
  return { PubSub: PubSubMock, __publishMessage: publishMessage };
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

import { PubSubPublisher } from '../../../src/services/message-bus/pubsub-driver';
// Access the mocked logging module's captured calls via requireMock to avoid TS export checks
const loggingMock: any = jest.requireMock('../../../src/common/logging');
const logCalls: any[] = loggingMock.__calls;

describe('PubSubPublisher structured logging', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, PUBSUB_ENSURE_MODE: 'off' };
    (logCalls as any).length = 0;
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('emits start and ok logs on successful publish', async () => {
    const pub = new PubSubPublisher('internal.test.v1');
    await pub.publishJson({ a: 1 }, { correlationId: 'c1' });
    const msgs = (logCalls as any).map((c: any) => c.msg);
    expect(msgs).toContain('message_publisher.publish.start');
    expect(msgs).toContain('message_publisher.publish.ok');
  });

  it('emits error log when publish throws', async () => {
    const PubSubMod: any = require('@google-cloud/pubsub');
    PubSubMod.__publishMessage.mockRejectedValueOnce(new Error('boom'));
    const pub = new PubSubPublisher('internal.test.v1');
    await expect(pub.publishJson({ a: 1 }, { correlationId: 'c2' })).rejects.toThrow('boom');
    const msgs = (logCalls as any).map((c: any) => c.msg);
    expect(msgs).toContain('message_publisher.publish.error');
  });
});
