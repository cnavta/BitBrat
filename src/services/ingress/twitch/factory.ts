/**
 * Twitch Connector Factory
 *
 * Factory function for creating Twitch connectors with IntegrationBit.
 *
 * @module twitch/factory
 * @since Sprint 12
 */

import type { ConnectorFactory } from '../../../common/integration-bit';
import { TwitchIrcClient } from './twitch-irc-client';
import { TwitchEnvelopeBuilder } from './envelope-builder';
import { TwitchConnectorAdapter } from './connector-adapter';
import { ConfigTwitchCredentialsProvider, FirestoreTwitchCredentialsProvider } from './credentials-provider';
import { createTwitchIngressPublisherFromConfig } from './publisher';
import { createTokenStore } from '../../firestore-token-store';
import type { IConfig } from '../../../types';

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

  // Create Twitch IRC client
  const client = new TwitchIrcClient(
    new TwitchEnvelopeBuilder(),
    publisher,
    config.twitchChannels || [],
    {
      cfg: config,
      credentialsProvider,
      egressDestinationTopic,
      debugUsers,
    }
  );

  // Wrap with connector adapter
  return new TwitchConnectorAdapter(client);
};
