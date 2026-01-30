import { BaseServer } from '../common/base-server';
import express, { Express, Request, Response } from 'express';
import {
  TwitchIrcClient,
  TwitchEnvelopeBuilder,
  ConfigTwitchCredentialsProvider,
  FirestoreTwitchCredentialsProvider,
  TwitchEventSubClient
} from '../services/ingress/twitch';
import { createTwitchIngressPublisherFromConfig } from '../services/ingress/twitch';
import { TwitchConnectorAdapter } from '../services/ingress/twitch/connector-adapter';
import { ConnectorManager } from '../services/ingress/core';
import { DiscordEnvelopeBuilder, DiscordIngressClient, createDiscordIngressPublisherFromConfig } from '../services/ingress/discord';
import {
  TwilioEnvelopeBuilder,
  TwilioIngressClient,
  TwilioTokenProvider,
  TwilioConnectorAdapter,
  createTwilioIngressPublisherFromConfig
} from '../services/ingress/twilio';
import { validateTwilioSignature } from '../services/ingress/twilio/webhook-utils';
import twilio from 'twilio';
import { FirestoreAuthTokenStore } from '../services/oauth/auth-token-store';
import { FirestoreTokenStore } from '../services/firestore-token-store';
import { buildConfig } from '../common/config';
import { logger } from '../common/logging';
import { AttributeMap } from '../services/message-bus';
import {INTERNAL_EGRESS_V1, INTERNAL_DEADLETTER_V1, InternalEventV2} from '../types/events';
import { buildDlqEvent } from '../services/routing/dlq';
import { extractEgressTextFromEvent, markSelectedCandidate, selectBestCandidate } from '../common/events/selection';
import type { PublisherResource } from '../common/resources/publisher-manager';
import type { Firestore } from 'firebase-admin/firestore';

const SERVICE_NAME = process.env.SERVICE_NAME || 'ingress-egress';
// Use centralized configuration for port instead of reading env directly in app code
const PORT = buildConfig(process.env).port;

export class IngressEgressServer extends BaseServer {
  // Declare default configuration values for this service
  // Expose persistence TTL days so other components can align via ENV
  protected static CONFIG_DEFAULTS: Record<string, any> = {
    PERSISTENCE_TTL_DAYS: 7,
  };
  private twitchClient: TwitchIrcClient | null = null;
  private twitchEventSubClient: TwitchEventSubClient | null = null;
  private discordClient: DiscordIngressClient | null = null;
  private twilioClient: TwilioIngressClient | null = null;
  private unsubscribeEgress: (() => Promise<void>) | null = null;
  private connectorManager: ConnectorManager | null = null;
  private lastStates: Record<string, string> = {};
  private statusTimer: NodeJS.Timeout | null = null;

  constructor() {
    super({ serviceName: SERVICE_NAME });
    // Perform setup after BaseServer is constructed; BaseServer's /readyz will default to ready=true
    const app = this.getApp();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    this.setupApp(app as any, this.getConfig() as any);
  }

