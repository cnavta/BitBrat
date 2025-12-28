import { Client } from '@twilio/conversations';
import { jwt, Twilio as TwilioRestClient } from 'twilio';
import { logger } from '../../../common/logging';
import type { IConfig } from '../../../types';
import type { IngressConnector, EgressConnector, IngressPublisher, ConnectorSnapshot } from '../core';
import type { TwilioMessageMeta } from './envelope-builder';
import { SmsEnvelopeBuilder } from './envelope-builder';

export class TwilioSmsIngressClient implements IngressConnector, EgressConnector {
  private client: Client | null = null;
  private restClient: TwilioRestClient | null = null;
  private snapshot: ConnectorSnapshot = { state: 'DISCONNECTED', counters: { received: 0, published: 0, failed: 0 } };
  private tokenRefreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly builder: SmsEnvelopeBuilder,
    private readonly publisher: IngressPublisher,
    private readonly cfg: IConfig,
    private readonly options: { egressDestinationTopic?: string } = {}
  ) {}

  async start(): Promise<void> {
    const disabled = !this.cfg.twilioEnabled || process.env.NODE_ENV === 'test';
    if (disabled) {
      logger.debug('ingress.twilio.disabled');
      this.snapshot.state = 'CONNECTED';
      return;
    }

    const {
      twilioAccountSid,
      twilioAuthToken,
      twilioApiKey,
      twilioApiSecret,
      twilioConversationsServiceSid,
      twilioIdentity
    } = this.cfg;

    if (!twilioAccountSid || !twilioAuthToken || !twilioApiKey || !twilioApiSecret || !twilioConversationsServiceSid || !twilioIdentity) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: 'Missing Twilio configuration (SID, Token, API Key, etc.)' };
      throw new Error('twilio_config_missing');
    }

    this.snapshot.state = 'CONNECTING';
    try {
      this.restClient = new TwilioRestClient(twilioAccountSid, twilioAuthToken);
      
      const token = this.generateAccessToken();
      this.client = new Client(token);

      this.client.on('stateChanged', (state) => {
        logger.info('ingress.twilio.client_state_changed', { state });
        if (state === 'failed') {
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = { message: 'Twilio client initialization failed' };
        }
      });

      this.client.on('connectionStateChanged', (state) => {
        logger.info('ingress.twilio.connection_state_changed', { state });
        if (state === 'connected') {
          this.snapshot.state = 'CONNECTED';
          this.snapshot.lastError = null;
        } else if (state === 'connecting' || state === 'retrying') {
          this.snapshot.state = 'CONNECTING';
        } else if (state === 'disconnected' || state === 'disconnecting') {
          this.snapshot.state = 'DISCONNECTED';
        } else if (state === 'error' || state === 'denied') {
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = { message: `Twilio connection state: ${state}` };
        }
      });

      this.client.on('messageAdded', async (message) => {
        await this.handleMessageAdded(message);
      });

      this.client.on('tokenAboutToExpire', () => {
        this.refreshToken();
      });

      this.client.on('tokenExpired', () => {
        this.refreshToken();
      });

      // Periodic token refresh every 45 mins for a 1h token
      this.tokenRefreshTimer = setInterval(() => this.refreshToken(), 45 * 60 * 1000);

    } catch (err: any) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = { message: err.message };
      logger.error('ingress.twilio.start_failed', { error: err.message });
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (e: any) {
        logger.warn('ingress.twilio.shutdown_error', { error: e.message });
      }
      this.client = null;
    }
    this.restClient = null;
    this.snapshot.state = 'DISCONNECTED';
    logger.info('ingress.twilio.stopped');
  }

  getSnapshot(): ConnectorSnapshot {
    return { ...this.snapshot };
  }

  async sendText(text: string, channelId?: string): Promise<void> {
    if (!this.restClient) {
      logger.warn('egress.twilio.failed_rest_client_not_initialized');
      throw new Error('twilio_rest_client_not_initialized');
    }
    if (!channelId) {
      logger.warn('egress.twilio.failed_no_channel_id');
      throw new Error('twilio_channel_id_required');
    }

    try {
      await this.restClient.conversations.v1.conversations(channelId)
        .messages
        .create({ body: text, author: this.cfg.twilioIdentity });
      logger.debug('egress.twilio.sent', { channelId, length: text.length });
    } catch (err: any) {
      logger.error('egress.twilio.send_failed', { channelId, error: err.message });
      throw err;
    }
  }

  private generateAccessToken(): string {
    const { AccessToken } = jwt;
    const { ChatGrant } = AccessToken;

    const token = new AccessToken(
      this.cfg.twilioAccountSid!,
      this.cfg.twilioApiKey!,
      this.cfg.twilioApiSecret!,
      { identity: this.cfg.twilioIdentity!, ttl: 3600 }
    );

    const grant = new ChatGrant({
      serviceSid: this.cfg.twilioConversationsServiceSid,
    });

    token.addGrant(grant);
    return token.toJwt();
  }

  private refreshToken() {
    if (!this.client) return;
    try {
      const newToken = this.generateAccessToken();
      this.client.updateToken(newToken);
      logger.info('ingress.twilio.token_refreshed');
    } catch (err: any) {
      logger.error('ingress.twilio.token_refresh_failed', { error: err.message });
    }
  }

  private async handleMessageAdded(message: any) {
    try {
      // Don't process messages sent by the bot itself
      if (message.author === this.cfg.twilioIdentity) {
        return;
      }

      this.snapshot.counters = this.snapshot.counters || {};
      this.snapshot.counters.received = (this.snapshot.counters.received || 0) + 1;

      const meta: TwilioMessageMeta = {
        sid: message.sid,
        conversationSid: message.conversation.sid,
        author: message.author,
        body: message.body,
        dateCreated: message.dateCreated,
        attributes: message.attributes,
      };

      const evt = this.builder.build(meta, { egressDestination: this.options.egressDestinationTopic });
      await this.publisher.publish(evt);
      
      this.snapshot.counters.published = (this.snapshot.counters.published || 0) + 1;
      logger.info('ingress.twilio.message_published', { correlationId: evt.correlationId, sid: message.sid });
    } catch (err: any) {
      this.snapshot.counters = this.snapshot.counters || {};
      this.snapshot.counters.failed = (this.snapshot.counters.failed || 0) + 1;
      logger.error('ingress.twilio.message_handle_error', { error: err.message, sid: message.sid });
    }
  }
}
