jest.mock('@google-cloud/pubsub', () => {
  const publishMessage = jest.fn().mockResolvedValue(['mid-1']);
  const topicMock = jest.fn((_name: string, _opts?: any) => ({ publishMessage }));
  class PubSubMock {
    topic = topicMock;
  }
  return { PubSub: PubSubMock };
});

jest.mock('../../../src/common/logging', () => {
  const calls: any[] = [];
  const logger = {
    info: jest.fn((msg: string, ctx?: any) => calls.push({ level: 'info', msg, ctx })),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return { logger };
});

import { PubSubPublisher } from '../../../src/services/message-bus/pubsub-driver';
import { logger } from '../../../src/common/logging';

describe('PubSubPublisher attribute normalization and init logging', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, PUBSUB_ENSURE_MODE: 'off', PUBSUB_BATCH_MAX_MESSAGES: '123', PUBSUB_BATCH_MAX_MS: '456' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('normalizes attribute keys and logs batching config at init', async () => {
    const pub = new PubSubPublisher('internal.test.v1');
    await pub.publishJson({ ok: true }, { Correlation_ID: 'c1', 'trace-parent': 'tp', STEP_ID: 's1' } as any);
    // Ensure publish was attempted
    const PubSubMod: any = require('@google-cloud/pubsub');
    const topicInstance = new PubSubMod.PubSub().topic('internal.test.v1');
    expect(topicInstance.publishMessage).toHaveBeenCalled();
    // Check init log
    expect((logger.info as jest.Mock).mock.calls.find((c: any[]) => c[0] === 'pubsub.publisher.init')?.[1]).toMatchObject({
      topic: 'internal.test.v1',
      batching: { maxMessages: 123, maxMilliseconds: 456 },
    });
  });
});
