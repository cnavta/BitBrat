/**
 * Slack Connector Factory
 *
 * Factory function for creating Slack connectors with IntegrationBit.
 *
 * Sprint 13: YAML-driven event gateway integration
 * - Supports feature flag ENABLE_CONFIG_REGISTRY for gradual rollout
 * - Falls back to custom builder (buildSlackEnvelope) when flag disabled
 * - Loads YAML configs from config/platforms/slack/ when enabled
 *
 * @module slack/factory
 * @since Sprint 12
 */

import type { ConnectorFactory } from '../../../common/integration-bit';
import { SlackIngressClient } from './slack-ingress-client';
import { SlackConnectorAdapter } from './connector-adapter';
import { createSlackIngressPublisherFromConfig } from './publisher';
import { buildSlackEnvelope } from './envelope-builder';
import { ConfigRegistry } from '../core/config-registry';
import { TranslationEngine } from '../core/translation-engine';
import { getFeatureFlags } from '../core/feature-flags';
import { logger } from '../../../common/logging';
import type { IConfig } from '../../../types';
import path from 'path';

/**
 * Creates a Slack connector configured for the IntegrationBit framework.
 *
 * Architecture:
 * - Uses Slack Socket Mode (WebSocket) for real-time events
 * - Requires App-Level Token (xapp-) and Bot Token (xoxb-)
 * - No webhook endpoint required (Socket Mode handles everything)
 *
 * @example
 * ```typescript
 * import { createSlackConnector } from './slack/factory';
 *
 * const config: IntegrationBitConfig = {
 *   serviceName: 'slack-ingress',
 *   connectors: [
 *     { name: 'slack', factory: createSlackConnector }
 *   ]
 * };
 * ```
 *
 * @param config - Platform configuration (IConfig)
 * @param opts - Factory options
 * @param opts.egressDestinationTopic - Topic for egress messages
 * @param opts.publisherFactory - Function to create publishers for specific topics
 * @returns Promise resolving to configured SlackConnectorAdapter
 * @throws Error if slackAppToken or slackBotToken is missing
 */
export const createSlackConnector: ConnectorFactory = async (config: IConfig, opts) => {
  const { egressDestinationTopic, publisherFactory, onSnapshotPublished } = opts;

  // Extract and validate required credentials
  const slackAppToken = config.slackAppToken;
  const slackBotToken = config.slackBotToken;

  if (!slackAppToken) {
    throw new Error('Missing required config: slackAppToken (App-Level Token, starts with xapp-)');
  }

  if (!slackBotToken) {
    throw new Error('Missing required config: slackBotToken (Bot User OAuth Token, starts with xoxb-)');
  }

  // Create publisher for ingress events
  // IMPORTANT: Always use createSlackIngressPublisherFromConfig wrapper
  // It wraps MessagePublisher (publishJson) with IngressPublisher interface (publish)
  // Sprint 24: Pass onSnapshotPublished callback for unified persistence flow
  const publisher = createSlackIngressPublisherFromConfig(config, publisherFactory, onSnapshotPublished);

  // Sprint 13: Check feature flag for YAML-driven event gateway
  const flags = getFeatureFlags();
  let envelopeBuilder: typeof buildSlackEnvelope;

  if (flags.ENABLE_CONFIG_REGISTRY) {
    logger.info('slack.factory.translation_engine.enabled', {
      configPath: 'config',
      featureFlags: flags,
    });

    try {
      // Load YAML configs from config/ (registry will find config/events/ and config/platforms/slack/)
      const configPath = path.join(process.cwd(), 'config');
      const registry = new ConfigRegistry({ configPath });
      await registry.load();

      logger.info('slack.factory.config_registry.loaded', {
        platform: 'slack',
      });

      // Create TranslationEngine for Slack
      const engine = new TranslationEngine(registry);

      // Wrap translateInbound as envelope builder function
      // NOTE: TranslationEngine.translateInbound is async, but custom builder is sync
      // Slack client will handle both sync and async results via Promise check
      envelopeBuilder = ((meta, builderOpts) => {
        // Slack Socket Mode events use 'message' as platform event
        const platformEvent = 'message';

        // Call async translateInbound - caller will await if needed
        return engine.translateInbound('slack', platformEvent, meta, builderOpts) as any;
      }) as typeof buildSlackEnvelope;

      logger.info('slack.factory.translation_engine.initialized', {
        platform: 'slack',
        useGenericBuilder: flags.ENABLE_GENERIC_BUILDER,
      });
    } catch (error: any) {
      // Fail-safe: Fall back to custom builder if YAML loading fails
      logger.error('slack.factory.translation_engine.failed', {
        error: error.message,
        fallback: 'buildSlackEnvelope',
      });
      envelopeBuilder = buildSlackEnvelope;
    }
  } else {
    // Feature flag disabled: Use custom builder (legacy behavior)
    logger.info('slack.factory.custom_builder.enabled', {
      builder: 'buildSlackEnvelope',
      featureFlags: flags,
    });
    envelopeBuilder = buildSlackEnvelope;
  }

  // Create Slack client with Socket Mode
  const client = new SlackIngressClient(
    envelopeBuilder,
    slackAppToken,
    slackBotToken,
    publisher,
    config.debugUsersSlack,
    egressDestinationTopic
  );

  // Wrap with connector adapter
  return new SlackConnectorAdapter(client, config);
};
