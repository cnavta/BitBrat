/**
 * IntegrationBit - Generic Platform Integration Wrapper
 *
 * A reusable base class for building platform integration bits (Twitch, Discord, Slack, etc.)
 * that handles lifecycle management, webhooks, egress routing, and observability.
 *
 * @module integration-bit
 * @since Sprint 12
 */

import { Bit } from './base-server';
import { ConnectorManager } from '../services/ingress/core/connector-manager';
import type { IngressConnector, WebhookConnector, EgressConnector } from '../services/ingress/core';
import type { IConfig } from '../types';
import type { InternalEventV2 } from '../types/events';
import { extractEgressTextFromEvent } from './events/selection';
import type { PublisherResource } from './resources/publisher-manager';
import type { Request, Response } from 'express';

/**
 * Factory function for creating platform connectors.
 *
 * Takes configuration and options, returns a fully initialized IngressConnector.
 *
 * @example
 * ```typescript
 * import type { ConnectorFactory } from '../common/integration-bit';
 * import { TwitchIrcClient, TwitchConnectorAdapter } from '../services/ingress/twitch';
 *
 * export const createTwitchConnector: ConnectorFactory = async (config, opts) => {
 *   const { egressDestinationTopic, publisherFactory } = opts;
 *
 *   const publisher = publisherFactory?.('internal.ingress.v1');
 *   const client = new TwitchIrcClient(
 *     new TwitchEnvelopeBuilder(),
 *     publisher,
 *     config.twitchChannels,
 *     { egressDestinationTopic }
 *   );
 *
 *   return new TwitchConnectorAdapter(client);
 * };
 * ```
 *
 * @param config - Platform configuration (from IConfig)
 * @param opts - Factory options
 * @param opts.egressDestinationTopic - Topic for egress messages (e.g., "internal.egress.v1.instance-123")
 * @param opts.publisherFactory - Optional function to create publishers for specific topics
 * @param opts.documentStore - Optional document store for persistent credentials (PostgreSQL/Firestore)
 * @returns Promise resolving to configured IngressConnector
 */
export type ConnectorFactory = (
  config: any,
  opts: {
    egressDestinationTopic: string;
    publisherFactory?: (topic: string) => any;
    documentStore?: any;
  }
) => Promise<IngressConnector>;

/**
 * Configuration for IntegrationBit.
 *
 * Defines which connectors to load and how to configure them.
 *
 * @example
 * ```typescript
 * // Multi-platform integration (current ingress-egress)
 * const config: IntegrationBitConfig = {
 *   serviceName: 'ingress-egress',
 *   connectors: [
 *     { name: 'twitch', factory: createTwitchConnector },
 *     { name: 'discord', factory: createDiscordConnector },
 *     { name: 'slack', factory: createSlackConnector },
 *     { name: 'twilio', factory: createTwilioConnector },
 *   ]
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Single-platform integration (standalone Twitch)
 * const config: IntegrationBitConfig = {
 *   serviceName: 'twitch-ingress',
 *   connectors: [
 *     { name: 'twitch', factory: createTwitchConnector }
 *   ]
 * };
 * ```
 */
export interface IntegrationBitConfig {
  /**
   * Service name (used for logging, metrics, instance identification)
   */
  serviceName: string;

  /**
   * Array of connector configurations.
   *
   * Each connector is instantiated via its factory function and registered
   * with the ConnectorManager.
   */
  connectors: Array<{
    /**
     * Connector name (used for routing and identification)
     *
     * Examples: 'twitch', 'discord', 'twitch-broadcaster'
     */
    name: string;

    /**
     * Factory function that creates the connector
     */
    factory: ConnectorFactory;

    /**
     * Whether this connector is enabled (default: true)
     *
     * Disabled connectors are skipped during registration.
     * Useful for runtime configuration-based enablement.
     */
    enabled?: boolean;
  }>;
}

