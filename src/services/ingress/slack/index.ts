/**
 * Slack Ingress Module
 *
 * Public exports for Slack connector.
 *
 * Sprint 348: Slack Integration
 *
 * @since Sprint 348
 */

export { SlackConnectorAdapter } from './connector-adapter';
export { SlackIngressClient } from './slack-ingress-client';
export { validateSlackSignature } from './webhook-utils';
export { buildSlackEnvelope } from './envelope-builder';
export type { SlackEventMeta } from './envelope-builder';
