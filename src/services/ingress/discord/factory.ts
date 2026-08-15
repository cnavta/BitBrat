/**
 * Discord Connector Factory
 *
 * Factory function for creating Discord connectors with IntegrationBit.
 *
 * Sprint 13: YAML-driven event gateway integration
 * - Supports feature flag ENABLE_CONFIG_REGISTRY for gradual rollout
 * - Falls back to custom builder (buildDiscordEnvelope) when flag disabled
 * - Loads YAML configs from config/platforms/discord/ when enabled
 *
 * @module discord/factory
 * @since Sprint 12
 */

import type { ConnectorFactory } from '../../../common/integration-bit';
import { DiscordIngressClient } from './discord-ingress-client';
import { buildDiscordEnvelope } from './envelope-builder';
import { DiscordConnectorAdapter } from './connector-adapter';
import { createDiscordIngressPublisherFromConfig } from './publisher';
import { createAuthTokenStore } from '../../oauth/auth-token-store';
import { ConfigRegistry } from '../core/config-registry';
import { TranslationEngine } from '../core/translation-engine';
import { getFeatureFlags } from '../core/feature-flags';
import { logger } from '../../../common/logging';
import type { IConfig } from '../../../types';
import path from 'path';

/**
 * Creates a Discord connector configured for the IntegrationBit framework.
 *
 * Architecture:
 * - Uses Discord Gateway API (WebSocket) for real-time messaging
 * - Optional Interactions API (webhooks) for slash commands
 * - Auth token store for OAuth2 token management
 *
 * Credentials resolution:
 * - If documentStore provided → Uses same persistence backend as service (PostgreSQL/Firestore)
 * - Otherwise → Auto-selects based on PERSISTENCE_DRIVER environment variable
 *
 * @example
 * ```typescript
 * import { createDiscordConnector } from './discord/factory';
 *
 * const config: IntegrationBitConfig = {
 *   serviceName: 'discord-ingress',
 *   connectors: [
 *     { name: 'discord', factory: createDiscordConnector }
 *   ]
 * };
 * ```
 *
 * @param config - Platform configuration (IConfig)
 * @param opts - Factory options
 * @param opts.egressDestinationTopic - Topic for egress messages
 * @param opts.publisherFactory - Function to create publishers for specific topics
 * @param opts.documentStore - Optional document store for persistent credentials (PostgreSQL/Firestore)
 * @returns Promise resolving to configured DiscordConnectorAdapter
 */
export const createDiscordConnector: ConnectorFactory = async (config: IConfig, opts) => {
  const { egressDestinationTopic, publisherFactory, documentStore } = opts;

  // Create publisher for ingress events
  // IMPORTANT: Always use createDiscordIngressPublisherFromConfig wrapper
  // It wraps MessagePublisher (publishJson) with IngressPublisher interface (publish)
  const publisher = createDiscordIngressPublisherFromConfig(config, publisherFactory);

  // Create auth token store for OAuth2 token management
  // Pass documentStore to ensure same persistence backend as service
  const tokenStore = createAuthTokenStore(documentStore);

  // Sprint 13: Check feature flag for YAML-driven event gateway
  const flags = getFeatureFlags();
  let envelopeBuilder: typeof buildDiscordEnvelope;

  if (flags.ENABLE_CONFIG_REGISTRY) {
    logger.info('discord.factory.translation_engine.enabled', {
      configPath: 'config',
      featureFlags: flags,
    });

    try {
      // Load YAML configs from config/ (registry will find config/events/ and config/platforms/discord/)
      const configPath = path.join(process.cwd(), 'config');
      const registry = new ConfigRegistry({ configPath });
      await registry.load();

      logger.info('discord.factory.config_registry.loaded', {
        platform: 'discord',
      });

      // Create TranslationEngine for Discord
      const engine = new TranslationEngine(registry);

      // Wrap translateInbound as envelope builder function
      // NOTE: TranslationEngine.translateInbound is async, but custom builder is sync
      // We wrap it to match the signature, but Discord client will need to await it
      envelopeBuilder = ((meta, builderOpts) => {
        // Extract platform event name (MESSAGE_CREATE for Discord Gateway)
        const platformEvent = 'MESSAGE_CREATE';

        // Call async translateInbound - caller must await this
        return engine.translateInbound('discord', platformEvent, meta, builderOpts) as any;
      }) as typeof buildDiscordEnvelope;

      logger.info('discord.factory.translation_engine.initialized', {
        platform: 'discord',
        useGenericBuilder: flags.ENABLE_GENERIC_BUILDER,
      });
    } catch (error: any) {
      // Fail-safe: Fall back to custom builder if YAML loading fails
      logger.error('discord.factory.translation_engine.failed', {
        error: error.message,
        fallback: 'buildDiscordEnvelope',
      });
      envelopeBuilder = buildDiscordEnvelope;
    }
  } else {
    // Feature flag disabled: Use custom builder (legacy behavior)
    logger.info('discord.factory.custom_builder.enabled', {
      builder: 'buildDiscordEnvelope',
      featureFlags: flags,
    });
    envelopeBuilder = buildDiscordEnvelope;
  }

  // Create Discord client with Gateway API
  const client = new DiscordIngressClient(
    envelopeBuilder,
    publisher,
    config,
    { egressDestinationTopic },
    tokenStore
  );

  // Wrap with connector adapter
  return new DiscordConnectorAdapter(client, config);
};
