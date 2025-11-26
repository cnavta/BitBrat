import { jest } from '@jest/globals';

// Mock Pub/Sub client to avoid network
jest.mock('@google-cloud/pubsub', () => {
  class TopicStub {
    publishMessage = jest.fn(async () => ['msg-1']);
  }
  return { PubSub: class { topic = () => new TopicStub(); } };
});

// Spy console.debug because our Logger writes JSON via console.debug for debug level
// We'll temporarily set logger level to debug by importing and mutating it

describe('PubSubPublisher logging', () => {
  it('emits start and ok logs around publishJson', async () => {
    const { logger } = await import('../../../common/logging');
    // @ts-ignore - set level dynamically for the test
    logger.setLevel('debug');

    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { PubSubPublisher } = await import('../pubsub-driver');
      const pub = new PubSubPublisher('test.topic');
      await pub.publishJson({ a: 1 }, { k: 'v' });

      const msgs = debugSpy.mock.calls.map((c) => String(c[0]));
      expect(msgs.some((s) => s.includes('message_publisher.publish.start'))).toBe(true);
      expect(msgs.some((s) => s.includes('message_publisher.publish.ok'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('emits flush start and ok logs (noop flush)', async () => {
    const { logger } = await import('../../../common/logging');
    // @ts-ignore
    logger.setLevel('debug');

    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { PubSubPublisher } = await import('../pubsub-driver');
      const pub = new PubSubPublisher('test.topic');
      await pub.flush();
      const msgs = debugSpy.mock.calls.map((c) => String(c[0]));
      expect(msgs.some((s) => s.includes('message_publisher.flush.start'))).toBe(true);
      expect(msgs.some((s) => s.includes('message_publisher.flush.ok'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });
});
