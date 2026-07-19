/**
 * Slack Envelope Builder Tests
 *
 * Tests for Slack event normalization to InternalEventV2 format.
 *
 * Sprint 348: Slack Integration (SLACK-004)
 *
 * @since Sprint 348
 */

import { buildSlackEnvelope, SlackEventMeta } from '../envelope-builder';

describe('buildSlackEnvelope', () => {
  const fixedUuid = () => 'test-uuid-123';
  const fixedNowIso = () => '2026-07-18T12:00:00.000Z';

  describe('Message Events', () => {
    it('should build envelope for channel message', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Hello, world!',
        ts: '1234567890.123456',
        team: 'T123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.v).toBe('2');
      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.correlationId).toBe('test-uuid-123');
      expect(envelope.traceId).toBe('test-uuid-123');
      expect(envelope.ingress.source).toBe('ingress.slack');
      expect(envelope.ingress.connector).toBe('slack');
      expect(envelope.ingress.channel).toBe('C123456');
      expect(envelope.ingress.ingressAt).toBe('2026-07-18T12:00:00.000Z');
    });

    it('should build envelope for direct message', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'D123456', // DM channel
        text: 'Hello!',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.ingress.channel).toBe('D123456');
      expect(envelope.egress.channel).toBe('D123456');
    });

    it('should build envelope for threaded message', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Reply in thread',
        ts: '1234567890.123456',
        thread_ts: '1234567800.000000', // Parent message timestamp
        team: 'T123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.identity.external.metadata?.threadTs).toBe('1234567800.000000');
      expect(envelope.message?.rawPlatformPayload?.thread_ts).toBe('1234567800.000000');
    });

    it('should build envelope for app_mention event', () => {
      const event: SlackEventMeta = {
        type: 'app_mention',
        user: 'U123456',
        channel: 'C123456',
        text: '<@U987654> hello bot!',
        ts: '1234567890.123456',
        team: 'T123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.message?.text).toBe('<@U987654> hello bot!');
      expect(envelope.message?.rawPlatformPayload?.type).toBe('app_mention');
    });
  });

  describe('Identity Mapping', () => {
    it('should map external identity correctly', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test',
        ts: '1234567890.123456',
        team: 'T123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.identity.external.id).toBe('U123456');
      expect(envelope.identity.external.platform).toBe('slack');
      expect(envelope.identity.external.displayName).toBe('U123456'); // TODO: resolved in SLACK-005
      expect(envelope.identity.external.metadata?.channelId).toBe('C123456');
      expect(envelope.identity.external.metadata?.teamId).toBe('T123456');
    });

    it('should handle missing user (system messages)', () => {
      const event: SlackEventMeta = {
        type: 'message',
        channel: 'C123456',
        text: 'System message',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.identity.external.id).toBe('unknown');
      expect(envelope.identity.external.displayName).toBe('unknown');
    });
  });

  describe('Message Structure', () => {
    it('should include message with correct structure', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Hello, world!',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.message).toBeDefined();
      expect(envelope.message?.id).toBe('1234567890.123456');
      expect(envelope.message?.role).toBe('user');
      expect(envelope.message?.text).toBe('Hello, world!');
      expect(envelope.message?.rawPlatformPayload).toBeDefined();
    });

    it('should handle empty message text', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.message?.text).toBe('');
    });

    it('should preserve raw platform payload', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test message',
        ts: '1234567890.123456',
        thread_ts: '1234567800.000000',
        team: 'T123456',
        event_ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.message?.rawPlatformPayload).toEqual({
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test message',
        ts: '1234567890.123456',
        thread_ts: '1234567800.000000',
        team: 'T123456',
        event_ts: '1234567890.123456',
      });
    });
  });

  describe('Egress Configuration', () => {
    it('should set egress channel to event channel', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.egress.connector).toBe('slack');
      expect(envelope.egress.channel).toBe('C123456');
      expect(envelope.egress.destination).toBe('');
    });
  });

  describe('Routing Configuration', () => {
    it('should initialize routing slip', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: fixedNowIso });

      expect(envelope.routing.stage).toBe('initial');
      expect(envelope.routing.slip).toEqual([]);
      expect(envelope.routing.history).toEqual([]);
    });
  });

  describe('UUID and Timestamp Injection', () => {
    it('should use injected uuid function', () => {
      let callCount = 0;
      const mockUuid = () => `uuid-${++callCount}`;

      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: mockUuid, nowIso: fixedNowIso });

      expect(envelope.correlationId).toBe('uuid-1');
      expect(envelope.traceId).toBe('uuid-2');
    });

    it('should use injected nowIso function', () => {
      const mockNowIso = () => '2026-12-31T23:59:59.999Z';

      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test',
        ts: '1234567890.123456',
      };

      const envelope = buildSlackEnvelope(event, { uuid: fixedUuid, nowIso: mockNowIso });

      expect(envelope.ingress.ingressAt).toBe('2026-12-31T23:59:59.999Z');
    });

    it('should generate unique IDs when no uuid injected', () => {
      const event: SlackEventMeta = {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Test',
        ts: '1234567890.123456',
      };

      const envelope1 = buildSlackEnvelope(event);
      const envelope2 = buildSlackEnvelope(event);

      expect(envelope1.correlationId).not.toBe(envelope2.correlationId);
      expect(envelope1.traceId).not.toBe(envelope2.traceId);
    });
  });
});