/**
 * IntegrationBit - Generic wrapper for platform integrations.
 *
 * Extends the Bit base class to provide standardized lifecycle management,
 * webhook routing, egress handling, and observability for platform connectors.
 *
 * Supports both multi-platform (integrated) and single-platform (standalone) modes
 * via the same codebase - controlled by connector array configuration.
 *
 * @example
 * ```typescript
 * // Multi-platform mode (current ingress-egress)
 * const service = new IntegrationBit({
 *   serviceName: 'ingress-egress',
 *   connectors: [
 *     { name: 'twitch', factory: createTwitchConnector },
 *     { name: 'discord', factory: createDiscordConnector },
 *     { name: 'slack', factory: createSlackConnector },
 *     { name: 'twilio', factory: createTwilioConnector },
 *   ]
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Single-platform mode (standalone)
 * const service = new IntegrationBit({
 *   serviceName: 'twitch-ingress',
 *   connectors: [
 *     { name: 'twitch', factory: createTwitchConnector }
 *   ]
 * });
 * ```
 */
export class IntegrationBit extends Bit {
  private connectorManager: ConnectorManager;
  private instanceId: string;
  private egressTopic: string;
  private statusMonitorInterval?: NodeJS.Timeout;
  private lastConnectorSnapshots: Map<string, any> = new Map();
  private integrationConfig: IntegrationBitConfig;
  private registrationPromise?: Promise<void>;
  private egressRoutingPromise?: Promise<void>;

