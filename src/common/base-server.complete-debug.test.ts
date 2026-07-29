/**
 * Base Server - complete() Debug Flow Tests (Sprint 371)
 *
 * Tests for debug completion summary in Bit.complete() method (DBG-012).
 *
 * @since Sprint 371
 */

import { Bit } from './base-server';
import type { InternalEventV2 } from '../types/events';

// Mock message bus
jest.mock('../services/message-bus', () => ({
  createMessagePublisher: jest.fn(() => ({
    publishJson: jest.fn().mockResolvedValue(undefined),
  })),
  createMessageSubscriber: jest.fn(),
}));

// Mock logging
jest.mock('./logging', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock Logger static methods
const { Logger } = require('./logging');
Logger.setServiceName = jest.fn();

describe('Bit - complete() Debug Flow (DBG-012)', () => {
  let testBit: Bit;
  let mockPublisher: any;
  let sendDebugUpdateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    const { createMessagePublisher } = require('../services/message-bus');
    mockPublisher = {
      publishJson: jest.fn().mockResolvedValue(undefined),
    };
    createMessagePublisher.mockReturnValue(mockPublisher);

    testBit = new Bit({
      serviceName: 'test-service',
      configOverrides: { port: 0 },
    });

    // Spy on sendDebugUpdate method
    sendDebugUpdateSpy = jest.spyOn(testBit as any, 'sendDebugUpdate').mockResolvedValue(undefined);
  });

  describe('Debug completion summary', () => {
    it('should send debug summary when qos.tracer=true and debug.enabled=true', async () => {
      const startedAt = new Date(Date.now() - 5000); // 5 seconds ago

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: startedAt.toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [
            { stage: 'contextualization', timestamp: new Date().toISOString() },
            { stage: 'analysis', timestamp: new Date().toISOString() },
            { stage: 'reaction', timestamp: new Date().toISOString() },
          ] as any,
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      // Verify sendDebugUpdate was called
      expect(sendDebugUpdateSpy).toHaveBeenCalledWith(
        'C_DEBUG_CHANNEL',
        'slack',
        expect.stringContaining('Event Complete'),
        'test-correlation-id',
        'completion'
      );

      // Verify completion summary includes duration
      const completionSummary = sendDebugUpdateSpy.mock.calls[0][2];
      expect(completionSummary).toContain('Duration');
      expect(completionSummary).toMatch(/Duration: \d+\.\d+s/);
    });

    it('should NOT send debug summary when qos.tracer=false', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: false }, // Debug disabled
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: new Date().toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      // Should NOT call sendDebugUpdate
      expect(sendDebugUpdateSpy).not.toHaveBeenCalled();
    });

    it('should NOT send debug summary when debug metadata missing', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          // Debug metadata omitted
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      // Should NOT call sendDebugUpdate
      expect(sendDebugUpdateSpy).not.toHaveBeenCalled();
    });

    it('should calculate duration correctly', async () => {
      const startedAt = new Date(Date.now() - 3500); // 3.5 seconds ago

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: startedAt.toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      const completionSummary = sendDebugUpdateSpy.mock.calls[0][2];

      // Duration should be approximately 3.5 seconds
      const durationMatch = completionSummary.match(/Duration: (\d+\.\d+)s/);
      expect(durationMatch).not.toBeNull();
      const duration = parseFloat(durationMatch![1]);
      expect(duration).toBeGreaterThanOrEqual(3.0);
      expect(duration).toBeLessThan(4.0);
    });

    it('should include stage progression from routing history', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: new Date(Date.now() - 1000).toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [
            { stage: 'ingress', timestamp: new Date().toISOString() },
            { stage: 'contextualization', timestamp: new Date().toISOString() },
            { stage: 'analysis', timestamp: new Date().toISOString() },
            { stage: 'reaction', timestamp: new Date().toISOString() },
          ] as any,
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      const completionSummary = sendDebugUpdateSpy.mock.calls[0][2];

      // Should include stage progression
      expect(completionSummary).toContain('Stages:');
      expect(completionSummary).toContain('ingress');
      expect(completionSummary).toContain('contextualization');
      expect(completionSummary).toContain('analysis');
      expect(completionSummary).toContain('reaction');
      expect(completionSummary).toContain('→'); // Arrow separator
    });

    it('should handle empty routing history', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: new Date(Date.now() - 1000).toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [], // Empty history
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      const completionSummary = sendDebugUpdateSpy.mock.calls[0][2];

      // Should handle empty history gracefully
      expect(completionSummary).toContain('Stages: none');
    });

    it('should include final status in summary', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: new Date(Date.now() - 1000).toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      const completionSummary = sendDebugUpdateSpy.mock.calls[0][2];

      // Should include final status
      expect(completionSummary).toContain('Final Status: delivered');
    });

    it('should continue egress even if debug summary fails', async () => {
      // Make sendDebugUpdate throw an error
      sendDebugUpdateSpy.mockRejectedValueOnce(new Error('debug_failed'));

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: new Date(Date.now() - 1000).toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [],
        },
      };

      // Should NOT throw
      await expect(
        // @ts-expect-error - accessing protected method for testing
        testBit.complete(event)
      ).resolves.not.toThrow();

      // Verify event was still published (egress continued)
      expect(mockPublisher.publishJson).toHaveBeenCalled();
    });

    it('should log routing.complete.debug when summary sent', async () => {
      const debugSpy = jest.spyOn((testBit as any).logger, 'debug');

      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          debug: {
            enabled: true,
            feedbackChannel: 'C_DEBUG_CHANNEL',
            initiatedBy: 'U_TEST_USER',
            startedAt: new Date(Date.now() - 2000).toISOString(),
          },
        },
        ingress: {
          ingressAt: new Date().toISOString(),
          source: 'test',
          connector: 'slack',
          channel: 'C_TEST',
        },
        identity: {
          external: { id: 'U1', platform: 'slack', displayName: 'Test' },
        },
        egress: {
          destination: 'internal.egress.v1',
          connector: 'slack',
          channel: 'C_TEST',
        },
        routing: {
          stage: 'reaction',
          slip: [],
          history: [
            { stage: 'contextualization', timestamp: new Date().toISOString() },
            { stage: 'analysis', timestamp: new Date().toISOString() },
          ] as any,
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.complete(event);

      // Verify debug log was emitted
      expect(debugSpy).toHaveBeenCalledWith(
        'routing.complete.debug',
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          durationMs: expect.any(Number),
          stagesTraversed: expect.arrayContaining(['contextualization', 'analysis']),
        })
      );
    });
  });
});
