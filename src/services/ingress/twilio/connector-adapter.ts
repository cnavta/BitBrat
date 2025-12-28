import type { IngressConnector, ConnectorSnapshot } from '../core';
import type { TwilioIngressClient, TwilioDebugSnapshot } from './twilio-ingress-client';
import { logger } from '../../../common/logging';

export class TwilioConnectorAdapter implements IngressConnector {
  constructor(private readonly client: TwilioIngressClient) {}

  /**
   * Starts the underlying Twilio client.
   */
  async start(): Promise<void> {
    await this.client.start();
  }

  /**
   * Stops the underlying Twilio client.
   */
  async stop(): Promise<void> {
    await this.client.stop();
  }

  /**
   * Returns a snapshot of the connector state.
   */
  getSnapshot(): ConnectorSnapshot {
    const s: TwilioDebugSnapshot = this.client.getSnapshot();
    return {
      state: s.state,
      id: s.identity,
      displayName: s.identity,
      lastError: s.lastError ? { message: s.lastError } : null,
      counters: s.counters ? { ...s.counters } : undefined,
      lastMessageAt: s.lastMessageAt,
    } as ConnectorSnapshot & Record<string, unknown>;
  }

  /**
   * Egress implementation: sends text to a Twilio conversation.
   * @param text The message body.
   * @param target The Conversation SID.
   */
  async sendText(text: string, target?: string): Promise<void> {
    logger.debug('twilio.adapter.sendText', { target, textLength: text?.length });
    if (!target) {
      throw new Error('twilio_connector_adapter.target_required');
    }
    await this.client.sendText(text, target);
  }
}
