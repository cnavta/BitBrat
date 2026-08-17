/**
 * Twitch Connector Factory
 *
 * Factory function for creating Twitch connectors with IntegrationBit.
 *
 * Sprint 13: YAML-driven event gateway integration
 * - Supports feature flag ENABLE_CONFIG_REGISTRY for gradual rollout
 * - Falls back to custom builder (TwitchEnvelopeBuilder) when flag disabled
 * - Loads YAML configs from config/platforms/twitch/ when enabled
 *
 * Sprint 16 (M5): EventSub integration
 * - Creates both IRC and EventSub clients
 * - EventSub enabled via ENABLE_EVENTSUB_YAML_CONFIG flag
 * - Dual-client management via TwitchConnectorAdapter
 *
 * @module twitch/factory
 * @since Sprint 12
 */

import type { ConnectorFactory } from '../../../common/integration-bit';
import { TwitchIrcClient } from './twitch-irc-client';
import { TwitchEventSubClient } from './eventsub-client';
import { TwitchEnvelopeBuilder, type IEnvelopeBuilder, type IrcMessageMeta, type EnvelopeBuilderOptions } from './envelope-builder';
import { TwitchConnectorAdapter } from './connector-adapter';
import { ConfigTwitchCredentialsProvider, FirestoreTwitchCredentialsProvider } from './credentials-provider';
import { createTwitchIngressPublisherFromConfig } from './publisher';
import { createTokenStore } from '../../firestore-token-store';
import { ConfigRegistry } from '../core/config-registry';
import { TranslationEngine } from '../core/translation-engine';
import { getFeatureFlags } from '../core/feature-flags';
import { logger } from '../../../common/logging';
import type { IConfig } from '../../../types';
import type { InternalEventV2 } from '../../../types/events';
import path from 'path';

/**
 * TranslationEngine-based envelope builder wrapper for Twitch
 * Implements IEnvelopeBuilder interface using TranslationEngine
 *
 * NOTE: build() returns Promise<InternalEventV2> because TranslationEngine.translateInbound is async.
 * Twitch client must await the result.
 */
class TranslationEngineEnvelopeBuilder implements IEnvelopeBuilder {
  constructor(private readonly engine: TranslationEngine) {}

  build(msg: IrcMessageMeta, opts?: EnvelopeBuilderOptions): InternalEventV2 {
    // Twitch IRC uses 'PRIVMSG' as platform event
    const platformEvent = 'PRIVMSG';

    // Convert IrcMessageMeta to format expected by TranslationEngine
    const meta = {
      ...msg,
      // Ensure message field compatibility
      message: msg.text,
    };

    // Return async result - caller must await
    return this.engine.translateInbound('twitch', platformEvent, meta, opts) as any;
  }
}

/**
 * Creates a Twitch connector configured for the IntegrationBit framework.
 *
 * Credentials resolution:
 * 1. If documentStore provided → FirestoreTwitchCredentialsProvider (persistent: PostgreSQL/Firestore)
 * 2. Otherwise → ConfigTwitchCredentialsProvider (environment variables)
 *
 * When documentStore is provided, createTokenStore() auto-selects:
 * - PostgresTokenStore when PERSISTENCE_DRIVER=postgres
 * - FirestoreTokenStore when PERSISTENCE_DRIVER=firestore
 *
 * @example
 * ```typescript
 * import { createTwitchConnector } from './twitch/factory';
 *
 * const config: IntegrationBitConfig = {
 *   serviceName: 'twitch-ingress',
 *   connectors: [
 *     { name: 'twitch', factory: createTwitchConnector }
 *   ]
 * };
 * ```
 *
 * @param config - Platform configuration (IConfig)
 * @param opts - Factory options
 * @param opts.egressDestinationTopic - Topic for egress messages
 * @param opts.publisherFactory - Function to create publishers for specific topics
 * @param opts.documentStore - Optional document store for persistent credentials (PostgreSQL/Firestore)
 * @returns Promise resolving to configured TwitchConnectorAdapter
 */
