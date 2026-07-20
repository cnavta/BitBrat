/**
 * SlackConnectorAdapter Tests
 *
 * Tests for IngressConnector interface methods.
 *
 * Sprint 348: Slack Integration
 *
 * @since Sprint 348
 */

import { SlackConnectorAdapter } from '../connector-adapter';
import { SlackIngressClient } from '../slack-ingress-client';

describe('SlackConnectorAdapter', () => {
  describe('IngressConnector interface', () => {
    it.todo('should start Socket Mode client');
    it.todo('should stop Socket Mode client');
    it.todo('should return snapshot with correct state');
    it.todo('should throw error when sendText called without target');
  });

  describe('getMetadata', () => {
    it.todo('should return platform as "slack"');
    it.todo('should return version "1.0.0"');
    it.todo('should return authMethod as "oauth2"');
    it.todo('should return ingress method as "hybrid"');
    it.todo('should indicate realtime ingress');
    it.todo('should indicate webhooks not required');
    it.todo('should indicate public URL not required');
    it.todo('should support chat egress');
    it.todo('should support DM egress');
    it.todo('should support reactions egress');
    it.todo('should support threads egress');
    it.todo('should not support ban moderation');
    it.todo('should support delete moderation');
  });
});
