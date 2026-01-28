import { Logger } from '../../common/logging';
import { PublisherResource } from '../../common/resources/publisher-manager';
import { InternalEventV2, INTERNAL_INGRESS_V1 } from '../../types/events';
import { busAttrsFromEvent } from '../../common/events/attributes';
import { v4 as uuidv4 } from 'uuid';

export interface InboundFrame {
  type: string;
  payload: Record<string, any>;
  metadata?: {
    id?: string;
    timestamp?: string;
  };
}

export class IngressManager {
  constructor(
    private readonly publishers: PublisherResource,
    private readonly logger: Logger
  ) {}

  /**
   * Processes an incoming message from a WebSocket client.
   * 1. Validates the JSON frame.
   * 2. Enriches with userId.
   * 3. Publishes to internal.ingress.v1.
   */
  public async handleMessage(userId: string, data: string): Promise<void> {
    try {
      const frame: InboundFrame = JSON.parse(data);
      if (!frame.type || !frame.payload) {
        throw new Error('Invalid message frame: missing type or payload');
      }

      this.logger.debug('ingress.message_received', { userId, type: frame.type });

      // Build InternalEventV2
      let type = frame.type as any;
      
      // Map external chat events to internal platform events if necessary
      if (type === 'chat.message.send') type = 'chat.message';
      
      const event: InternalEventV2 = {
        v: '1',
        type: type,
        source: 'api-gateway',
        correlationId: frame.metadata?.id || uuidv4(),
        traceId: uuidv4(),
        userId: userId,
        channel: frame.payload.channel || frame.payload.room, // Support both naming conventions
        egress: { destination: 'api-gateway' },
        auth: {
          v: '1',
          method: 'enrichment', // Gateway provides userId so it's pre-enriched in a sense
          matched: true,
          provider: 'api-gateway',
          at: new Date().toISOString()
        },
        message: (type === 'chat.message' || type === 'chat.message.send') ? {
          id: frame.metadata?.id || uuidv4(),
          role: 'user',
          text: frame.payload.text,
          rawPlatformPayload: frame.payload
        } : undefined,
        payload: frame.payload,
      };

      const publisher = this.publishers.create(INTERNAL_INGRESS_V1);
      const attrs = busAttrsFromEvent(event);
      
      await publisher.publishJson(event, attrs);
      this.logger.info('ingress.published', { userId, type: event.type, correlationId: event.correlationId });

    } catch (err: any) {
      this.logger.error('ingress.error', { userId, error: err.message });
      throw err;
    }
  }
}
