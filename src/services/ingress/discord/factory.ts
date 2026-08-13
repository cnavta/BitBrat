/**
 * Discord Connector Factory
 *
 * Factory function for creating Discord connectors with IntegrationBit.
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
import type { IConfig } from '../../../types';

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

  // Create Discord client with Gateway API
  const client = new DiscordIngressClient(
    buildDiscordEnvelope,
    publisher,
    config,
    { egressDestinationTopic },
    tokenStore
  );

  // Wrap with connector adapter
  return new DiscordConnectorAdapter(client, config);
};
