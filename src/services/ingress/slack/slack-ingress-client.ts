/**
 * Slack Ingress Client
 *
 * Real-time message ingress via Slack Socket Mode (WebSocket).
 * Handles message events, errors, disconnections, and reconnections.
 *
 * Sprint 348: Slack Integration
 *
 * @since Sprint 348
 */

import type { IngressPublisher, ConnectorSnapshot } from '../core';
import { logger } from '../../../common/logging';

import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { buildSlackEnvelope } from './envelope-builder';

export class SlackIngressClient {
  private socketClient?: SocketModeClient;
  private webClient?: WebClient;
  private state: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR' = 'DISCONNECTED';
  private lastError: { code: string; message: string } | null = null;
  private counters = {
    received: 0,
    published: 0,
    filtered: 0,
    failed: 0,
  };
  private lastMessageAt: string | null = null;
  private botUserId?: string;

  constructor(
    private readonly appToken: string,
    private readonly botToken: string,
    private readonly publisher: IngressPublisher
  ) {
    this.webClient = new WebClient(botToken);
  }

  async start(): Promise<void> {
    logger.info('slack.client.starting');
    this.state = 'CONNECTING';

    try {
      // Initialize Socket Mode client
      this.socketClient = new SocketModeClient({ appToken: this.appToken });

      // Fetch bot user ID for filtering (prevent loops)
      if (!this.webClient) {
        throw new Error('slack_web_client_not_initialized');
      }
      const authTest = await this.webClient.auth.test();
      this.botUserId = authTest.user_id as string;
      logger.info('slack.client.bot_user_id_resolved', { botUserId: this.botUserId });

      // Register event handlers
      this.socketClient.on('message', async (event: any) => {
        await this.handleMessage(event);
      });

      this.socketClient.on('app_mention', async (event: any) => {
        await this.handleMessage(event);
      });

      this.socketClient.on('error', (error: Error) => {
        logger.error('slack.client.error', { error: error.message });
        this.lastError = { code: 'socket_error', message: error.message };
        this.state = 'ERROR';
      });

      this.socketClient.on('disconnect', () => {
        logger.warn('slack.client.disconnected');
        this.state = 'DISCONNECTED';
      });

      this.socketClient.on('reconnect', () => {
        logger.info('slack.client.reconnected');
        this.state = 'CONNECTED';
        this.lastError = null;
      });

      // Start the connection
      await this.socketClient.start();

      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('slack.client.connected');
    } catch (error: any) {
      this.state = 'ERROR';
      this.lastError = { code: 'connection_failed', message: error.message };
      logger.error('slack.client.connection_failed', { error: error.message });
      throw error;
    }
  }

  async stop(): Promise<void> {
    logger.info('slack.client.stopping');

    try {
      if (this.socketClient) {
        await this.socketClient.disconnect();
        this.socketClient = undefined;
      }
      this.state = 'DISCONNECTED';
      logger.info('slack.client.stopped');
    } catch (error: any) {
      logger.error('slack.client.stop_failed', { error: error.message });
      throw error;
    }
  }

  async sendText(text: string, channel: string): Promise<void> {
    if (!this.webClient) {
      throw new Error('slack_client_not_initialized');
    }

    try {
      await this.webClient.chat.postMessage({
        channel,
        text,
      });
      logger.info('slack.client.message_sent', { channel });
    } catch (error: any) {
      logger.error('slack.client.send_failed', { error: error.message, channel });
      throw error;
    }
  }

  getSnapshot(): ConnectorSnapshot {
    return {
      state: this.state,
      id: 'slack-socket-mode',
      displayName: 'Slack Socket Mode',
      lastError: this.lastError,
      counters: this.counters,
      lastMessageAt: this.lastMessageAt,
    };
  }

  private async handleMessage(event: any): Promise<void> {
    this.counters.received++;
    this.lastMessageAt = new Date().toISOString();

    try {
      // Filter bot messages to prevent loops
      if (event.user === this.botUserId || event.bot_id) {
        logger.debug('slack.client.message_filtered', { user: event.user, botId: event.bot_id });
        this.counters.filtered++;
        return;
      }

      // Build envelope
      const envelope = buildSlackEnvelope({
        type: event.type,
        user: event.user,
        channel: event.channel,
        text: event.text,
        ts: event.ts,
        thread_ts: event.thread_ts,
        team: event.team,
        event_ts: event.event_ts,
      });

      // Publish to event router
      await this.publisher.publish(envelope);

      this.counters.published++;
      logger.info('slack.client.message_published', {
        correlationId: envelope.correlationId,
        user: event.user,
        channel: event.channel,
      });
    } catch (error: any) {
      this.counters.failed++;
      logger.error('slack.client.message_failed', {
        error: error.message,
        event: event.type,
      });
    }
  }
}
