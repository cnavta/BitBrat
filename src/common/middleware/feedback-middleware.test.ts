/**
 * feedback-middleware.test.ts
 *
 * Unit tests for FeedbackMiddleware.
 *
 * Sprint 377: Long-Running Task Feedback
 */

import { FeedbackMiddleware, FeedbackMiddlewareConfig } from './feedback-middleware';
import type { InternalEventV2, AnnotationV1 } from '../../types/events';
import type { Logger } from '../logging';
import { randomUUID } from 'crypto';
import pino from 'pino';

describe('FeedbackMiddleware', () => {
  let mockLogger: Logger;
  let publishedEvents: Array<{ topic: string; event: InternalEventV2 }>;
  let mockPublish: (topic: string, event: InternalEventV2) => Promise<void>;
  let middleware: FeedbackMiddleware | null = null;

  beforeEach(() => {
    // Use fake timers for predictable timer behavior
    jest.useFakeTimers();

    // Mock logger
    mockLogger = pino({ level: 'silent' }) as unknown as Logger;

    // Mock publish function
    publishedEvents = [];
    mockPublish = async (topic: string, event: InternalEventV2) => {
      publishedEvents.push({ topic, event });
    };
  });

  afterEach(() => {
    // Clean up any middleware instance
    if (middleware) {
      // Clear all tracked operations and their timers
      const stats = middleware.getStats();
      stats.operations.forEach((op) => {
        middleware!.completeOperation(op.correlationId);
      });
      middleware = null;
    }

    // Restore real timers
    jest.useRealTimers();
  });

  const createMockEvent = (overrides?: Partial<InternalEventV2>): InternalEventV2 => ({
    v: '2',
    correlationId: randomUUID(),
    type: 'chat.message.v1',
    ingress: {
      ingressAt: new Date().toISOString(),
      source: 'ingress.slack',
      connector: 'slack',
      channel: 'general',
    },
    identity: {
      external: {
        id: 'U123',
        platform: 'slack',
        displayName: 'Test User',
      },
    },
    egress: {
      destination: 'slack',
      connector: 'slack',
      channel: 'C123',
    },
    message: {
      id: randomUUID(),
      role: 'user',
      text: '!image a sunset',
    },
    payload: {
      type: 'chat.message.v1',
    },
    routing: {
      stage: 'analysis',
      slip: [],
      history: [],
    },
    annotations: [],
    ...overrides,
  });

  const createOperationContext = (
    operation: string,
    parameters?: Record<string, any>
  ): AnnotationV1 => ({
    kind: 'operation_context',
    value: JSON.stringify({
      operation,
      parameters: parameters || {},
    }),
    source: 'llm-bot',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  describe('Construction', () => {
    it('should initialize with default config', () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {}
      );

      const stats = middleware.getStats();
      expect(stats.activeOperations).toBe(0);
    });

    it('should accept custom config', () => {
      const config: FeedbackMiddlewareConfig = {
        initialThresholdMs: 1000,
        updateIntervalMs: 3000,
        timeoutThresholdMs: 10000,
        enabled: true,
        useCustomMessages: true,
      };

      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        config
      );

      const stats = middleware.getStats();
      expect(stats.activeOperations).toBe(0);
    });
  });

  describe('Operation Detection', () => {
    it('should ignore events without operation_context annotation', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0, // Immediate
        }
      );

      const event = createMockEvent({
        annotations: [], // No operation_context
      });

      await middleware.beforeNext(event);

      expect(publishedEvents).toHaveLength(0);
      expect(middleware.getStats().activeOperations).toBe(0);
    });

    it('should detect operation_context annotation', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0, // Immediate
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation', { prompt: 'a sunset' })],
      });

      await middleware.beforeNext(event);

      expect(middleware.getStats().activeOperations).toBe(1);
    });

    it('should skip processing if disabled', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          enabled: false,
          initialThresholdMs: 0,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      expect(publishedEvents).toHaveLength(0);
      expect(middleware.getStats().activeOperations).toBe(0);
    });
  });

  describe('Threshold Detection', () => {
    it('should send initial progress after initial threshold', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 2000, // 2 seconds
          useCustomMessages: false, // Template messages
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Timers scheduled but not fired yet
      expect(publishedEvents).toHaveLength(0);

      // Advance time to initial threshold
      await jest.advanceTimersByTimeAsync(2000);

      // Initial progress message should be sent
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].topic).toBe('internal.egress.v1');
      expect(publishedEvents[0].event.candidates![0].text).toBe('🤔 Thinking about your request...');
    });

    it('should not send progress before initial threshold', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 10000, // 10 seconds
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Advance time but not to threshold
      await jest.advanceTimersByTimeAsync(5000);

      expect(publishedEvents).toHaveLength(0);
    });

    it('should send update progress after update interval', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 2000,
          updateIntervalMs: 5000,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Advance to initial threshold
      await jest.advanceTimersByTimeAsync(2000);
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].event.candidates![0].text).toBe('🤔 Thinking about your request...');

      // Advance to first update (5s after initial)
      await jest.advanceTimersByTimeAsync(5000);
      expect(publishedEvents).toHaveLength(2);
      expect(publishedEvents[1].event.candidates![0].text).toBe('⏳ Still working on it...');
    });

    it('should send timeout warning after timeout threshold', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 2000,
          updateIntervalMs: 5000,
          timeoutThresholdMs: 30000,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Advance to timeout threshold
      await jest.advanceTimersByTimeAsync(30000);

      const timeoutMessage = publishedEvents.find(
        (p) => p.event.candidates?.[0]?.text?.includes('longer than expected')
      );

      expect(timeoutMessage).toBeDefined();
    });
  });

  describe('Template Messages (Phase 1)', () => {
    it('should send template message directly to egress', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].topic).toBe('internal.egress.v1');
      expect(publishedEvents[0].event.type).toBe('chat.message.v1');
      expect(publishedEvents[0].event.candidates![0].text).toBe('🤔 Thinking about your request...');
    });

    it('should copy routing context to progress event', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
        ingress: {
          ingressAt: '2026-07-31T12:00:00.000Z',
          source: 'ingress.slack',
          connector: 'slack',
          channel: 'general',
        },
        egress: {
          destination: 'slack',
          connector: 'slack',
          channel: 'C123',
        },
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      const progressEvent = publishedEvents[0].event;
      expect(progressEvent.ingress).toEqual(event.ingress);
      expect(progressEvent.egress).toEqual(event.egress);
    });

    it('should add progress_feedback annotation', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      const progressEvent = publishedEvents[0].event;
      const feedbackAnnotation = progressEvent.annotations?.find(
        (a) => a.kind === 'progress_feedback'
      );

      expect(feedbackAnnotation).toBeDefined();
      expect(feedbackAnnotation?.source).toBe('feedback-middleware');

      const parsed = JSON.parse(feedbackAnnotation?.value || '{}');
      expect(parsed).toMatchObject({
        originalCorrelationId: event.correlationId,
        stage: 'initial',
      });
      expect(parsed.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('LLM-Generated Messages (Phase 2+)', () => {
    it('should create progress event for LLM generation', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: true, // Enable LLM messages
        }
      );

      const event = createMockEvent({
        annotations: [
          createOperationContext('image_generation', { prompt: 'a sunset over mountains' }),
        ],
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].topic).toBe('internal.ingress.v1');
      expect(publishedEvents[0].event.type).toBe('chat.progress.v1');
    });

    it('should include prompt annotation for LLM', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: true,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
        message: {
          id: randomUUID(),
          role: 'user',
          text: '!image a sunset over mountains',
        },
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      const progressEvent = publishedEvents[0].event;
      const promptAnnotation = progressEvent.annotations?.find((a) => a.kind === 'prompt');

      expect(promptAnnotation).toBeDefined();
      expect(promptAnnotation?.value).toContain('Generate a brief');
      expect(promptAnnotation?.value).toContain('!image a sunset over mountains');
    });

    it('should include progress_context annotation', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: true,
        }
      );

      const event = createMockEvent({
        annotations: [
          createOperationContext('image_generation', { prompt: 'a sunset' }),
        ],
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      const progressEvent = publishedEvents[0].event;
      const contextAnnotation = progressEvent.annotations?.find(
        (a) => a.kind === 'progress_context'
      );

      expect(contextAnnotation).toBeDefined();

      const parsed = JSON.parse(contextAnnotation?.value || '{}');
      expect(parsed).toMatchObject({
        originalCorrelationId: event.correlationId,
        originalMessage: '!image a sunset',
        stage: 'initial',
        operation: 'image_generation',
        parameters: { prompt: 'a sunset' },
      });
    });

    it('should support custom prompt template', async () => {
      const customTemplate = 'Custom prompt: {operation} - {originalMessage}';

      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          useCustomMessages: true,
          promptTemplate: customTemplate,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
        message: {
          id: randomUUID(),
          role: 'user',
          text: '!image a sunset',
        },
      });

      await middleware.beforeNext(event);
      await jest.advanceTimersByTimeAsync(100);

      const progressEvent = publishedEvents[0].event;
      const promptAnnotation = progressEvent.annotations?.find((a) => a.kind === 'prompt');

      expect(promptAnnotation?.value).toBe(
        'Custom prompt: image_generation - !image a sunset'
      );
    });
  });

  describe('Operation Tracking', () => {
    it('should track active operations', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 10000, // No messages yet
        }
      );

      const event1 = createMockEvent({
        correlationId: 'op-1',
        annotations: [createOperationContext('image_generation')],
      });

      const event2 = createMockEvent({
        correlationId: 'op-2',
        annotations: [createOperationContext('video_generation')],
      });

      await middleware.beforeNext(event1);
      await middleware.beforeNext(event2);

      const stats = middleware.getStats();
      expect(stats.activeOperations).toBe(2);
      expect(stats.operations).toHaveLength(2);
      expect(stats.operations.map((o) => o.operation)).toContain('image_generation');
      expect(stats.operations.map((o) => o.operation)).toContain('video_generation');
    });

    it('should complete operation tracking', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 10000,
        }
      );

      const event = createMockEvent({
        correlationId: 'op-1',
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);
      expect(middleware.getStats().activeOperations).toBe(1);

      middleware.completeOperation('op-1');
      expect(middleware.getStats().activeOperations).toBe(0);
    });

    it('should track elapsed time', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 10000,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Advance fake timers by 50ms
      await jest.advanceTimersByTimeAsync(50);

      const stats = middleware.getStats();
      // Allow timing tolerance (fake timers vs real Date.now() can have 1-2ms variance)
      expect(stats.operations[0].elapsedMs).toBeGreaterThanOrEqual(48);
      expect(stats.operations[0].elapsedMs).toBeLessThanOrEqual(52);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid operation_context JSON', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
        }
      );

      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: 'invalid-json{',
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      expect(publishedEvents).toHaveLength(0);
      expect(middleware.getStats().activeOperations).toBe(0);
    });

    it('should not throw on publish failure', async () => {
      const failingPublish = async () => {
        throw new Error('Publish failed');
      };

      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: failingPublish,
        },
        {
          initialThresholdMs: 0,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      // Should not throw
      await expect(middleware.beforeNext(event)).resolves.not.toThrow();
    });
  });

  describe('Progress Stages', () => {
    it('should progress through stages: initial → update → timeout', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          updateIntervalMs: 200,
          timeoutThresholdMs: 500,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Advance to initial threshold (100ms)
      await jest.advanceTimersByTimeAsync(100);
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].event.candidates![0].text).toBe('🤔 Thinking about your request...');

      // Advance to first update (200ms after initial)
      await jest.advanceTimersByTimeAsync(200);
      expect(publishedEvents).toHaveLength(2);
      expect(publishedEvents[1].event.candidates![0].text).toBe('⏳ Still working on it...');

      // Advance to timeout (remaining time: 500ms total - 100ms initial = 400ms, already advanced 300ms, need 200ms more)
      await jest.advanceTimersByTimeAsync(200);

      const timeoutMsg = publishedEvents.find((p) =>
        p.event.candidates?.[0]?.text?.includes('longer than expected')
      );
      expect(timeoutMsg).toBeDefined();
    });

    it('should not send duplicate messages for same stage', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 100,
          updateIntervalMs: 10000, // Long interval
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Advance to initial threshold
      await jest.advanceTimersByTimeAsync(100);
      expect(publishedEvents).toHaveLength(1);

      // Second call to beforeNext should not send another message (timers already running)
      await middleware.beforeNext(event);
      expect(publishedEvents).toHaveLength(1); // Still 1
    });
  });

  // Sprint 21: Tests for annotation timestamp extraction fix
  describe('Annotation Timestamp Extraction (Sprint 21)', () => {
    it('should use startedAt from annotation (number format)', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 1000,
          useCustomMessages: false,
        }
      );

      // Create annotation with startedAt 3 seconds ago (number format)
      const threeSecondsAgo = Date.now() - 3000;
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              startedAt: threeSecondsAgo,
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Operation is completing (beforeNext called) - should NOT send progress message
      await jest.advanceTimersByTimeAsync(0);

      // Should NOT send any progress message (operation already finishing)
      expect(publishedEvents).toHaveLength(0);
    });

    it('should use startedAt from annotation (ISO string format)', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 1000,
          useCustomMessages: false,
        }
      );

      // Create annotation with startedAt 3 seconds ago (ISO string format)
      const threeSecondsAgo = new Date(Date.now() - 3000).toISOString();
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              startedAt: threeSecondsAgo,
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Operation is completing (beforeNext called) - should NOT send progress message
      await jest.advanceTimersByTimeAsync(0);

      // Should NOT send any progress message (operation already finishing)
      expect(publishedEvents).toHaveLength(0);
    });

    it('should fallback to current time when no startedAt in annotation', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 1000,
          useCustomMessages: false,
        }
      );

      // Create annotation WITHOUT startedAt
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              // No startedAt field
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Advance timers to check if message would be sent
      await jest.advanceTimersByTimeAsync(0);

      // Should NOT send progress message because elapsed time ~0ms (timer scheduled for 1000ms in future)
      expect(publishedEvents).toHaveLength(0);
    });

    it('should fallback to current time when startedAt is invalid', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 1000,
          useCustomMessages: false,
        }
      );

      // Create annotation with invalid startedAt
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              startedAt: { invalid: 'object' }, // Invalid format
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Advance timers to check if message would be sent
      await jest.advanceTimersByTimeAsync(0);

      // Should NOT send progress message (fallback to current time, timer scheduled for 1000ms in future)
      expect(publishedEvents).toHaveLength(0);
    });

    it('should NOT send progress when annotation shows elapsed < threshold', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 2000,
          useCustomMessages: false,
        }
      );

      // Create annotation with startedAt 500ms ago (< 2000ms threshold)
      const halfSecondAgo = Date.now() - 500;
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              startedAt: halfSecondAgo,
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Advance by a small amount - should not send yet (needs 1500ms more)
      await jest.advanceTimersByTimeAsync(100);

      // Should NOT send progress message (500ms + 100ms = 600ms < 2000ms)
      expect(publishedEvents).toHaveLength(0);
    });

    it('should skip progress when annotation shows elapsed > threshold', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 1000,
          useCustomMessages: false,
        }
      );

      // Create annotation with startedAt 5 seconds ago (> 1000ms threshold)
      const fiveSecondsAgo = Date.now() - 5000;
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              startedAt: fiveSecondsAgo,
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Operation is completing (beforeNext called) - should NOT send progress message
      await jest.advanceTimersByTimeAsync(0);

      // Should NOT send any progress message (operation already finishing)
      expect(publishedEvents).toHaveLength(0);
    });

    it('should calculate elapsed time correctly from annotation', async () => {
      middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 5000, // Set threshold higher than elapsed time
          useCustomMessages: false,
        }
      );

      // Create annotation with precise timestamp (within threshold)
      const exactlyThreeSecondsAgo = Date.now() - 3000;
      const event = createMockEvent({
        annotations: [
          {
            kind: 'operation_context',
            value: JSON.stringify({
              operation: 'llm_request',
              startedAt: exactlyThreeSecondsAgo,
            }),
            source: 'llm-bot',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      await middleware.beforeNext(event);

      // Advance to when timer should fire (5000ms threshold - 3000ms already elapsed = 2000ms remaining)
      await jest.advanceTimersByTimeAsync(2000);

      // Verify progress message sent
      expect(publishedEvents).toHaveLength(1);

      // Verify the progress_feedback annotation contains timing info
      const progressEvent = publishedEvents[0].event;
      const progressAnnotation = progressEvent.annotations?.find(
        (a) => a.kind === 'progress_feedback'
      );
      expect(progressAnnotation).toBeDefined();

      if (progressAnnotation?.value) {
        const progressData = JSON.parse(progressAnnotation.value);
        // Elapsed time should be approximately 5000ms (3000ms already + 2000ms advance)
        expect(progressData.elapsedMs).toBeGreaterThanOrEqual(4900);
        expect(progressData.elapsedMs).toBeLessThanOrEqual(5100);
      }
    });
  });
});
