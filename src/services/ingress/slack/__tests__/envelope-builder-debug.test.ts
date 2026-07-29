/**
 * Slack Envelope Builder - Debug Metadata Tests (Sprint 371)
 *
 * Tests for debug metadata attachment in buildSlackEnvelope().
 *
 * @since Sprint 371
 */

import { buildSlackEnvelope } from '../envelope-builder';
import type { DebugMetadata } from '../../../../types/events';
import { assertDebugMetadata } from '../debug-test-utils';

describe('buildSlackEnvelope - Debug Metadata (DBG-007)', () => {
  const baseEvent = {
    type: 'message',
    user: 'U0123456789',
    channel: 'C9876543210',
    text: 'test message',
    ts: '1234567890.123456',
    team: 'T0987654321',
    event_ts: '1234567890.123456',
  };

  describe('Debug metadata attachment', () => {
    it('should attach debug metadata when provided', () => {
      const now = new Date().toISOString();
      const debugMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U0123456789',
        feedbackChannel: 'C9876543210',
        startedAt: now,
      };

      const envelope = buildSlackEnvelope(baseEvent, { debugMetadata });

      // Verify debug metadata is attached
      expect(envelope.metadata?.debug).toEqual(debugMetadata);
      expect(envelope.metadata?.debug?.enabled).toBe(true);
      expect(envelope.metadata?.debug?.initiatedBy).toBe('U0123456789');
      expect(envelope.metadata?.debug?.feedbackChannel).toBe('C9876543210');
      expect(envelope.metadata?.debug?.startedAt).toBe(now);
    });

    it('should set qos.tracer=true when debug metadata provided', () => {
      const debugMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U0123456789',
        feedbackChannel: 'C9876543210',
        startedAt: new Date().toISOString(),
      };

      const envelope = buildSlackEnvelope(baseEvent, { debugMetadata });

      expect(envelope.qos?.tracer).toBe(true);
    });

    it('should pass assertDebugMetadata validation', () => {
      const debugMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U0123456789',
        feedbackChannel: 'C9876543210',
        startedAt: new Date().toISOString(),
      };

      const envelope = buildSlackEnvelope(baseEvent, { debugMetadata });

      // Should not throw
      expect(() => assertDebugMetadata(envelope)).not.toThrow();
    });

    it('should handle different user IDs in debug metadata', () => {
      const debugMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U_DIFFERENT_USER',
        feedbackChannel: 'C_DIFFERENT_CHANNEL',
        startedAt: new Date().toISOString(),
      };

      const envelope = buildSlackEnvelope(baseEvent, { debugMetadata });

      expect(envelope.metadata?.debug?.initiatedBy).toBe('U_DIFFERENT_USER');
      expect(envelope.metadata?.debug?.feedbackChannel).toBe('C_DIFFERENT_CHANNEL');
    });

    it('should preserve ISO8601 timestamp format', () => {
      const now = new Date().toISOString();
      const debugMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U0123456789',
        feedbackChannel: 'C9876543210',
        startedAt: now,
      };

      const envelope = buildSlackEnvelope(baseEvent, { debugMetadata });

      expect(envelope.metadata?.debug?.startedAt).toBe(now);
      // Verify it's a valid ISO8601 timestamp
      const parsed = new Date(envelope.metadata!.debug!.startedAt);
      expect(isNaN(parsed.getTime())).toBe(false);
    });
  });

  describe('Non-debug envelopes (backward compatibility)', () => {
    it('should not set qos when debug metadata not provided', () => {
      const envelope = buildSlackEnvelope(baseEvent);

      expect(envelope.qos).toBeUndefined();
    });

    it('should not set metadata when debug metadata not provided', () => {
      const envelope = buildSlackEnvelope(baseEvent);

      expect(envelope.metadata).toBeUndefined();
    });

    it('should create normal envelope without debug opts', () => {
      const envelope = buildSlackEnvelope(baseEvent);

      expect(envelope.v).toBe('2');
      expect(envelope.type).toBe('chat.message.v1');
      expect(envelope.correlationId).toBeDefined();
      expect(envelope.message?.text).toBe('test message');
      expect(envelope.identity?.external?.id).toBe('U0123456789');
      expect(envelope.ingress?.channel).toBe('C9876543210');
    });

    it('should handle undefined opts gracefully', () => {
      const envelope = buildSlackEnvelope(baseEvent, undefined);

      expect(envelope.qos).toBeUndefined();
      expect(envelope.metadata).toBeUndefined();
    });

    it('should handle empty opts object gracefully', () => {
      const envelope = buildSlackEnvelope(baseEvent, {});

      expect(envelope.qos).toBeUndefined();
      expect(envelope.metadata).toBeUndefined();
    });
  });

  describe('Debug metadata with other opts', () => {
    it('should work with custom uuid and nowIso functions', () => {
      const mockUuid = () => 'mock-uuid-12345';
      const mockNowIso = () => '2026-07-28T20:00:00.000Z';
      const debugMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U0123456789',
        feedbackChannel: 'C9876543210',
        startedAt: '2026-07-28T20:00:00.000Z',
      };

      const envelope = buildSlackEnvelope(baseEvent, {
        uuid: mockUuid,
        nowIso: mockNowIso,
        debugMetadata,
      });

      // Verify custom functions were used
      expect(envelope.correlationId).toBe('mock-uuid-12345');
      expect(envelope.ingress.ingressAt).toBe('2026-07-28T20:00:00.000Z');

      // Verify debug metadata still attached
      expect(envelope.metadata?.debug).toEqual(debugMetadata);
      expect(envelope.qos?.tracer).toBe(true);
    });
  });

  describe('Type safety', () => {
    it('should enforce DebugMetadata shape at compile time', () => {
      const validMetadata: DebugMetadata = {
        enabled: true,
        initiatedBy: 'U0123456789',
        feedbackChannel: 'C9876543210',
        startedAt: new Date().toISOString(),
      };

      const envelope = buildSlackEnvelope(baseEvent, { debugMetadata: validMetadata });

      // TypeScript should allow this
      expect(envelope.metadata?.debug?.enabled).toBe(true);
    });
  });
});