  private async setupApp(app: Express, cfg: any) {
    // Create instances using centralized Config
    logger.debug('Creating Twitch ingress-egress service', { cfg });
    // Surface key runtime messaging config for diagnostics
    try {
      logger.info('ingress-egress.config', {
        busPrefix: cfg.busPrefix,
        messageBusDriver: process.env.MESSAGE_BUS_DRIVER || process.env.MESSAGE_BUS || 'auto',
        pubsub: {
          batchMaxMs: process.env.PUBSUB_BATCH_MAX_MS || '(default: 20)',
          batchMaxMessages: process.env.PUBSUB_BATCH_MAX_MESSAGES || '(default: 100)',
          publishTimeoutMs: process.env.PUBSUB_PUBLISH_TIMEOUT_MS || '(auto: 2000 in Cloud Run, 0 locally)',
          ensureMode: process.env.PUBSUB_ENSURE_MODE || '(default: on-publish-fail)'
        }
      });
    } catch {}

    // Resolve instance identity → used to compute per-instance egress topic
    const kRevision = process.env.K_REVISION;
    if (kRevision) {
      process.env.EGRESS_INSTANCE_ID = kRevision;
      process.env.SERVICE_INSTANCE_ID = kRevision;
    }
    const instanceId =
      process.env.EGRESS_INSTANCE_ID ||
      process.env.SERVICE_INSTANCE_ID ||
      process.env.HOSTNAME ||
      `proc-${Math.random().toString(36).slice(2, 10)}`;
    const egressTopic = `${INTERNAL_EGRESS_V1}.${instanceId}`; // without BUS_PREFIX in the value
    const egressSubject = `${cfg.busPrefix || ''}${egressTopic}`; // with BUS_PREFIX for subscription

    const envelopeBuilder = new TwitchEnvelopeBuilder();
    const pubRes = this.getResource<PublisherResource>('publisher');
    const publisher = createTwitchIngressPublisherFromConfig(cfg, pubRes ? pubRes.create.bind(pubRes) : undefined);
    const db = this.getResource<Firestore>('firestore');
    const credsProvider = cfg.firestoreEnabled
      ? new FirestoreTwitchCredentialsProvider(cfg, new FirestoreTokenStore(cfg.tokenDocPath || 'oauth/twitch/bot', db))
      : new ConfigTwitchCredentialsProvider(cfg);

    // Create the IRC client using config-driven channels
    this.twitchClient = new TwitchIrcClient(envelopeBuilder, publisher, cfg.twitchChannels, {
      cfg,
      credentialsProvider: credsProvider,
      egressDestinationTopic: egressTopic, // ensure envelope.egressDestination is set on publish
    });

    // Create the EventSub client
    this.twitchEventSubClient = new TwitchEventSubClient(publisher, cfg.twitchChannels || [], {
      cfg,
      credentialsProvider: credsProvider,
      egressDestinationTopic: egressTopic,
    });

    // Connector Manager wiring (register Twitch + Discord; preserve existing Twitch egress path)
    const manager = new ConnectorManager({ logger });
    if (this.twitchClient) {
      manager.register('twitch', new TwitchConnectorAdapter(this.twitchClient));
    }
    if (this.twitchEventSubClient) {
      manager.register('twitch-eventsub', new TwitchConnectorAdapter(this.twitchEventSubClient as any));
    }
    try {
      const dBuilder = new DiscordEnvelopeBuilder();
      const dPublisher = createDiscordIngressPublisherFromConfig(cfg, pubRes ? pubRes.create.bind(pubRes) : undefined);
      const dTokenStore = new FirestoreAuthTokenStore({ db });
      const dClient = new DiscordIngressClient(dBuilder, dPublisher, cfg, { egressDestinationTopic: egressTopic }, dTokenStore);
      this.discordClient = dClient;
      manager.register('discord', dClient);
    } catch (e: any) {
      // Defensive: if Discord modules fail to construct, keep Twitch operational
      logger.warn('ingress-egress.discord.register_failed', { error: e?.message || String(e) });
    }

    // Twilio initialization
    if (cfg.twilioEnabled) {
      try {
        const twilioBuilder = new TwilioEnvelopeBuilder();
        const twilioPublisher = createTwilioIngressPublisherFromConfig(cfg, pubRes ? pubRes.create.bind(pubRes) : undefined);
        const twilioTokenProvider = new TwilioTokenProvider(cfg);
        this.twilioClient = new TwilioIngressClient(cfg, twilioTokenProvider, twilioBuilder, twilioPublisher, {
          egressDestinationTopic: egressTopic
        });
        manager.register('twilio', new TwilioConnectorAdapter(this.twilioClient));
        logger.info('twilio.init_ok');

        // Handle Twilio Webhooks
        this.onHTTPRequest({ path: '/webhooks/twilio', method: 'POST' }, async (req: Request, res: Response) => {
          const signature = req.header('X-Twilio-Signature');
          if (!signature) {
            logger.warn('twilio.webhook.missing_signature');
            res.status(403).send('Missing X-Twilio-Signature');
            return;
          }

          const twilioAuthToken = cfg.twilioAuthToken;
          if (!twilioAuthToken) {
            logger.error('twilio.webhook.missing_auth_token_config');
            res.status(500).send('Misconfigured');
            return;
          }

          // In Cloud Run, req.protocol might be http but external URL is https
          // Twilio signs using the absolute URL as it was sent
          const protocol = req.header('x-forwarded-proto') || req.protocol;
          const host = req.header('host');
          const url = `${protocol}://${host}${req.originalUrl}`;

          const isValid = validateTwilioSignature(twilioAuthToken, signature, url, req.body);
          if (!isValid) {
            logger.warn('twilio.webhook.invalid_signature', { url });
            res.status(403).send('Invalid Signature');
            return;
          }

          const { EventType, ConversationSid } = req.body;
          logger.info('twilio.webhook.received', { EventType, ConversationSid });

          if (EventType === 'onConversationAdded' || EventType === 'onMessageAdded') {
            try {
              const twilioRest = twilio(cfg.twilioAccountSid, cfg.twilioAuthToken);
              const botIdentity = cfg.twilioIdentity;

              logger.info('twilio.webhook.inject_bot', { ConversationSid, botIdentity, trigger: EventType });
              await twilioRest.conversations.v1.conversations(ConversationSid)
                .participants
                .create({ identity: botIdentity });

              logger.info('twilio.webhook.inject_bot.ok', { ConversationSid, trigger: EventType });
            } catch (err: any) {
              // Handle "Already exists" errors (409 or 400 with specific code)
              if (err.code === 50433 || err.status === 409 || err.message?.includes('already exists')) {
                logger.info('twilio.webhook.inject_bot.already_participant', { ConversationSid, trigger: EventType });
              } else {
                logger.error('twilio.webhook.inject_bot.error', { ConversationSid, trigger: EventType, error: err.message });
              }
            }
          }

          res.status(200).send('OK');
        });

      } catch (e: any) {
        logger.error('twilio.init_error', { error: e?.message || String(e) });
      }
    }

    // Start connectors (individual connectors handle disabled/test guards internally)
    try {
      await manager.start();
      this.connectorManager = manager;
    } catch (e: any) {
      logger.error('ingress-egress.connectors.start_error', { error: e?.message || String(e) });
    }

    // Subscribe to this instance-specific egress subject and deliver text via Twitch IRC
    const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID || process.env.MESSAGE_BUS_DISABLE_SUBSCRIBE === '1';
    if (isTestEnv) {
      logger.debug('ingress-egress.egress_subscribe.disabled_for_tests');
    } else {
      logger.info('ingress-egress.egress_subscribe.start', { subject: egressSubject, queue: `ingress-egress.${instanceId}` });
      try {
        await this.onMessage<any>(
          { destination: egressTopic, queue: `ingress-egress.${instanceId}`, ack: 'explicit' },
          async (evt: any, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            try {
              await this.processEgress(evt, egressTopic);
              await ctx.ack();
            } catch (e: any) {
              const msg = e?.message || String(e);
              if (/json|unexpected token|position \d+/i.test(msg)) {
                logger.error('ingress-egress.egress.json_error', { subject: egressSubject, error: msg });
                await ctx.ack();
              } else {
                logger.error('ingress-egress.egress.process_error', { subject: egressSubject, error: msg });
                await ctx.ack();
              }
            }
          }
        );
        logger.info('ingress-egress.egress_subscribe.ok', { subject: egressSubject });
      } catch (e: any) {
        logger.error('ingress-egress.egress_subscribe.error', { subject: egressSubject, error: e?.message || String(e) });
      }

      // Subscribe to generic egress topic (broadcast to all instances)
      const genericEgressTopic = INTERNAL_EGRESS_V1;
      const genericEgressSubject = `${cfg.busPrefix || ''}${genericEgressTopic}`;
      const genericQueue = `ingress-egress.${instanceId}`;
      logger.info('ingress-egress.egress.generic_subscribe.start', { subject: genericEgressSubject, queue: genericQueue });
      try {
        await this.onMessage<InternalEventV2>(
          { destination: genericEgressTopic, queue: genericQueue, ack: 'explicit' },
          async (evt: InternalEventV2, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
            logger.debug('ingress-egress.egress.generic.received', { correlationId: evt?.correlationId });
            try {
              // Determine if this service supports the platform for this event
              const source = (evt?.ingress?.source || '').toLowerCase();
              const annotations = Array.isArray(evt?.annotations) ? evt.annotations : [];
              const egressDest = (evt?.egress?.destination || '').toLowerCase();
              const authProvider = (evt?.identity?.auth?.provider || '').toLowerCase();

              const isDiscord = egressDest === 'discord' || source.includes('discord') || authProvider === 'discord' || annotations.some((a: any) => a.kind === 'custom' && a.source === 'discord');
              const isTwilio = egressDest === 'twilio' || source.includes('twilio') || authProvider === 'twilio' || annotations.some((a: any) => a.kind === 'custom' && a.source === 'twilio');
              const isTwitch = egressDest === 'twitch' || source.includes('twitch') || authProvider === 'twitch' || 
                              (!isDiscord && !isTwilio && (egressDest === '' || egressDest === 'chat' || egressDest === 'twitch' || authProvider === ''));

              logger.debug('ingress-egress.egress.generic.platforms', { isDiscord, isTwilio, isTwitch })
              if (isDiscord || isTwilio || isTwitch) {
                const result = await this.processEgress(evt, genericEgressSubject);
                if (result === 'FAILED') {
                  const dlqEvent = buildDlqEvent({
                    source: `${SERVICE_NAME}.${instanceId}`,
                    original: evt,
                    reason: 'egress_delivery_failed'
                  });
                  const pubRes = this.getResource<PublisherResource>('publisher');
                  const prefix = cfg.busPrefix || '';
                  await pubRes?.create(`${prefix}${INTERNAL_DEADLETTER_V1}`).publishJson(dlqEvent);
                }
              }
              await ctx.ack();
            } catch (e: any) {
              const msg = e?.message || String(e);
              logger.error('ingress-egress.egress.generic.process_error', { subject: genericEgressSubject, error: msg });
              await ctx.ack();
            }
          }
        );
        logger.info('ingress-egress.egress.generic_subscribe.ok', { subject: genericEgressSubject });
      } catch (e: any) {
        logger.error('ingress-egress.egress.generic_subscribe.error', { subject: genericEgressSubject, error: e?.message || String(e) });
      }
    }

    // Debug endpoint exposes current snapshot
    this.onHTTPRequest('/_debug/twitch', (_req: Request, res: Response) => {
      const snapshot = this.twitchClient!.getSnapshot();
      res.status(200).json({ snapshot, egressTopic });
    });

    // IE-DIS-07: Discord debug endpoint exposing sanitized connector snapshot (no secrets)
    this.onHTTPRequest('/_debug/discord', (_req: Request, res: Response) => {
      try {
        const manager = this.connectorManager;
        const snapshots = manager ? manager.getSnapshot() : {} as any;
        const discordSnap = (snapshots as any)?.discord || { state: 'DISCONNECTED' };
        // Sanitize: remove any unexpected sensitive fields if present
        const { token, botToken, secret, ...safe } = (discordSnap || {}) as Record<string, unknown>;
        res.status(200).json({ snapshot: safe, egressTopic });
      } catch (e: any) {
        res.status(200).json({ snapshot: { state: 'ERROR', lastError: { message: e?.message || String(e) } }, egressTopic });
      }
    });

    // Twilio debug endpoint
    this.onHTTPRequest('/_debug/twilio', (_req: Request, res: Response) => {
      try {
        if (!this.twilioClient) {
          res.status(200).json({ snapshot: { state: 'DISABLED' }, egressTopic });
          return;
        }
        const snapshot = this.twilioClient.getSnapshot();
        res.status(200).json({ snapshot, egressTopic });
      } catch (e: any) {
        res.status(200).json({ snapshot: { state: 'ERROR', lastError: { message: e?.message || String(e) } }, egressTopic });
      }
    });

    // Start status change monitoring
    this.startStatusMonitoring();

    // Subscribe to moderation events
    if (!isTestEnv) {
      this.setupModerationSubscription(cfg);
    }
  }

