/**
 * Base Server - next() Debug Flow Tests (Sprint 371)
 *
 * Tests for debug progress logging in Bit.next() method (DBG-011).
 *
 * @since Sprint 371
 */

import { Bit } from './base-server';
import type { InternalEventV2, RoutingStep } from '../types/events';

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

describe('Bit - next() Debug Flow (DBG-011)', () => {
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

  describe('Debug progress updates', () => {
    it('should send debug update when qos.tracer=true and debug.enabled=true', async () => {
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
          stage: 'analysis',
          slip: [
            { id: 'llm-bot', nextTopic: 'internal.llm.v1', status: 'PENDING' },
            { id: 'reflex', nextTopic: 'internal.reflex.v1', status: 'PENDING' },
          ] as RoutingStep[],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.next(event);

      // Verify sendDebugUpdate was called (Story 1: added messageType parameter)
      expect(sendDebugUpdateSpy).toHaveBeenCalledWith(
        'C_DEBUG_CHANNEL',
        'slack',
        expect.stringContaining('Stage: analysis'),
        'test-correlation-id',
        'progress'
      );

      // Verify progress update includes step information
      const progressUpdate = sendDebugUpdateSpy.mock.calls[0][2];
      expect(progressUpdate).toContain('llm-bot');
      expect(progressUpdate).toContain('reflex');
      expect(progressUpdate).toContain('internal.llm.v1');
    });

    it('should NOT send debug update when qos.tracer=false', async () => {
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
          stage: 'analysis',
          slip: [
            { id: 'llm-bot', nextTopic: 'internal.llm.v1', status: 'PENDING' },
          ] as RoutingStep[],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.next(event);

      // Should NOT call sendDebugUpdate
      expect(sendDebugUpdateSpy).not.toHaveBeenCalled();
    });

    it('should NOT send debug update when debug.enabled=false', async () => {
      const event: InternalEventV2 = {
        v: '2',
        correlationId: 'test-correlation-id',
        type: 'ingress.message.v1',
        qos: { tracer: true },
        metadata: {
          // Debug metadata omitted (equivalent to not enabled)
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
          stage: 'analysis',
          slip: [
            { id: 'llm-bot', nextTopic: 'internal.llm.v1', status: 'PENDING' },
          ] as RoutingStep[],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.next(event);

      // Should NOT call sendDebugUpdate
      expect(sendDebugUpdateSpy).not.toHaveBeenCalled();
    });

    it('should include stage, current step, next step, and topic in progress update', async () => {
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
          stage: 'contextualization',
          slip: [
            { id: 'auth', nextTopic: 'internal.auth.v1', status: 'PENDING' },
            { id: 'llm-bot', nextTopic: 'internal.llm.v1', status: 'PENDING' },
          ] as RoutingStep[],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.next(event);

      const progressUpdate = sendDebugUpdateSpy.mock.calls[0][2];

      // Verify all required components are present
      expect(progressUpdate).toContain('Stage: contextualization');
      expect(progressUpdate).toContain('auth');
      expect(progressUpdate).toContain('llm-bot');
      expect(progressUpdate).toContain('internal.auth.v1');
    });

    it('should handle last step correctly (next step = egress)', async () => {
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
          slip: [
            { id: 'reflex', nextTopic: 'internal.reflex.v1', status: 'PENDING' },
            // No more steps after this
          ] as RoutingStep[],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.next(event);

      const progressUpdate = sendDebugUpdateSpy.mock.calls[0][2];

      // Next step should be 'egress' since it's the last step
      expect(progressUpdate).toContain('reflex');
      expect(progressUpdate).toContain('egress');
    });

    it('should continue routing even if debug update fails', async () => {
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
          stage: 'analysis',
          slip: [
            { id: 'llm-bot', nextTopic: 'internal.llm.v1', status: 'PENDING' },
          ] as RoutingStep[],
          history: [],
        },
      };

      // Should NOT throw
      await expect(
        // @ts-expect-error - accessing protected method for testing
        testBit.next(event)
      ).resolves.not.toThrow();

      // Verify event was still published (routing continued)
      expect(mockPublisher.publishJson).toHaveBeenCalled();
    });

    it('should log routing.next.debug when debug update sent', async () => {
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
          stage: 'analysis',
          slip: [
            { id: 'llm-bot', nextTopic: 'internal.llm.v1', status: 'PENDING' },
          ] as RoutingStep[],
          history: [],
        },
      };

      // @ts-expect-error - accessing protected method for testing
      await testBit.next(event);

      // Verify debug log was emitted
      expect(debugSpy).toHaveBeenCalledWith(
        'routing.next.debug',
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          currentStep: 'llm-bot',
          topic: expect.stringContaining('internal.llm.v1'),
        })
      );
    });
  });
});
