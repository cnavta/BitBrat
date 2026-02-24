import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubListener } from '@twurple/eventsub-base';
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { logger } from '../../../common/logging';
import { IConfig } from '../../../types';
import { ITwitchCredentialsProvider } from './credentials-provider';
import { ITwitchIngressPublisher } from './publisher';
import { EventSubEnvelopeBuilder } from './eventsub-envelope-builder';
import { TwitchConnectionState } from './twitch-irc-client';
import { MutationProposal, INTERNAL_STATE_MUTATION_V1 } from '../../../types/state';
import { v4 as uuidv4 } from 'uuid';

export interface TwitchEventSubClientOptions {
  cfg: IConfig;
  credentialsProvider: ITwitchCredentialsProvider;
  egressDestinationTopic?: string;
  disableConnect?: boolean;
}

export class TwitchEventSubClient {
  private mutationPublisher: import('../../message-bus').MessagePublisher | null = null;
  private listener: EventSubWsListener | null = null;
  private readonly builder: EventSubEnvelopeBuilder;
  private readonly subscriptions: any[] = [];
  private state: TwitchConnectionState = 'DISCONNECTED';
  private botUserId?: string;
  private botDisplayName?: string;
  private lastError: { code?: string; message: string } | null = null;

  constructor(
    private readonly publisher: ITwitchIngressPublisher,
    private readonly channels: string[],
    private readonly options: TwitchEventSubClientOptions
  ) {
    this.builder = new EventSubEnvelopeBuilder();
  }