  private async processEgress(evt: any, destinationTopic: string): Promise<'DELIVERED' | 'IGNORED' | 'FAILED'> {
    const tracer = (this as any).getTracer?.();
    const run = async (): Promise<'DELIVERED' | 'IGNORED' | 'FAILED'> => {
      logger.debug('ingress-egress.egress.received', { evt, destinationTopic });
      // Mark selected candidate on V2 events (if candidates exist) and log rationale
      let evtForDelivery: any = evt;
      try {
        if (evt && Array.isArray(evt.candidates) && evt.candidates.length > 0) {
          const best = selectBestCandidate(evt.candidates);
          if (best) {
            logger.info('ingress-egress.egress.candidate_selected', {
              correlationId: evt?.correlationId || evt?.envelope?.correlationId,
              candidateId: best.id,
              priority: best.priority,
              confidence: best.confidence,
              createdAt: best.createdAt,
            });
          }
          evtForDelivery = markSelectedCandidate(evt);
        }
      } catch (e: any) {
        logger.debug('ingress-egress.egress.candidate_mark_skip', { reason: e?.message || String(e) });
      }

      const text = extractEgressTextFromEvent(evtForDelivery);
      if (!text) {
        logger.warn('ingress-egress.egress.invalid_payload', { correlationId: evt?.correlationId });
        return 'FAILED';
      }
      const correlationId = evt?.correlationId;
      const publishFinalize = async (status: 'SENT' | 'FAILED', error?: { code: string; message?: string }) => {
        try {
          const cfg: any = this.getConfig?.() || {};
          const prefix: string = String(cfg.busPrefix || process.env.BUS_PREFIX || '');
          const finalizeSubject = `${prefix}internal.persistence.finalize.v1`;
          const pubRes = this.getResource<PublisherResource>('publisher');
          const pub = pubRes?.create(finalizeSubject);
          if (pub) {
            const payload = {
              correlationId,
              destination: destinationTopic,
              deliveredAt: new Date().toISOString(),
              status,
              error: error ? { code: error.code, message: error.message } : undefined,
              candidates: Array.isArray((evtForDelivery as any)?.candidates) ? (evtForDelivery as any).candidates : undefined,
              annotations: Array.isArray((evt as any)?.annotations) ? (evt as any).annotations : undefined,
            };
            await pub.publishJson(payload, { correlationId: String(correlationId || ''), type: 'egress.deliver.v1' });
            logger.info('ingress-egress.finalize.published', { correlationId, status });
          } else {
            logger.warn('ingress-egress.finalize.publisher_unavailable');
          }
        } catch (e: any) {
          logger.warn('ingress-egress.finalize.publish_error', { error: e?.message || String(e) });
        }
      };

      try {
        const source = (evt?.ingress?.source || '').toLowerCase();
        const annotations = Array.isArray(evt?.annotations) ? evt.annotations : [];
        const egressDest = (evt?.egress?.destination || '').toLowerCase();
        const authProvider = (evt?.identity?.auth?.provider || '').toLowerCase();

        const isDiscord = egressDest === 'discord' || source.includes('discord') || authProvider === 'discord' || annotations.some((a: any) => a.kind === 'custom' && a.source === 'discord');
        const isTwilio = egressDest === 'twilio' || source.includes('twilio') || authProvider === 'twilio' || annotations.some((a: any) => a.kind === 'custom' && a.source === 'twilio');

        if (isDiscord) {
          if (this.discordClient) {
            // Check if Discord client is connected; if not, return IGNORED to avoid false FAILED in broadcast
            const snap = this.discordClient.getSnapshot();
            if (snap.state !== 'CONNECTED') {
              logger.debug('ingress-egress.egress.discord.ignored_disconnected', { correlationId });
              return 'IGNORED';
            }
            await this.discordClient.sendText(text, evt.ingress?.channel || evt.channel);
          } else {
            return 'IGNORED';
          }
        } else if (isTwilio) {
          if (this.twilioClient) {
            await this.twilioClient.sendText(text, evt.ingress?.channel || evt.channel);
          } else {
            return 'IGNORED';
          }
        } else {
          // Default to Twitch
          if (!this.twitchClient) return 'IGNORED';
          
          const egressType = evt?.egress?.type || 'chat';
          let targetUserId = evt?.identity?.user?.id || evt?.identity?.external?.id;
          if (targetUserId && targetUserId.includes(':')) {
            targetUserId = targetUserId.split(':')[1];
          }

          logger.debug('ingress-egress.egress.twitch.start', {evt});

          if (egressType === 'dm' && targetUserId) {
            logger.info('ingress-egress.egress.twitch.routing_to_whisper', { correlationId, targetUserId });
            await this.twitchClient.sendWhisper(text, targetUserId);
          } else {
            if (egressType === 'dm' && !targetUserId) {
              logger.warn('ingress-egress.egress.twitch.dm_requested_but_no_userId', { correlationId });
            }
            await this.twitchClient.sendText(text, evt.ingress?.channel || evt.channel);
          }
        }
        logger.info('ingress-egress.egress.sent', { correlationId, source, isDiscord, isTwilio });
        await publishFinalize('SENT');
        return 'DELIVERED';
      } catch (e: any) {
        // If the error indicates the target was not found on this instance/client, return IGNORED
        const msg = (e?.message || String(e)).toLowerCase();
        if (msg.includes('not_connected') || msg.includes('not_found') || msg.includes('no_channel')) {
          logger.debug('ingress-egress.egress.ignored_not_found', { correlationId, error: e.message });
          return 'IGNORED';
        }

        logger.error('ingress-egress.egress.delivery_error', { correlationId, error: e.message });
        await publishFinalize('FAILED', { code: 'send_error', message: e?.message || String(e) });
        
        // Return FAILED to caller so they can DLQ if appropriate
        return 'FAILED';
      }
    };

    if (tracer && typeof tracer.startActiveSpan === 'function') {
      return await tracer.startActiveSpan('deliver-egress', async (span: any) => {
        try {
          return await run();
        } finally {
          span.end();
        }
      });
    } else {
      return await run();
    }
  }

