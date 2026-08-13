/**
 * Slack Connector Factory
 *
 * Factory function for creating Slack connectors with IntegrationBit.
 *
 * @module slack/factory
 * @since Sprint 12
 */

import type { ConnectorFactory } from '../../../common/integration-bit';
import { SlackIngressClient } from './slack-ingress-client';
import { SlackConnectorAdapter } from './connector-adapter';
import { createSlackIngressPublisherFromConfig } from './publisher';
import type { IConfig } from '../../../types';

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
  const { egressDestinationTopic, publisherFactory } = opts;

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
  const publisher = createSlackIngressPublisherFromConfig(config, publisherFactory);

  // Create Slack client with Socket Mode
  const client = new SlackIngressClient(
    slackAppToken,
    slackBotToken,
    publisher,
    config.debugUsersSlack,
    egressDestinationTopic
  );

  // Wrap with connector adapter
  return new SlackConnectorAdapter(client, config);
};
