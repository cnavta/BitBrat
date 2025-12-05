jest.mock('@google-cloud/pubsub', () => {
  class PubSubMock {
    topic() {
      return { publishMessage: jest.fn(async () => 'm1') };
    }
  }
  return { PubSub: PubSubMock };
});

import { PubSubPublisher } from '../../../src/services/message-bus/pubsub-driver';
import { logger } from '../../../src/common/logging';

describe('PubSubPublisher batching window warning', () => {
  const warnSpy = jest.spyOn(logger, 'warn').mockImplementation((() => {}) as any);
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    warnSpy.mockClear();
  });
  afterAll(() => {
    process.env = OLD_ENV;
    warnSpy.mockRestore();
  });

  it('warns when PUBSUB_BATCH_MAX_MS >= 1000', async () => {
    process.env.PUBSUB_BATCH_MAX_MS = '1500';
    const pub = new PubSubPublisher('internal.test.v1');
    await pub.publishJson({ ok: true }, { type: 't' });
    expect(warnSpy).toHaveBeenCalledWith(
      'pubsub.publisher.batching.window_high',
      expect.objectContaining({ maxMilliseconds: 1500 })
    );
  });
});
