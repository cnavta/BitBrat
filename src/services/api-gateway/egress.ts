import { Logger } from '../../common/logging';
import { WebSocket } from 'ws';
import { InternalEventV2 } from '../../types/events';
import { extractEgressTextFromEvent } from '../../common/events/selection';

export class EgressManager {
  constructor(
    private readonly userConnections: Map<string, Set<WebSocket>>,
    private readonly logger: Logger
  ) {}

  /**
   * Processes an outgoing message from the platform to clients.
   * 1. Extracts normalized text from event.
   * 2. Identifies target user(s).
   * 3. Forwards to all active WebSocket connections for that user.
   */
  public async handleEgressEvent(event: InternalEventV2): Promise<void> {
    const userId = event.userId;
    if (!userId) {
      this.logger.warn('egress.missing_user_id', { correlationId: event.correlationId });
      return;
    }

    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) {
      this.logger.debug('egress.no_active_connections', { userId, correlationId: event.correlationId });
      return;
    }

    const text = extractEgressTextFromEvent(event);
    if (!text && !event.payload) {
      this.logger.warn('egress.empty_content', { userId, correlationId: event.correlationId });
      return;
    }

    const outboundFrame = {
      type: event.type === 'chat.message' ? 'chat.message.received' : event.type,
      payload: event.payload || { text },
      metadata: {
        id: event.correlationId,
        timestamp: new Date().toISOString(),
        source: event.source
      }
    };

    const message = JSON.stringify(outboundFrame);
    let successCount = 0;
    let failCount = 0;

    for (const ws of connections) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          successCount++;
        } else {
          failCount++;
        }
      } catch (err: any) {
        this.logger.error('egress.send_failed', { userId, error: err.message });
        failCount++;
      }
    }

    this.logger.info('egress.forwarded', { 
      userId, 
      type: outboundFrame.type, 
      successCount, 
      failCount,
      correlationId: event.correlationId 
    });
  }
}
