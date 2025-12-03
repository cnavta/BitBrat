/**
 * Verify PubSubPublisher tags timeout errors with code=4 (DEADLINE_EXCEEDED) and reason=publish_timeout
 */
jest.useFakeTimers();

jest.mock('@google-cloud/pubsub', () => {
  class PubSubMock {
    topic(_name: string, _opts?: any) {
      return {
        publishMessage: jest.fn(() => new Promise(() => {})), // never resolves
      };
    }
  }
  return { PubSub: PubSubMock };
});

import { PubSubPublisher } from '../../../src/services/message-bus/pubsub-driver';

describe('PubSubPublisher publish timeout behavior', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, PUBSUB_PUBLISH_TIMEOUT_MS: '10', PUBSUB_ENSURE_MODE: 'off' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('rejects with deadline exceeded tagging on timeout', async () => {
    const pub = new PubSubPublisher('internal.test.v1');
    const p = pub.publishJson({ a: 1 }, { Correlation_ID: 'c1', TYPE: 't' } as any);
    // Advance timers to trigger the withTimeout rejection
    jest.advanceTimersByTime(11);
    await expect(p).rejects.toMatchObject({ code: 4, reason: 'publish_timeout' });
  });
});
