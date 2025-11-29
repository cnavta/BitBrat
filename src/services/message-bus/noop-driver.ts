/**
 * Noop Message Bus Driver
 *
 * Purpose:
 * - Provide a zero-I/O implementation for tests/CI so no network connections are attempted.
 * - Conforms to MessagePublisher/MessageSubscriber interfaces.
 */
import type { AttributeMap, MessageHandler, MessagePublisher, MessageSubscriber, UnsubscribeFn } from './index';
import { logger } from '../../common/logging';

export class NoopPublisher implements MessagePublisher {
  constructor(public subject: string) {}
  async publishJson(_data: unknown, _attributes: AttributeMap = {}): Promise<string | null> {
    logger.debug('message_publisher.noop.publish', { driver: 'noop', subject: this.subject });
    return null;
  }
  async flush(): Promise<void> {
    // no-op
  }
}

export class NoopSubscriber implements MessageSubscriber {
  async subscribe(_subject: string, _handler: MessageHandler, _options: any = {}): Promise<UnsubscribeFn> {
    logger.debug('message_consumer.noop.subscribe', { driver: 'noop', subject: _subject });
    return async () => {
      // no-op
    };
  }
}
