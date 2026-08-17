/**
 * Twilio Connector Factory
 *
 * Factory function for creating Twilio connectors with IntegrationBit.
 *
 * @module twilio/factory
 * @since Sprint 12
 */

import type { ConnectorFactory } from '../../../common/integration-bit';
import { TwilioIngressClient } from './twilio-ingress-client';
import { TwilioEnvelopeBuilder } from './twilio-envelope-builder';
import { TwilioTokenProvider } from './token-provider';
import { TwilioConnectorAdapter } from './connector-adapter';
import { createTwilioIngressPublisherFromConfig } from './publisher';
import type { IConfig } from '../../../types';

/**
 * Creates a Twilio connector configured for the IntegrationBit framework.
 *
 * Architecture:
 * - Uses Twilio Programmable Messaging API for SMS/MMS
 * - Webhook-based ingress for incoming messages
 * - REST API egress for outbound messages
 *
 * @example
 * ```typescript
 * import { createTwilioConnector } from './twilio/factory';
 *
 * const config: IntegrationBitConfig = {
 *   serviceName: 'twilio-ingress',
 *   connectors: [
 *     { name: 'twilio', factory: createTwilioConnector }
 *   ]
 * };
 * ```
 *
 * @param config - Platform configuration (IConfig)
 * @param opts - Factory options
 * @param opts.egressDestinationTopic - Topic for egress messages
 * @param opts.publisherFactory - Function to create publishers for specific topics
 * @returns Promise resolving to configured TwilioConnectorAdapter
 */
export const createTwilioConnector: ConnectorFactory = async (config: IConfig, opts) => {
  const { egressDestinationTopic, publisherFactory } = opts;

  // Create envelope builder for Twilio events
  const envelopeBuilder = new TwilioEnvelopeBuilder();

  // Create publisher for ingress events
  // IMPORTANT: Always use createTwilioIngressPublisherFromConfig wrapper
  // It wraps MessagePublisher (publishJson) with IngressPublisher interface (publish)
  const publisher = createTwilioIngressPublisherFromConfig(config, publisherFactory);

  // Create token provider for Twilio API authentication
  const tokenProvider = new TwilioTokenProvider(config);

  // Create Twilio client
  const client = new TwilioIngressClient(
    config,
    tokenProvider,
    envelopeBuilder,
    publisher,
    { egressDestinationTopic }
  );

  // Wrap with connector adapter
  return new TwilioConnectorAdapter(client, config);
};
