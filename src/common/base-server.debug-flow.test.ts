/**
 * Base Server - Debug Flow Tests (Sprint 371)
 *
 * Tests for debug mode flow in Bit base class (sendDebugUpdate helper).
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

describe('Bit - Debug Flow (DBG-010)', () => {
  let testBit: Bit;
  let mockPublisher: any;

  beforeEach(() => {
    jest.clearAllMocks();

    const { createMessagePublisher } = require('../services/message-bus');
    mockPublisher = {
      publishJson: jest.fn().mockResolvedValue(undefined),
    };
    createMessagePublisher.mockReturnValue(mockPublisher);

    testBit = new Bit({
      serviceName: 'test-service',
      configOverrides: { port: 0 }, // Ephemeral port for tests
    });
  });

  describe('sendDebugUpdate helper', () => {
    it('should send debug feedback message to egress topic', async () => {
      const channel = 'C_TEST_CHANNEL';
      const connector = 'slack';
      const updateText = '⚙️ Test debug update';

      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate(channel, connector, updateText);

      // Verify publisher was created for INTERNAL_EGRESS_V1
      const { createMessagePublisher } = require('../services/message-bus');
      expect(createMessagePublisher).toHaveBeenCalledWith('internal.egress.v1');

      // Verify event was published
      expect(mockPublisher.publishJson).toHaveBeenCalledTimes(1);
      const publishedEvent: InternalEventV2 = mockPublisher.publishJson.mock.calls[0][0];

      // Verify event structure
      expect(publishedEvent.v).toBe('2');
      expect(publishedEvent.type).toBe('egress.deliver.v1');
      expect(publishedEvent.egress.channel).toBe(channel);
      expect(publishedEvent.egress.connector).toBe(connector);
      expect(publishedEvent.message?.text).toBe(updateText);
    });

    it('should create pre-selected candidate to bypass selection logic', async () => {
      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate('C123', 'slack', 'Test update');

      const publishedEvent: InternalEventV2 = mockPublisher.publishJson.mock.calls[0][0];

      expect(publishedEvent.candidates).toHaveLength(1);
      expect(publishedEvent.candidates?.[0].status).toBe('selected');
      expect(publishedEvent.candidates?.[0].text).toBe('Test update');
    });

    it('should set qos.tracer=false to prevent feedback loops', async () => {
      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate('C123', 'slack', 'Test update');

      const publishedEvent: InternalEventV2 = mockPublisher.publishJson.mock.calls[0][0];

      // Critical: Debug feedback must NOT have tracer enabled
      expect(publishedEvent.qos?.tracer).toBe(false);
    });

    it('should use meta routing stage (not part of normal flow)', async () => {
      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate('C123', 'slack', 'Test update');

      const publishedEvent: InternalEventV2 = mockPublisher.publishJson.mock.calls[0][0];

      expect(publishedEvent.routing.stage).toBe('meta');
      expect(publishedEvent.routing.slip).toEqual([]);
    });

    it('should handle publish failures gracefully (no throw)', async () => {
      // Mock publish failure
      mockPublisher.publishJson.mockRejectedValue(new Error('publish_failed'));

      // Spy on instance logger
      const warnSpy = jest.spyOn((testBit as any).logger, 'warn');

      // Should NOT throw
      await expect(
        // @ts-expect-error - accessing protected method for testing
        testBit.sendDebugUpdate('C123', 'slack', 'Test update')
      ).resolves.not.toThrow();

      // Should log warning
      expect(warnSpy).toHaveBeenCalledWith(
        'debug.feedback.send_failed',
        expect.objectContaining({
          error: 'publish_failed',
          channel: 'C123',
        })
      );
    });

    it('should include original correlation ID in logs when provided', async () => {
      const originalCorrelationId = 'original-correlation-id-123';

      // Spy on instance logger
      const debugSpy = jest.spyOn((testBit as any).logger, 'debug');

      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate('C123', 'slack', 'Test', originalCorrelationId);

      expect(debugSpy).toHaveBeenCalledWith(
        'debug.feedback.sent',
        expect.objectContaining({
          originalCorrelationId,
        })
      );
    });

    it('should work with different connectors', async () => {
      const connectors = ['slack', 'twitch', 'discord'];

      for (const connector of connectors) {
        jest.clearAllMocks();

        // @ts-expect-error - accessing protected method for testing
        await testBit.sendDebugUpdate('CHANNEL_ID', connector, 'Test');

        const publishedEvent: InternalEventV2 = mockPublisher.publishJson.mock.calls[0][0];
        expect(publishedEvent.egress.connector).toBe(connector);
        expect(publishedEvent.identity.external.platform).toBe(connector);
      }
    });

    it('should include service name in debug source', async () => {
      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate('C123', 'slack', 'Test');

      const publishedEvent: InternalEventV2 = mockPublisher.publishJson.mock.calls[0][0];

      expect(publishedEvent.ingress.source).toBe('debug.test-service');
      expect(publishedEvent.candidates?.[0].source).toBe('debug.test-service');
    });

    it('should truncate long text in log preview', async () => {
      const longText = 'A'.repeat(200);

      // Spy on instance logger
      const debugSpy = jest.spyOn((testBit as any).logger, 'debug');

      // @ts-expect-error - accessing protected method for testing
      await testBit.sendDebugUpdate('C123', 'slack', longText);

      const logCall = debugSpy.mock.calls.find(
        (call: any) => call[0] === 'debug.feedback.sent'
      ) as any;

      expect(logCall[1].textPreview).toHaveLength(100);
      expect(logCall[1].textPreview).toBe('A'.repeat(100));
    });
  });
});