  constructor(config: IntegrationBitConfig) {
    super({ serviceName: config.serviceName });
    this.integrationConfig = config;

    // Resolve instance ID from environment or generate fallback
    this.instanceId = this.resolveInstanceId();

    // Generate instance-specific egress topic
    this.egressTopic = `internal.egress.v1.${this.instanceId}`;

    // Initialize connector manager with logger
    this.connectorManager = new ConnectorManager({ logger: this.getLogger() });

    this.getLogger().info('integration-bit.initialized', {
      serviceName: this.integrationConfig.serviceName,
      instanceId: this.instanceId,
      egressTopic: this.egressTopic,
      connectorCount: this.integrationConfig.connectors.length,
    });

    // Register connectors (async, track promise for startup hook)
    this.registrationPromise = this.registerConnectors();

    // Setup webhook routing (synchronous)
    this.setupWebhookRouting();

    // Setup egress routing (async, track promise for startup hook)
    this.egressRoutingPromise = this.setupEgressRouting();

    // Setup status monitoring (synchronous)
    this.setupStatusMonitoring();

    // Setup debug endpoints (synchronous)
    this.setupDebugEndpoints();

    // Register startup hook to complete async initialization and start connectors
    this.onStartup(async () => {
      const logger = this.getLogger();

      // CRITICAL: Wait for async initialization to complete before starting connectors
      logger.debug('integration-bit.awaiting-initialization');

      try {
        // Wait for connector registration to complete
        if (this.registrationPromise) {
          await this.registrationPromise;
          logger.debug('integration-bit.registration-complete');
        }

        // Wait for egress routing setup to complete
        if (this.egressRoutingPromise) {
          await this.egressRoutingPromise;
          logger.debug('integration-bit.egress-routing-complete');
        }

        // Now safe to start connectors
        logger.info('integration-bit.starting-connectors');
        await this.connectorManager.start();
        logger.info('integration-bit.connectors-started');
      } catch (error) {
        logger.error('integration-bit.startup-failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Don't throw - fail-open strategy
      }
    });
  }

  /**
   * Resolves the instance ID for this integration bit.
   *
   * Priority order:
   * 1. INSTANCE_ID environment variable (explicit instance ID)
   * 2. K_SERVICE + K_REVISION (Cloud Run)
   * 3. SERVICE_NAME + '-' + random suffix (fallback)
   *
   * @returns Instance ID string
   * @private
   */
  private resolveInstanceId(): string {
    // Explicit instance ID (highest priority)
    if (process.env.INSTANCE_ID) {
      return process.env.INSTANCE_ID;
    }

    // Cloud Run auto-detection
    if (process.env.K_SERVICE && process.env.K_REVISION) {
      return `${process.env.K_SERVICE}-${process.env.K_REVISION}`;
    }

    // Fallback: service name + random suffix
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    return `${this.integrationConfig.serviceName}-${randomSuffix}`;
  }

  /**
   * Registers all enabled connectors with the ConnectorManager.
   *
   * Implements fail-open strategy: if a connector fails to register,
   * it's logged and skipped, but other connectors continue registering.
   *
   * @private
   */
  private async registerConnectors(): Promise<void> {
    const logger = this.getLogger();

    logger.info('integration-bit.registering-connectors', {
      total: this.integrationConfig.connectors.length,
    });

    for (const connectorConfig of this.integrationConfig.connectors) {
      const { name, factory, enabled = true } = connectorConfig;

      // Skip disabled connectors
      if (!enabled) {
        logger.info('integration-bit.connector-disabled', { connector: name });
        continue;
      }

      try {
        logger.debug('integration-bit.connector-registering', { connector: name });

        // Get documentStore for persistent credentials (PostgreSQL/Firestore)
        const documentStore = this.getResource('documentStore') || this.getResource('firestore');

        // Call factory function to instantiate connector
        const connector = await factory(this.getConfig(), {
          egressDestinationTopic: this.egressTopic,
          publisherFactory: (topic: string) => {
            const pubRes = this.getResource<PublisherResource>('publisher');
            return pubRes ? pubRes.create(topic) : undefined;
          },
          documentStore, // Pass documentStore for persistent credentials
        });

        // Register with ConnectorManager
        this.connectorManager.register(name, connector);

        logger.info('integration-bit.connector-registered', {
          connector: name,
          platform: connector.getMetadata?.()?.platform || name,
        });
      } catch (error) {
        // Fail-open: log error but continue with other connectors
        logger.error('integration-bit.connector-registration-failed', {
          connector: name,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    logger.info('integration-bit.connectors-registered', {
      registered: this.connectorManager.getSnapshot().length,
    });
  }

  /**
   * Sets up generic webhook routing for all registered connectors.
   *
   * Registers a single POST /webhooks/:platform route that:
   * 1. Looks up the connector by platform name
   * 2. Verifies the webhook signature
   * 3. Delegates to the connector's handleWebhook method
   *
   * @private
   */
  private setupWebhookRouting(): void {
    const logger = this.getLogger();
    const app = this.getApp();

    app.post('/webhooks/:platform', async (req: Request, res: Response) => {
      const platform = req.params.platform;

      // Validate platform parameter
      if (!platform) {
        logger.warn('integration-bit.webhook-missing-platform');
        return res.status(400).json({ error: 'missing_platform' });
      }

      try {
        // Look up connector
        const connector = this.connectorManager.getConnectorByPlatform(platform);

        if (!connector) {
          logger.warn('integration-bit.webhook-unknown-platform', { platform });
          return res.status(404).json({ error: 'unknown_platform', platform });
        }

        // Check if connector supports webhooks
        const webhookConnector = connector as unknown as WebhookConnector;
        if (!webhookConnector.verifySignature || !webhookConnector.handleWebhook) {
          logger.warn('integration-bit.webhook-not-supported', { platform });
          return res.status(501).json({ error: 'webhooks_not_supported', platform });
        }

        // Verify signature
        const isValid = webhookConnector.verifySignature({
          method: req.method,
          url: req.url,
          headers: req.headers as Record<string, string>,
          body: req.body,
        });

        if (!isValid) {
          logger.warn('integration-bit.webhook-invalid-signature', { platform });
          return res.status(403).json({ error: 'invalid_signature' });
        }

        // Handle webhook
        const response = await webhookConnector.handleWebhook({
          method: req.method,
          url: req.url,
          headers: req.headers as Record<string, string>,
          body: req.body,
        });

        logger.info('integration-bit.webhook-handled', {
          platform,
          status: response.status,
        });

        return res.status(response.status).json(response.body);
      } catch (error) {
        logger.error('integration-bit.webhook-error', {
          platform,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        return res.status(500).json({ error: 'internal_error' });
      }
    });

    logger.info('integration-bit.webhook-routing-setup');
  }

  /**
   * Sets up egress message subscriptions.
   *
   * Subscribes to:
   * 1. Instance-specific topic: internal.egress.v1.{instanceId}
   * 2. Generic egress topic: internal.egress.v1
   *
   * Idempotency is enabled with 60s TTL to prevent duplicate message processing.
   * Subscriptions are skipped in test environments.
   *
   * @private
   */
  private async setupEgressRouting(): Promise<void> {
    const logger = this.getLogger();

    // Skip in test environment
    if (process.env.NODE_ENV === 'test') {
      logger.info('integration-bit.egress-routing-skipped', {
        reason: 'test_environment',
      });
      return;
    }

    try {
      // Subscribe to instance-specific egress topic
      await this.onMessage<InternalEventV2>(
        this.egressTopic,
        async (event, attrs, ctx) => {
          await this.processEgress(event);
          await ctx.ack();
        },
        {
          idempotency: {
            enabled: true,
            ttlSeconds: 60,
          },
        }
      );

      logger.info('integration-bit.egress-subscription-created', {
        topic: this.egressTopic,
        type: 'instance-specific',
      });

      // Subscribe to generic egress topic
      await this.onMessage<InternalEventV2>(
        'internal.egress.v1',
        async (event, attrs, ctx) => {
          await this.processEgress(event);
          await ctx.ack();
        },
        {
          idempotency: {
            enabled: true,
            ttlSeconds: 60,
          },
        }
      );

      logger.info('integration-bit.egress-subscription-created', {
        topic: 'internal.egress.v1',
        type: 'generic',
      });
    } catch (error) {
      logger.error('integration-bit.egress-routing-error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Processes egress messages by routing them to the appropriate connector.
   *
   * Flow:
   * 1. Extract platform from evt.egress.connector (explicit routing)
   * 2. Look up connector by platform name
   * 3. Extract text from event using extractEgressTextFromEvent()
   * 4. Call connector's sendText() method
   *
   * @param event - Egress event to process
   * @private
   */
  private async processEgress(event: InternalEventV2): Promise<void> {
    const logger = this.getLogger();
    const correlationId = event.correlationId;

    try {
      // Extract platform from egress metadata (explicit routing)
      const platform = event.egress?.connector;

      if (!platform) {
        logger.warn('integration-bit.egress-missing-connector', {
          correlationId,
          egressMetadata: event.egress,
        });
        return;
      }

      // Look up connector
      const connector = this.connectorManager.getConnectorByPlatform(platform);

      if (!connector) {
        logger.warn('integration-bit.egress-unknown-platform', {
          correlationId,
          platform,
        });
        return;
      }

      // Extract text from event
      const text = extractEgressTextFromEvent(event);

      if (!text) {
        logger.warn('integration-bit.egress-missing-text', {
          correlationId,
          platform,
        });
        return;
      }

      // Extract target channel (optional)
      const targetChannel = event.egress?.channel || event.ingress?.channel;

      // Send text via connector
      const egressConnector = connector as unknown as EgressConnector;
      if (!egressConnector.sendText) {
        logger.error('integration-bit.egress-not-supported', {
          correlationId,
          platform,
        });
        return;
      }

      await egressConnector.sendText(text, targetChannel);

      logger.info('integration-bit.egress-sent', {
        correlationId,
        platform,
        targetChannel,
        textLength: text.length,
      });
    } catch (error) {
      logger.error('integration-bit.egress-error', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Sets up periodic status monitoring for all connectors.
   *
   * Runs immediately and then every 15 seconds to:
   * 1. Get current snapshots from all connectors
   * 2. Compare with previous snapshots
   * 3. Publish status change events to internal.ingress.v1
   *
   * @private
   */
  private setupStatusMonitoring(): void {
    const logger = this.getLogger();
    const STATUS_CHECK_INTERVAL = 15000; // 15 seconds

    const checkAndPublishStatusChanges = async () => {
      try {
        const snapshotsMap = this.connectorManager.getSnapshot();
        const snapshots = Object.values(snapshotsMap);

        for (const snapshot of snapshots) {
          const { platform, state } = snapshot;
          const platformStr = String(platform);
          const lastSnapshot = this.lastConnectorSnapshots.get(platformStr);

          // Check if state changed
          if (lastSnapshot && lastSnapshot.state !== state) {
            logger.info('integration-bit.status-change', {
              platform: platformStr,
              previousState: lastSnapshot.state,
              currentState: state,
            });

            // Publish status change event
            try {
              const pubRes = this.getResource<PublisherResource>('publisher');
              const publisher = pubRes ? pubRes.create('internal.ingress.v1') : undefined;
              if (publisher) {
                await publisher.publishJson({
                  type: 'connector.status.changed',
                  connector: platformStr,
                  previousState: lastSnapshot.state,
                  currentState: state,
                  timestamp: new Date().toISOString(),
                  instanceId: this.instanceId,
                });
              }
            } catch (publishError) {
              logger.error('integration-bit.status-publish-error', {
                platform: platformStr,
                error: publishError instanceof Error ? publishError.message : String(publishError),
              });
            }
          }

          // Update last snapshot
          this.lastConnectorSnapshots.set(platformStr, snapshot);
        }
      } catch (error) {
        logger.error('integration-bit.status-check-error', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    };

    // Run immediately
    setImmediate(() => {
      checkAndPublishStatusChanges().catch((error) => {
        logger.error('integration-bit.status-initial-check-error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    // Run periodically
    this.statusMonitorInterval = setInterval(() => {
      checkAndPublishStatusChanges().catch((error) => {
        logger.error('integration-bit.status-periodic-check-error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, STATUS_CHECK_INTERVAL);

    logger.info('integration-bit.status-monitoring-setup', {
      intervalMs: STATUS_CHECK_INTERVAL,
    });
  }

  /**
   * Sets up debug HTTP endpoints for introspection and troubleshooting.
   *
   * Endpoints:
   * - GET /_debug/instance - Instance metadata
   * - GET /_debug/connectors - All connector snapshots
   * - GET /_debug/:platform - Specific platform snapshot
   *
   * @private
   */
  private setupDebugEndpoints(): void {
    const logger = this.getLogger();
    const app = this.getApp();

    // GET /_debug/instance
    app.get('/_debug/instance', (req: Request, res: Response) => {
      try {
        const instanceInfo = {
          serviceName: this.integrationConfig.serviceName,
          instanceId: this.instanceId,
          egressTopic: this.egressTopic,
          connectorCount: this.integrationConfig.connectors.length,
          connectors: this.integrationConfig.connectors.map(c => ({
            name: c.name,
            enabled: c.enabled !== false,
          })),
        };

        res.json(instanceInfo);
      } catch (error) {
        logger.error('integration-bit.debug-instance-error', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: 'internal_error' });
      }
    });

    // GET /_debug/connectors
    app.get('/_debug/connectors', (req: Request, res: Response) => {
      try {
        const snapshots = this.connectorManager.getSnapshot();
        res.json({ connectors: snapshots });
      } catch (error) {
        logger.error('integration-bit.debug-connectors-error', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: 'internal_error' });
      }
    });

    // GET /_debug/:platform
    app.get('/_debug/:platform', (req: Request, res: Response) => {
      const platform = req.params.platform;

      try {
        const connector = this.connectorManager.getConnectorByPlatform(platform);

        if (!connector) {
          logger.warn('integration-bit.debug-unknown-platform', { platform });
          return res.status(404).json({ error: 'unknown_platform', platform });
        }

        const snapshot = connector.getSnapshot();
        res.json(snapshot);
      } catch (error) {
        logger.error('integration-bit.debug-platform-error', {
          platform,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: 'internal_error' });
      }
    });

    logger.info('integration-bit.debug-endpoints-setup');
  }

  /**
   * Override the close() lifecycle method to gracefully shutdown.
   *
   * Shutdown sequence:
   * 1. Wait for any in-flight initialization to complete
   * 2. Clear status monitoring interval
   * 3. Stop all connectors
   * 4. Call parent close() to run shutdown hooks and unsubscribe
   *
   * @override
   */
  async close(): Promise<void> {
    const logger = this.getLogger();

    logger.info('integration-bit.closing');

    try {
      // Wait for any in-flight async initialization to complete
      // This prevents shutting down while still initializing
      if (this.registrationPromise) {
        logger.debug('integration-bit.awaiting-registration-completion');
        await this.registrationPromise.catch((err) => {
          logger.warn('integration-bit.registration-failed-during-shutdown', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      if (this.egressRoutingPromise) {
        logger.debug('integration-bit.awaiting-egress-routing-completion');
        await this.egressRoutingPromise.catch((err) => {
          logger.warn('integration-bit.egress-routing-failed-during-shutdown', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Clear status monitoring interval
      if (this.statusMonitorInterval) {
        clearInterval(this.statusMonitorInterval);
        this.statusMonitorInterval = undefined;
        logger.debug('integration-bit.status-monitor-cleared');
      }

      // Stop all connectors gracefully
      logger.info('integration-bit.stopping-connectors');
      await this.connectorManager.stop();
      logger.info('integration-bit.connectors-stopped');
    } catch (error) {
      logger.error('integration-bit.close-error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Continue with shutdown even if errors occur
    }

    // Call parent close() to run shutdown hooks, unsubscribe, and close resources
    await super.close();

    logger.info('integration-bit.closed');
  }
}