export const createTwitchConnector: ConnectorFactory = async (config: IConfig, opts) => {
  const { egressDestinationTopic, publisherFactory, documentStore } = opts;

  // Create publisher for ingress events
  // IMPORTANT: Always use createTwitchIngressPublisherFromConfig wrapper
  // It wraps MessagePublisher (publishJson) with IngressPublisher interface (publish)
  const publisher = createTwitchIngressPublisherFromConfig(config, publisherFactory);

  // Use persistent credentials from PostgreSQL or Firestore if documentStore is available
  // Falls back to config-based credentials (environment variables) if no persistence available
  const usePersistentCredentials = !!documentStore;
  const credentialsProvider = usePersistentCredentials
    ? new FirestoreTwitchCredentialsProvider(
        config,
        createTokenStore(config.tokenDocPath || 'oauth/twitch/bot', documentStore),
        createTokenStore('oauth/twitch/broadcaster', documentStore)
      )
    : new ConfigTwitchCredentialsProvider(config);

  // Parse debug authorized users from config (comma-separated, auto-prefix with 'twitch:')
  const debugUsers = (config.debugUsersTwitch || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .map(u => u.startsWith('twitch:') ? u : `twitch:${u}`);

  // Sprint 13: Check feature flag for YAML-driven event gateway
  const flags = getFeatureFlags();
  let envelopeBuilder: IEnvelopeBuilder;

  if (flags.ENABLE_CONFIG_REGISTRY) {
    logger.info('twitch.factory.translation_engine.enabled', {
      configPath: 'config',
      featureFlags: flags,
    });

    try {
      // Load YAML configs from config/ (registry will find config/events/ and config/platforms/twitch/)
      const configPath = path.join(process.cwd(), 'config');
      const registry = new ConfigRegistry({ configPath });
      await registry.load();

      logger.info('twitch.factory.config_registry.loaded', {
        platform: 'twitch',
      });

      // Create TranslationEngine for Twitch
      const engine = new TranslationEngine(registry);

      // Wrap TranslationEngine in IEnvelopeBuilder adapter
      envelopeBuilder = new TranslationEngineEnvelopeBuilder(engine);

      logger.info('twitch.factory.translation_engine.initialized', {
        platform: 'twitch',
        useGenericBuilder: flags.ENABLE_GENERIC_BUILDER,
      });
    } catch (error: any) {
      // Fail-safe: Fall back to custom builder if YAML loading fails
      logger.error('twitch.factory.translation_engine.failed', {
        error: error.message,
        fallback: 'TwitchEnvelopeBuilder',
      });
      envelopeBuilder = new TwitchEnvelopeBuilder();
    }
  } else {
    // Feature flag disabled: Use custom builder (legacy behavior)
    logger.info('twitch.factory.custom_builder.enabled', {
      builder: 'TwitchEnvelopeBuilder',
      featureFlags: flags,
    });
    envelopeBuilder = new TwitchEnvelopeBuilder();
  }

  // Create Twitch IRC client
  const client = new TwitchIrcClient(
    envelopeBuilder,
    publisher,
    config.twitchChannels || [],
    {
      cfg: config,
      credentialsProvider,
      egressDestinationTopic,
      debugUsers,
    }
  );

  // Sprint 16 (M5-INT-1): Create EventSub client for Twitch platform events
  // EventSub handles follows, subs, raids, channel points, moderation, etc.
  // IRC handles chat messages (realtime bidirectional)
  // Both run concurrently when ENABLE_EVENTSUB_YAML_CONFIG=true
  const eventSubClient = new TwitchEventSubClient(
    publisher,
    config.twitchChannels || [],
    {
      cfg: config,
      credentialsProvider,
      egressDestinationTopic,
    }
  );

  const useYamlConfig = process.env.ENABLE_EVENTSUB_YAML_CONFIG === 'true';
  logger.info('twitch.factory.clients_created', {
    irc: true,
    eventSub: true,
    eventSubYamlConfig: useYamlConfig,
    channels: config.twitchChannels,
  });

  // Wrap both clients with connector adapter (dual-client management)
  return new TwitchConnectorAdapter(client, eventSubClient);
};
