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
    logger.info('slack.client.starting', {
      hasAppToken: !!this.appToken,
      hasBotToken: !!this.botToken,
      appTokenPrefix: this.appToken?.substring(0, 10),
    });
    this.state = 'CONNECTING';

    try {
      // Initialize Socket Mode client
      logger.debug('slack.client.socket_mode.initializing');
      this.socketClient = new SocketModeClient({ appToken: this.appToken });
      logger.debug('slack.client.socket_mode.initialized');

      // Fetch bot user ID for filtering (prevent loops)
      if (!this.webClient) {
        throw new Error('slack_web_client_not_initialized');
      }
      logger.debug('slack.client.auth_test.start');
      const authTest = await this.webClient.auth.test();
      this.botUserId = authTest.user_id as string;
      logger.info('slack.client.bot_user_id_resolved', {
        botUserId: this.botUserId,
        teamId: authTest.team_id,
        teamName: authTest.team,
        botName: authTest.user,
      });

      // Register event handlers
      logger.debug('slack.client.registering_event_handlers');

      this.socketClient.on('message', async (event: any) => {
        logger.debug('slack.client.event.message', {
          eventType: event?.type,
          hasPayload: !!event?.payload,
          payloadType: event?.payload?.type,
        });
        await this.handleMessage(event);
      });

      this.socketClient.on('app_mention', async (event: any) => {
        logger.debug('slack.client.event.app_mention', {
          eventType: event?.type,
          hasPayload: !!event?.payload,
        });
        await this.handleMessage(event);
      });

      this.socketClient.on('error', (error: Error) => {
        logger.error('slack.client.error', {
          error: error.message,
          stack: error.stack,
        });
        this.lastError = { code: 'socket_error', message: error.message };
        this.state = 'ERROR';
      });

      this.socketClient.on('disconnect', () => {
        logger.warn('slack.client.disconnected', {
          previousState: this.state,
          counters: this.counters,
        });
        this.state = 'DISCONNECTED';
      });

      this.socketClient.on('reconnect', () => {
        logger.info('slack.client.reconnected', {
          counters: this.counters,
        });
        this.state = 'CONNECTED';
        this.lastError = null;
      });

      logger.debug('slack.client.event_handlers_registered');

      // Start the connection
      logger.debug('slack.client.socket_mode.connecting');
      await this.socketClient.start();

      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('slack.client.connected', {
        botUserId: this.botUserId,
        state: this.state,
      });
    } catch (error: any) {
      this.state = 'ERROR';
      this.lastError = { code: 'connection_failed', message: error.message };
      logger.error('slack.client.connection_failed', {
        error: error.message,
        stack: error.stack,
        state: this.state,
      });
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
    logger.debug('slack.client.send_text.start', {
      channel,
      textLength: text?.length,
      hasWebClient: !!this.webClient,
      state: this.state,
    });

    if (!this.webClient) {
      logger.error('slack.client.send_text.no_web_client', { channel });
      throw new Error('slack_client_not_initialized');
    }

    try {
      logger.debug('slack.client.send_text.calling_api', {
        channel,
        textPreview: text?.substring(0, 100),
      });

      const result = await this.webClient.chat.postMessage({
        channel,
        text,
      });

      logger.info('slack.client.message_sent', {
        channel,
        textLength: text?.length,
        ok: result.ok,
        ts: result.ts,
      });
    } catch (error: any) {
      logger.error('slack.client.send_failed', {
        error: error.message,
        stack: error.stack,
        channel,
        errorCode: error.code,
        errorData: error.data,
      });
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

    logger.debug('slack.client.handle_message.start', {
      eventType: event?.type,
      hasPayload: !!event?.payload,
      payloadType: event?.payload?.type,
      eventStructure: {
        hasEvent: !!event?.payload?.event,
        eventType: event?.payload?.event?.type,
      }
    });

    try {
      // Socket Mode wraps events - extract the actual event payload
      // event.payload.event contains the actual Slack event (message, app_mention, etc.)
      const actualEvent = event?.payload?.event || event;

      logger.debug('slack.client.handle_message.extracted_event', {
        actualEventType: actualEvent?.type,
        hasUser: !!actualEvent?.user,
        hasChannel: !!actualEvent?.channel,
        hasText: !!actualEvent?.text,
        textLength: actualEvent?.text?.length || 0,
        user: actualEvent?.user,
        channel: actualEvent?.channel,
        subtype: actualEvent?.subtype,
      });

      // Filter bot messages to prevent loops
      if (actualEvent.user === this.botUserId || actualEvent.bot_id) {
        logger.debug('slack.client.message_filtered', {
          user: actualEvent.user,
          botId: actualEvent.bot_id,
          botUserId: this.botUserId,
          reason: actualEvent.user === this.botUserId ? 'user_matches_bot' : 'has_bot_id',
        });
        this.counters.filtered++;
        return;
      }

      // Build envelope from the actual event data
      logger.debug('slack.client.building_envelope', {
        type: actualEvent.type,
        user: actualEvent.user,
        channel: actualEvent.channel,
        textPreview: actualEvent.text?.substring(0, 50),
        ts: actualEvent.ts,
      });

      const envelope = buildSlackEnvelope({
        type: actualEvent.type,
        user: actualEvent.user,
        channel: actualEvent.channel,
        text: actualEvent.text,
        ts: actualEvent.ts,
        thread_ts: actualEvent.thread_ts,
        team: actualEvent.team || event?.payload?.team_id,
        event_ts: actualEvent.event_ts,
      });

      logger.debug('slack.client.envelope_built', {
        correlationId: envelope.correlationId,
        envelopeType: envelope.type,
        messageId: envelope.message?.id,
        messageText: envelope.message?.text?.substring(0, 100),
        userId: envelope.identity?.external?.id,
        channelId: envelope.ingress?.channel,
      });

      // Publish to event router
      logger.debug('slack.client.publishing_envelope', {
        correlationId: envelope.correlationId,
      });

      await this.publisher.publish(envelope);

      this.counters.published++;
      logger.info('slack.client.message_published', {
        correlationId: envelope.correlationId,
        user: actualEvent.user,
        channel: actualEvent.channel,
        textLength: actualEvent.text?.length || 0,
        counters: this.counters,
      });
    } catch (error: any) {
      this.counters.failed++;
      logger.error('slack.client.message_failed', {
        error: error.message,
        stack: error.stack,
        eventType: event?.type,
        payloadType: event?.payload?.type,
        counters: this.counters,
      });
    }
  }
}
