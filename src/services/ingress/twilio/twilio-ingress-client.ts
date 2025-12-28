import { IConfig } from '../../../types';
import { TwilioTokenProvider } from './token-provider';
import { TwilioEnvelopeBuilder } from './twilio-envelope-builder';
import { ITwilioIngressPublisher } from './publisher';
import { logger } from '../../../common/logging';
import { startActiveSpan } from '../../../common/tracing';
import { InternalEventV2 } from '../../../types/events';

export type TwilioConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export interface TwilioDebugSnapshot {
  state: TwilioConnectionState;
  identity?: string;
  lastMessageAt?: string;
  lastError?: string | null;
  counters?: { received?: number; published?: number; failed?: number };
}

/**
 * TwilioIngressClient
 * Manages WebSocket connection to Twilio Conversations and handles incoming SMS/Chat messages.
 */
export class TwilioIngressClient {
  private client: any | null = null;
  private snapshot: TwilioDebugSnapshot = {
    state: 'DISCONNECTED',
    counters: { received: 0, published: 0, failed: 0 },
  };

  constructor(
    private readonly config: IConfig,
    private readonly tokenProvider: TwilioTokenProvider,
    private readonly builder: TwilioEnvelopeBuilder,
    private readonly publisher: ITwilioIngressPublisher,
    private readonly options: { egressDestinationTopic?: string } = {}
  ) {
    this.snapshot.identity = config.twilioIdentity;
  }

  /**
   * Returns the current state and metrics for the client.
   */
  getSnapshot(): TwilioDebugSnapshot {
    return { ...this.snapshot, counters: { ...this.snapshot.counters } };
  }

  /**
   * Starts the Twilio Conversations client.
   */
  async start(): Promise<void> {
    if (this.config.twilioEnabled === false) {
      logger.info('Twilio Ingress Client is disabled via config');
      return;
    }

    const { twilioIdentity } = this.config;
    if (!twilioIdentity) {
      logger.warn('Twilio Ingress Client cannot start: TWILIO_IDENTITY is not configured');
      return;
    }

    logger.info('Starting Twilio Ingress Client', { identity: twilioIdentity });

    let Client: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const conversations = require('@twilio/conversations');
      Client = conversations.Client;
    } catch (err: any) {
      logger.error('Failed to load @twilio/conversations SDK', { error: err.message });
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = 'SDK_LOAD_FAILURE';
      return;
    }

    this.snapshot.state = 'CONNECTING';

    try {
      const token = this.tokenProvider.generateToken(twilioIdentity);
      this.client = await Client.create(token);

      this.snapshot.state = 'CONNECTED';
      this.snapshot.lastError = null;

      // Handle token lifecycle
      this.client.on('tokenAboutToExpire', async () => {
        logger.info('Twilio token about to expire, refreshing...');
        try {
          const newToken = this.tokenProvider.generateToken(twilioIdentity);
          await this.client.updateToken(newToken);
        } catch (err: any) {
          logger.error('Failed to refresh Twilio token (aboutToExpire)', { error: err.message });
        }
      });

      this.client.on('tokenExpired', async () => {
        logger.warn('Twilio token expired, attempting refresh...');
        try {
          const newToken = this.tokenProvider.generateToken(twilioIdentity);
          await this.client.updateToken(newToken);
        } catch (err: any) {
          logger.error('Failed to refresh Twilio token (expired)', { error: err.message });
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = 'TOKEN_EXPIRED_REFRESH_FAILED';
        }
      });

      this.client.on('stateChanged', (state: string) => {
        logger.info('Twilio client state changed', { state });
        if (state === 'connected') this.snapshot.state = 'CONNECTED';
        if (state === 'disconnected') this.snapshot.state = 'DISCONNECTED';
        if (state === 'failed') {
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = 'CLIENT_STATE_FAILED';
        }
      });

      // Handle incoming messages
      this.client.on('messageAdded', async (message: any) => {
        await this.handleIncomingMessage(message);
      });

      logger.info('Twilio Ingress Client connected and listening');

    } catch (err: any) {
      this.snapshot.state = 'ERROR';
      this.snapshot.lastError = err.message;
      logger.error('Failed to initialize Twilio Conversations client', { error: err.message });
      // Don't rethrow, keep service alive but in error state
    }
  }

  /**
   * Gracefully shuts down the client.
   */
  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (err: any) {
        logger.warn('Error during Twilio client shutdown', { error: err.message });
      }
      this.client = null;
    }
    this.snapshot.state = 'DISCONNECTED';
    logger.info('Twilio Ingress Client stopped');
  }

  /**
   * Egress helper: sends a text message to a conversation.
   */
  async sendText(text: string, conversationSid: string): Promise<void> {
    if (!this.client || this.snapshot.state !== 'CONNECTED') {
      logger.warn('Cannot send Twilio message: client not connected', { conversationSid });
      throw new Error('twilio_client_not_connected');
    }

    try {
      const conversation = await this.client.getConversationBySid(conversationSid);
      await conversation.sendMessage(text);
      logger.debug('Twilio message sent', { conversationSid });
    } catch (err: any) {
      logger.error('Failed to send Twilio message', { conversationSid, error: err.message });
      throw err;
    }
  }

  /**
   * Processes an incoming Twilio message.
   */
  private async handleIncomingMessage(message: any): Promise<void> {
    // Avoid processing our own messages (loops)
    if (message.author === this.config.twilioIdentity) {
      return;
    }

    const counters = this.snapshot.counters!;
    counters.received = (counters.received || 0) + 1;
    this.snapshot.lastMessageAt = new Date().toISOString();

    logger.debug('Received Twilio message', { 
      author: message.author, 
      conversationSid: message.conversation.sid,
      body: message.body ? (message.body.length > 20 ? message.body.slice(0, 20) + '...' : message.body) : null
    });

    try {
      await startActiveSpan('twilio-ingress-receive', async () => {
        const evt: InternalEventV2 = this.builder.build(message);
        
        // Inject egress destination if configured
        if (this.options.egressDestinationTopic) {
          (evt as any).egressDestination = this.options.egressDestinationTopic;
        }

        await this.publisher.publish(evt);
        counters.published = (counters.published || 0) + 1;
      });
    } catch (err: any) {
      logger.error('Failed to process/publish Twilio message', { error: err.message });
      counters.failed = (counters.failed || 0) + 1;
      this.snapshot.lastError = `MESSAGE_PROCESS_FAILED: ${err.message}`;
    }
  }
}