  async start(): Promise<void> {
    const disabled =
      this.options.disableConnect === true ||
      process.env.NODE_ENV === 'test' ||
      this.options.cfg.twitchEnabled === false ||
      this.options.cfg.twitchDisableConnect === true;

    if (disabled) {
      logger.info('twitch.eventsub.disabled', { reason: 'config or test env' });
      this.state = 'CONNECTED'; // Emulate connected in tests
      return;
    }

    this.state = 'CONNECTING';
    try {
      logger.info('twitch.eventsub.starting', { channels: this.channels });
      
      // We need a broadcaster's ID to subscribe to their events.
      // For now, we assume the credentialsProvider can give us the auth for the first channel in the list
      // as a starting point, but EventSub usually needs a User ID.
      const auth = await this.options.credentialsProvider.getChatAuth(this.channels[0]);
      
      if (!auth.userId) {
        throw new Error('twitch_auth_missing_user_id');
      }

      this.botUserId = auth.userId;
      this.botDisplayName = auth.login || this.channels[0];

      const authProvider = new RefreshingAuthProvider({
        clientId: this.options.cfg.twitchClientId!,
        clientSecret: this.options.cfg.twitchClientSecret!,
      });

      // If the provider supports saving refreshed tokens, hook it up
      if (typeof this.options.credentialsProvider.saveRefreshedToken === 'function') {
        authProvider.onRefresh(async (userId, tokenData) => {
          await this.options.credentialsProvider.saveRefreshedToken!({
            ...(tokenData as any),
            userId,
          });
        });
      }

      authProvider.addUser(auth.userId, {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken || null,
        expiresIn: auth.expiresIn ?? null,
        obtainmentTimestamp: auth.obtainmentTimestamp ?? 0,
        scope: auth.scope || [],
      }, ['chat', 'eventsub']);

      // Attempt to load the primary broadcaster token if available (Sprint 152 update)
      const broadcasterAuth = typeof this.options.credentialsProvider.getBroadcasterAuth === 'function'
        ? await this.options.credentialsProvider.getBroadcasterAuth(this.channels[0])
        : null;
      
      if (broadcasterAuth && broadcasterAuth.userId) {
        logger.info('twitch.eventsub.broadcaster_auth_found', { userId: broadcasterAuth.userId });
        authProvider.addUser(broadcasterAuth.userId, {
          accessToken: broadcasterAuth.accessToken,
          refreshToken: broadcasterAuth.refreshToken || null,
          expiresIn: broadcasterAuth.expiresIn ?? null,
          obtainmentTimestamp: broadcasterAuth.obtainmentTimestamp ?? 0,
          scope: broadcasterAuth.scope || [],
        }, ['chat', 'eventsub']);
      }

      const apiClient = new ApiClient({ authProvider });

      this.listener = new EventSubWsListener({ apiClient });
      
      // Setup subscriptions for each channel
      for (const channel of this.channels) {
        // Resolve user ID for the channel
        const user = await apiClient.users.getUserByName(channel);
        if (!user) {
          logger.warn('twitch.eventsub.user_not_found', { channel });
          continue;
        }

        const userId = user.id;

        // Register the bot's token for the broadcaster's ID as well if no real broadcaster token was found.
        // This is a workaround for Twurple v7.4.0 where some EventSub v2 subscriptions
        // (like channel.update) hardcode the broadcaster's ID as the user context
        // for the API call, even if no special scopes are required.
        if (userId !== auth.userId && (!broadcasterAuth || broadcasterAuth.userId !== userId)) {
          logger.info('twitch.eventsub.aliasing_bot_token', { broadcasterId: userId, botId: auth.userId });
          authProvider.addUser(userId, {
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken || null,
            expiresIn: auth.expiresIn ?? null,
            obtainmentTimestamp: auth.obtainmentTimestamp ?? 0,
            scope: auth.scope || [],
          }, ['chat', 'eventsub']);
        }

        // channel.follow (v2)
        // Note: v2 requires moderator:read:followers
        const followSub = this.listener.onChannelFollow(userId, auth.userId, (event: any) => {
          try {
            logger.info('twitch.eventsub.event.follow', { channel, from: event.userName });
            const internalEvent = this.builder.buildFollow(event as any, {
              finalizationDestination: this.options.egressDestinationTopic
            });
            this.publisher.publish(internalEvent).catch(err => {
              logger.error('twitch.eventsub.publish_failed', { kind: 'follow', error: err.message });
            });
          } catch (err: any) {
            logger.error('twitch.eventsub.handler_error', { kind: 'follow', channel, error: err.message, stack: err.stack });
          }
        });
        this.subscriptions.push(followSub);

        // channel.update
        const updateSub = this.listener.onChannelUpdate(userId, (event: any) => {
          try {
            logger.info('twitch.eventsub.event.update', { channel, title: event.streamTitle });
            const internalEvent = this.builder.buildUpdate(event as any, {
              finalizationDestination: this.options.egressDestinationTopic
            });
            this.publisher.publish(internalEvent).catch(err => {
              logger.error('twitch.eventsub.publish_failed', { kind: 'update', error: err.message });
            });
          } catch (err: any) {
            logger.error('twitch.eventsub.handler_error', { kind: 'update', channel, error: err.message, stack: err.stack });
          }
        });
        this.subscriptions.push(updateSub);

        // stream.online
        const onlineSub = this.listener.onStreamOnline(userId, (event: any) => {
          try {
            logger.info('twitch.eventsub.event.stream_online', { channel, streamId: event.id });
            const internalEvent = this.builder.buildStreamOnline(event as any, {
              finalizationDestination: this.options.egressDestinationTopic
            });
            this.publisher.publish(internalEvent).catch(err => {
              logger.error('twitch.eventsub.publish_failed', { kind: 'stream.online', error: err.message });
            });

            // Sprint 254: Publish mutation proposal for stream.state (on)
            const mutation: MutationProposal = {
              id: uuidv4(),
              op: 'set',
              key: 'stream.state',
              value: 'on',
              actor: 'ingress-egress:twitch',
              reason: 'Twitch EventSub: stream.online',
              ts: new Date().toISOString(),
              metadata: {
                streamId: event.id,
                broadcasterId: event.broadcasterId,
              }
            };
            if (this.mutationPublisher) {
              logger.info('twitch.eventsub.mutation_publishing', {mutation});
              this.mutationPublisher.publishJson(mutation).catch((err: any) => {
                logger.error('twitch.eventsub.mutation_publish_failed', { key: 'stream.state', error: err.message });
              });
            } else {
              logger.warn('twitch.eventsub.mutation_publisher_unavailable');
            }
          } catch (err: any) {
            logger.error('twitch.eventsub.handler_error', { kind: 'stream.online', channel, error: err.message, stack: err.stack });
          }
        });
        this.subscriptions.push(onlineSub);

        // stream.offline
        const offlineSub = this.listener.onStreamOffline(userId, (event: any) => {
          try {
            logger.info('twitch.eventsub.event.stream_offline', { channel });
            const internalEvent = this.builder.buildStreamOffline(event as any, {
              finalizationDestination: this.options.egressDestinationTopic
            });
            this.publisher.publish(internalEvent).catch(err => {
              logger.error('twitch.eventsub.publish_failed', { kind: 'stream.offline', error: err.message });
            });

            // Sprint 254: Publish mutation proposal for stream.state (off)
            const mutation: MutationProposal = {
              id: uuidv4(),
              op: 'set',
              key: 'stream.state',
              value: 'off',
              actor: 'ingress-egress:twitch',
              reason: 'Twitch EventSub: stream.offline',
              ts: new Date().toISOString(),
              metadata: {
                broadcasterId: event.broadcasterId,
              }
            };
            if (this.mutationPublisher) {
              this.mutationPublisher.publishJson(mutation).catch((err: any) => {
                logger.error('twitch.eventsub.mutation_publish_failed', { key: 'stream.state', error: err.message });
              });
            } else {
              logger.warn('twitch.eventsub.mutation_publisher_unavailable');
            }
          } catch (err: any) {
            logger.error('twitch.eventsub.handler_error', { kind: 'stream.offline', channel, error: err.message, stack: err.stack });
          }
        });
        this.subscriptions.push(offlineSub);
      }

      // Initialize mutation publisher for state-engine
      try {
        const prefix = this.options.cfg?.busPrefix ?? process.env.BUS_PREFIX ?? '';
        const subject = `${prefix}${INTERNAL_STATE_MUTATION_V1}`;
        const { createMessagePublisher } = require('../../message-bus');
        this.mutationPublisher = createMessagePublisher(subject);
      } catch (e: any) {
        logger.warn('twitch.eventsub.mutation_publisher_init_failed', { error: e?.message || String(e) });
        this.mutationPublisher = null;
      }

      this.listener.start();
      this.state = 'CONNECTED';
      this.lastError = null;
      logger.info('twitch.eventsub.started');
    } catch (err: any) {
      this.state = 'ERROR';
      this.lastError = { message: err.message };
      logger.error('twitch.eventsub.start_failed', { error: err.message });
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.state = 'DISCONNECTED';
    if (this.listener) {
      this.listener.stop();
      this.listener = null;
    }
    this.subscriptions.forEach(s => {
      if (s && typeof s.stop === 'function') {
        s.stop();
      }
    });
    this.subscriptions.length = 0;
    logger.info('twitch.eventsub.stopped');
  }

  getSnapshot() {
    return {
      state: this.state,
      userId: this.botUserId,
      displayName: this.botDisplayName,
      active: !!this.listener,
      subscriptions: this.subscriptions.length,
      lastError: this.lastError,
      joinedChannels: this.channels.map(c => c.startsWith('#') ? c : `#${c}`),
    };
  }
}
