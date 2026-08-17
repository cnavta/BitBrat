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

  beforeEach(() => {
    // Mock logger
    mockLogger = pino({ level: 'silent' }) as unknown as Logger;

    // Mock publish function
    publishedEvents = [];
    mockPublish = async (topic: string, event: InternalEventV2) => {
      publishedEvents.push({ topic, event });
    };
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
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0, // Immediate
          useCustomMessages: false, // Template messages
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].topic).toBe('internal.egress.v1');
      expect(publishedEvents[0].event.message?.text).toBe('🤔 Thinking about your request...');
    });

    it('should not send progress before initial threshold', async () => {
      const middleware = new FeedbackMiddleware(
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

      expect(publishedEvents).toHaveLength(0);
    });

    it('should send update progress after update interval', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          updateIntervalMs: 0, // Immediate updates
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      // First call - initial
      await middleware.beforeNext(event);
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].event.message?.text).toBe('🤔 Thinking about your request...');

      // Second call - update
      await middleware.beforeNext(event);
      expect(publishedEvents).toHaveLength(2);
      expect(publishedEvents[1].event.message?.text).toBe('⏳ Still working on it...');
    });

    it('should send timeout warning after timeout threshold', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          updateIntervalMs: 0,
          timeoutThresholdMs: 0, // Immediate timeout
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      const timeoutMessage = publishedEvents.find(
        (p) => p.event.message?.text?.includes('longer than expected')
      );

      expect(timeoutMessage).toBeDefined();
    });
  });

  describe('Template Messages (Phase 1)', () => {
    it('should send template message directly to egress', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].topic).toBe('internal.egress.v1');
      expect(publishedEvents[0].event.type).toBe('internal.egress.v1');
      expect(publishedEvents[0].event.message?.text).toBe('🤔 Thinking about your request...');
    });

    it('should copy routing context to progress event', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
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

      const progressEvent = publishedEvents[0].event;
      expect(progressEvent.ingress).toEqual(event.ingress);
      expect(progressEvent.egress).toEqual(event.egress);
    });

    it('should add progress_feedback annotation', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

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
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          useCustomMessages: true, // Enable LLM messages
        }
      );

      const event = createMockEvent({
        annotations: [
          createOperationContext('image_generation', { prompt: 'a sunset over mountains' }),
        ],
      });

      await middleware.beforeNext(event);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].topic).toBe('internal.ingress.v1');
      expect(publishedEvents[0].event.type).toBe('chat.progress.v1');
    });

    it('should include prompt annotation for LLM', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
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

      const progressEvent = publishedEvents[0].event;
      const promptAnnotation = progressEvent.annotations?.find((a) => a.kind === 'prompt');

      expect(promptAnnotation).toBeDefined();
      expect(promptAnnotation?.value).toContain('Generate a brief');
      expect(promptAnnotation?.value).toContain('!image a sunset over mountains');
    });

    it('should include progress_context annotation', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          useCustomMessages: true,
        }
      );

      const event = createMockEvent({
        annotations: [
          createOperationContext('image_generation', { prompt: 'a sunset' }),
        ],
      });

      await middleware.beforeNext(event);

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

      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
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
        annotations: [createOperationContext('image_generation')],
      });

      await middleware.beforeNext(event);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = middleware.getStats();
      expect(stats.operations[0].elapsedMs).toBeGreaterThanOrEqual(50);
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
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          updateIntervalMs: 10, // Ensure initial is sent first
          timeoutThresholdMs: 100, // Timeout after 100ms
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      // Initial
      await middleware.beforeNext(event);
      expect(publishedEvents[0].event.message?.text).toBe('🤔 Thinking about your request...');

      // Wait for update interval
      await new Promise((resolve) => setTimeout(resolve, 15));

      // Update
      await middleware.beforeNext(event);
      expect(publishedEvents[1].event.message?.text).toBe('⏳ Still working on it...');

      // Wait for timeout threshold
      await new Promise((resolve) => setTimeout(resolve, 100));
      await middleware.beforeNext(event);

      const timeoutMsg = publishedEvents.find((p) =>
        p.event.message?.text?.includes('longer than expected')
      );
      expect(timeoutMsg).toBeDefined();
    });

    it('should not send duplicate messages for same stage', async () => {
      const middleware = new FeedbackMiddleware(
        {
          getLogger: () => mockLogger,
          publish: mockPublish,
        },
        {
          initialThresholdMs: 0,
          updateIntervalMs: 10000, // Long interval
          useCustomMessages: false,
        }
      );

      const event = createMockEvent({
        annotations: [createOperationContext('image_generation')],
      });

      // Initial
      await middleware.beforeNext(event);
      expect(publishedEvents).toHaveLength(1);

      // Immediate second call - should not send another message
      await middleware.beforeNext(event);
      expect(publishedEvents).toHaveLength(1); // Still 1
    });
  });
});