  private async setupModerationSubscription(cfg: any) {
    const inputSubject = `${cfg.busPrefix || ''}internal.ingress.v1`;
    logger.info('ingress-egress.moderation_subscribe.start', { subject: inputSubject });

    try {
      await this.onMessage<any>(
        { destination: `internal.ingress.v1`, queue: `ingress-egress-moderation`, ack: 'explicit' },
        async (evt: any, _attributes: AttributeMap, ctx: { ack: () => Promise<void>; nack: (requeue?: boolean) => Promise<void> }) => {
          try {
            if (evt.type !== 'moderation.action.v1') {
              // Not a moderation event, might be shared topic. Ignore if not matching.
              await ctx.ack();
              return;
            }

            const { action, platform, platformUserId, reason } = evt.payload || {};
            if (action === 'ban' && platform && platformUserId) {
              logger.info('ingress-egress.moderation.ban_request', { platform, platformUserId, reason });
              
              const connector = this.connectorManager?.getConnectorByPlatform(platform);
              if (connector && typeof (connector as any).banUser === 'function') {
                await (connector as any).banUser(platformUserId, reason);
                logger.info('ingress-egress.moderation.ban_success', { platform, platformUserId });
              } else {
                logger.warn('ingress-egress.moderation.connector_unsupported', { platform });
              }
            }

            await ctx.ack();
          } catch (e: any) {
            logger.error('ingress-egress.moderation.process_error', { error: e.message });
            await ctx.ack(); // Don't retry moderation actions indefinitely
          }
        }
      );
    } catch (e: any) {
      logger.error('ingress-egress.moderation_subscribe.error', { error: e.message });
    }
  }

