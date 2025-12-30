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
  conversations?: Array<{ sid: string; status: string; friendlyName?: string }>;
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
    conversations: [],
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
    logger.debug('twilio.start_init', { identity: twilioIdentity, config: { enabled: this.config.twilioEnabled, chatServiceSid: this.config.twilioChatServiceSid } });

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
        logger.debug('twilio.tokenAboutToExpire', { identity: twilioIdentity });
        try {
          const newToken = this.tokenProvider.generateToken(twilioIdentity);
          await this.client.updateToken(newToken);
          logger.debug('twilio.tokenUpdate.ok');
        } catch (err: any) {
          logger.error('Failed to refresh Twilio token (aboutToExpire)', { error: err.message });
          logger.debug('twilio.tokenUpdate.error', { error: err.message });
        }
      });

      this.client.on('tokenExpired', async () => {
        logger.warn('Twilio token expired, attempting refresh...');
        logger.debug('twilio.tokenExpired', { identity: twilioIdentity });
        try {
          const newToken = this.tokenProvider.generateToken(twilioIdentity);
          await this.client.updateToken(newToken);
          logger.debug('twilio.tokenUpdate_on_expire.ok');
        } catch (err: any) {
          logger.error('Failed to refresh Twilio token (expired)', { error: err.message });
          logger.debug('twilio.tokenUpdate_on_expire.error', { error: err.message });
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = 'TOKEN_EXPIRED_REFRESH_FAILED';
        }
      });

      this.client.on('stateChanged', (state: string) => {
        logger.info('Twilio client state changed', { state });
        logger.debug('twilio.stateChanged', { state, identity: twilioIdentity });
        if (state === 'synchronized') {
          this.snapshot.state = 'CONNECTED';
          this.logConversations();
        }
        if (state === 'failed') {
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = 'CLIENT_STATE_FAILED';
        }
      });

      this.client.on('connectionStateChanged', (state: string) => {
        logger.info('Twilio connection state changed', { state });
        logger.debug('twilio.connectionStateChanged', { state });
        if (state === 'connected') this.snapshot.state = 'CONNECTED';
        if (state === 'disconnected') this.snapshot.state = 'DISCONNECTED';
        if (state === 'error' || state === 'denied') {
          this.snapshot.state = 'ERROR';
          this.snapshot.lastError = `CONNECTION_ERROR_${state.toUpperCase()}`;
        }
      });

      this.client.on('conversationAdded', async (conversation: any) => {
        logger.info('Twilio conversation added', { sid: conversation.sid, status: conversation.status });
        logger.debug('twilio.conversationAdded_details', { sid: conversation.sid, friendlyName: conversation.friendlyName });
        
        // Update snapshot
        if (this.snapshot.conversations) {
          const exists = this.snapshot.conversations.some(c => c.sid === conversation.sid);
          if (!exists) {
            this.snapshot.conversations.push({
              sid: conversation.sid,
              status: conversation.status,
              friendlyName: conversation.friendlyName
            });
          }
        }

        if (conversation.status === 'invited') {
          try {
            logger.info('Twilio conversation invited, joining...', { sid: conversation.sid });
            await conversation.join();
          } catch (err: any) {
            logger.error('Failed to join Twilio conversation', { sid: conversation.sid, error: err.message });
          }
        }
      });

      this.client.on('conversationJoined', (conversation: any) => {
        logger.info('Twilio conversation joined (client event)', { sid: conversation.sid, status: conversation.status });
        if (this.snapshot.conversations) {
          const c = this.snapshot.conversations.find(c => c.sid === conversation.sid);
          if (c) c.status = conversation.status;
        }
      });

      this.client.on('conversationLeft', (conversation: any) => {
        logger.info('Twilio conversation left (client event)', { sid: conversation.sid });
      });

      this.client.on('conversationUpdated', ({ conversation, updateReasons }: any) => {
        logger.debug('twilio.conversationUpdated', { sid: conversation.sid, reasons: updateReasons, status: conversation.status });
        if (this.snapshot.conversations) {
          const c = this.snapshot.conversations.find(c => c.sid === conversation.sid);
          if (c) {
            c.status = conversation.status;
            c.friendlyName = conversation.friendlyName;
          }
        }
      });

      this.client.on('conversationRemoved', (conversation: any) => {
        logger.info('Twilio conversation removed', { sid: conversation.sid });
        if (this.snapshot.conversations) {
          this.snapshot.conversations = this.snapshot.conversations.filter(c => c.sid !== conversation.sid);
        }
      });

      this.client.on('participantJoined', (participant: any) => {
        const isMe = participant.identity === this.config.twilioIdentity;
        logger.info(isMe ? 'Twilio bot joined conversation' : 'Twilio participant joined', { 
          identity: participant.identity, 
          sid: participant.sid, 
          conversationSid: participant.conversation?.sid 
        });
      });

      this.client.on('participantLeft', (participant: any) => {
        const isMe = participant.identity === this.config.twilioIdentity;
        logger.info(isMe ? 'Twilio bot left conversation' : 'Twilio participant left', { 
          identity: participant.identity, 
          sid: participant.sid, 
          conversationSid: participant.conversation?.sid 
        });
      });

      // Handle incoming messages
      this.client.on('messageAdded', async (message: any) => {
        logger.info('Twilio message added event', { 
          sid: message.sid, 
          conversationSid: message.conversation?.sid,
          author: message.author
        });
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
    logger.debug('twilio.stop_init', { identity: this.snapshot.identity });
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
      logger.debug('twilio.ignore_self', { author: message.author });
      return;
    }

    const counters = this.snapshot.counters!;
    counters.received = (counters.received || 0) + 1;
    this.snapshot.lastMessageAt = new Date().toISOString();

    logger.info('Received Twilio message (processing)', { 
      author: message.author, 
      conversationSid: message.conversation?.sid,
      body: message.body ? (message.body.length > 20 ? message.body.slice(0, 20) + '...' : message.body) : null
    });

    try {
      await startActiveSpan('twilio-ingress-receive', async () => {
        // Fetch participant details to enrich the envelope
        let enrichedMessage = message;
        try {
          if (message.conversation && typeof message.conversation.getParticipantByIdentity === 'function') {
            const participant = await message.conversation.getParticipantByIdentity(message.author);
            if (participant) {
              // Attach participant info to message for the builder
              enrichedMessage = {
                ...message,
                participant: {
                  sid: participant.sid,
                  identity: participant.identity,
                  friendlyName: participant.friendlyName,
                  attributes: participant.attributes,
                  messagingBinding: participant.messagingBinding
                }
              };
            }
          }
        } catch (err: any) {
          logger.debug('twilio.fetch_participant_error', { author: message.author, error: err.message });
        }

        const evt: InternalEventV2 = this.builder.build(enrichedMessage);
        
        // Inject egress destination if configured
        if (this.options.egressDestinationTopic) {
          (evt as any).egressDestination = this.options.egressDestinationTopic;
        }

        await this.publisher.publish(evt);
        counters.published = (counters.published || 0) + 1;
        logger.info('Twilio message published to internal bus', { correlationId: evt.correlationId });
      });
    } catch (err: any) {
      logger.error('Failed to process/publish Twilio message', { error: err.message });
      counters.failed = (counters.failed || 0) + 1;
      this.snapshot.lastError = `MESSAGE_PROCESS_FAILED: ${err.message}`;
    }
  }

  /**
   * Logs current subscribed conversations for diagnostics.
   */
  private async logConversations(): Promise<void> {
    if (!this.client) return;
    try {
      const convs = await this.client.getSubscribedConversations();
      this.snapshot.conversations = convs.items.map((c: any) => ({
        sid: c.sid,
        status: c.status,
        friendlyName: c.friendlyName
      }));

      logger.info('Twilio subscribed conversations', { 
        count: convs.items.length, 
        sids: convs.items.map((c: any) => c.sid) 
      });
      
      for (const conv of convs.items) {
        if (conv.status === 'invited') {
          logger.info('Twilio conversation invited (on sync), joining...', { sid: conv.sid });
          try {
            await conv.join();
          } catch (err: any) {
            logger.error('Failed to join Twilio conversation (on sync)', { sid: conv.sid, error: err.message });
          }
        } else if (conv.status === 'joined') {
          logger.info('Twilio conversation already joined (on sync)', { sid: conv.sid });
        } else {
          logger.info('Twilio conversation status (on sync)', { sid: conv.sid, status: conv.status });
        }
      }

      if (convs.items.length === 0) {
        logger.warn('Twilio bot is not a participant in any conversations. Incoming SMS will not be received unless the bot is added.');
      }
    } catch (err: any) {
      logger.error('Failed to fetch subscribed conversations', { error: err.message });
    }
  }
}