  private startStatusMonitoring() {
    if (this.statusTimer) return;
    // Perform an initial check immediately to record baseline
    this.checkStatusChanges().catch(e => logger.warn('ingress-egress.initial_status_check_failed', { error: e.message }));
    // Then check periodically for changes
    this.statusTimer = setInterval(() => this.checkStatusChanges(), 15000); // Check every 15s
  }

  private async checkStatusChanges() {
    if (!this.connectorManager) return;
    const snapshots = this.connectorManager.getSnapshot();
    for (const [name, snap] of Object.entries(snapshots)) {
      const state = (snap as any).state;
      if (this.lastStates[name] !== state) {
        logger.info('ingress-egress.status_change', { name, from: this.lastStates[name] || 'NONE', to: state });
        this.lastStates[name] = state;
        await this.publishStatus(name, snap);
      }
    }
  }

  private async publishStatus(name: string, snap: any) {
    try {
      const pubRes = this.getResource<PublisherResource>('publisher');
      if (!pubRes) return;

      const cfg = this.getConfig();
      const prefix = cfg.busPrefix || '';
      const subject = `internal.ingress.v1`;
      const publisher = pubRes.create(`${prefix}${subject}`);

      // Derive platform and id
      const platform = name.split('-')[0]; // 'twitch' from 'twitch' or 'twitch-eventsub'
      const id = (snap as any).id || (platform === 'twitch' ? process.env.TWITCH_BOT_USERNAME : undefined) || name;

      const evt: any = {
        v: '2',
        ingress: {
          ingressAt: new Date().toISOString(),
          source: `ingress.${name}`,
        },
        identity: {
          external: {
            id: id,
            platform: platform,
          }
        },
        correlationId: `status-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'system.source.status',
        payload: {
          platform,
          id,
          status: snap.state,
          displayName: (snap as any).displayName || name,
          metrics: snap.counters,
          lastError: snap.lastError,
          authStatus: (snap as any).authStatus || 'VALID',
          metadata: {
            ...snap
          }
        }
      };

      await publisher.publishJson(evt, {
        type: 'system.source.status',
        source: SERVICE_NAME,
        correlationId: evt.correlationId
      });
    } catch (e: any) {
      logger.warn('ingress-egress.publish_status_failed', { name, error: e.message });
    }
  }

  public async stop(): Promise<void> {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    // ... rest of stop logic if any, but BaseServer handles mostly
    await super.close();
  }
}

export function createApp() {
  const server = new IngressEgressServer();
  return server.getApp();
}

if (require.main === module) {
  BaseServer.ensureRequiredEnv(SERVICE_NAME);
  const server = new IngressEgressServer();
  void server.start(PORT);
}

// text extraction now lives in services/egress/selection.ts
