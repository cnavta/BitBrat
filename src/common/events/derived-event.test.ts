/**
 * derived-event.test.ts
 *
 * Unit tests for derived event utilities.
 *
 * Sprint 377: Long-Running Task Feedback
 */

import {
  createDerivedEvent,
  createProgressEvent,
  getOriginalCorrelationId,
  isDerivedEvent,
  getDerivationChain,
  DerivedEventTypes,
} from './derived-event';
import type { InternalEventV2, AnnotationV1 } from '../../types/events';
import { randomUUID } from 'crypto';

describe('Derived Event Utilities', () => {
  // Mock original event
  const createMockEvent = (): InternalEventV2 => ({
    v: '2',
    correlationId: 'original-correlation-123',
    type: 'chat.message.v1',
    ingress: {
      ingressAt: '2026-07-31T12:00:00.000Z',
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
    qos: {
      maxResponseMs: 75000,
      tracer: true,
    },
    routing: {
      stage: 'analysis',
      slip: [],
      history: [],
    },
    annotations: [
      {
        kind: 'command',
        value: 'image',
        source: 'query-analyzer',
        id: randomUUID(),
        createdAt: '2026-07-31T12:00:01.000Z',
      },
    ],
  });

  describe('createDerivedEvent', () => {
    it('should create a derived event with new identifiers', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.correlationId).toBeDefined();
      expect(derived.correlationId).not.toBe(original.correlationId);
    });

    it('should copy routing context from original event', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.ingress).toEqual(original.ingress);
      expect(derived.identity).toEqual(original.identity);
      expect(derived.egress).toEqual(original.egress);
    });

    it('should copy message from original event by default', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.message).toEqual(original.message);
      expect(derived.message?.text).toBe('!image a sunset');
    });

    it('should allow overriding message field', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
        message: {
          id: randomUUID(),
          role: 'assistant',
          text: 'Custom message'
        },
      });

      expect(derived.message?.text).toBe('Custom message');
    });

    it('should allow clearing message field', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
        message: null,
      });

      expect(derived.message).toBeUndefined();
    });

    it('should set type at root level', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.type).toBe('chat.progress.v1');
    });

    it('should create minimal payload by default', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.payload).toEqual({});
    });

    it('should copy QoS from original event', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.qos).toEqual({
        maxResponseMs: 75000,
        tracer: true,
      });
    });

    it('should allow overriding QoS', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
        qos: {
          maxResponseMs: 3000,
        },
      });

      expect(derived.qos).toEqual({
        maxResponseMs: 3000,
      });
    });

    it('should set routing.stage to initial', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(derived.routing).toEqual({
        stage: 'initial',
        slip: [],
        history: [],
      });
    });

    it('should add derived_from annotation', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      const derivedFromAnnotation = derived.annotations?.find(
        (a) => a.kind === 'derived_from'
      );

      expect(derivedFromAnnotation).toBeDefined();
      expect(derivedFromAnnotation?.source).toBe('feedback-middleware');

      // Value is JSON string
      const parsed = JSON.parse(derivedFromAnnotation?.value || '{}');
      expect(parsed.correlationId).toBe('original-correlation-123');
      expect(parsed.type).toBe('chat.message.v1');
      expect(parsed.source).toBe('feedback-middleware');
      expect(parsed.derivedAt).toBeDefined();
    });

    it('should include custom annotations', () => {
      const original = createMockEvent();
      const customAnnotation: AnnotationV1 = {
        kind: 'progress_context',
        value: JSON.stringify({ stage: 'initial', operation: 'image_generation' }),
        source: 'feedback-middleware',
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };

      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
        annotations: [customAnnotation],
      });

      expect(derived.annotations).toHaveLength(2); // derived_from + custom
      expect(derived.annotations?.find((a) => a.kind === 'derived_from')).toBeDefined();
      expect(derived.annotations?.find((a) => a.kind === 'progress_context')).toEqual(
        customAnnotation
      );
    });
  });

  describe('getOriginalCorrelationId', () => {
    it('should return correlationId from derived_from annotation', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      const originalId = getOriginalCorrelationId(derived);

      expect(originalId).toBe('original-correlation-123');
    });

    it('should return own correlationId if not derived', () => {
      const original = createMockEvent();
      const originalId = getOriginalCorrelationId(original);

      expect(originalId).toBe('original-correlation-123');
    });

    it('should return own correlationId if derived_from annotation missing', () => {
      const event: InternalEventV2 = {
        ...createMockEvent(),
        annotations: [], // No derived_from annotation
      };

      const originalId = getOriginalCorrelationId(event);

      expect(originalId).toBe('original-correlation-123');
    });
  });

  describe('isDerivedEvent', () => {
    it('should return true for derived events', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      expect(isDerivedEvent(derived)).toBe(true);
    });

    it('should return false for non-derived events', () => {
      const original = createMockEvent();

      expect(isDerivedEvent(original)).toBe(false);
    });

    it('should return false if annotations are undefined', () => {
      const event: InternalEventV2 = {
        ...createMockEvent(),
        annotations: undefined,
      };

      expect(isDerivedEvent(event)).toBe(false);
    });
  });

  describe('getDerivationChain', () => {
    it('should return single correlationId for non-derived events', () => {
      const original = createMockEvent();
      const chain = getDerivationChain(original);

      expect(chain).toEqual(['original-correlation-123']);
    });

    it('should return chain for derived events', () => {
      const original = createMockEvent();
      const derived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      const chain = getDerivationChain(derived);

      expect(chain).toHaveLength(2);
      expect(chain[0]).toBe('original-correlation-123'); // Original first
      expect(chain[1]).toBe(derived.correlationId); // Derived second
    });

    it('should handle multi-level derivation', () => {
      const original = createMockEvent();
      const firstDerived = createDerivedEvent(original, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });
      const secondDerived = createDerivedEvent(firstDerived, {
        type: 'chat.progress.v1',
        source: 'feedback-middleware',
      });

      const chain = getDerivationChain(secondDerived);

      // Note: Current implementation can only track one level back
      // (requires event store lookup for full chain)
      expect(chain).toHaveLength(2);
      expect(chain[0]).toBe(firstDerived.correlationId); // Immediate parent
      expect(chain[1]).toBe(secondDerived.correlationId); // Current
    });
  });

  describe('DerivedEventTypes', () => {
    it('should provide standard event type constants', () => {
      expect(DerivedEventTypes.PROGRESS).toBe('chat.progress.v1');
      expect(DerivedEventTypes.ERROR).toBe('chat.error.v1');
      expect(DerivedEventTypes.STATUS).toBe('chat.status.v1');
      expect(DerivedEventTypes.CONFIRM).toBe('chat.confirm.v1');
      expect(DerivedEventTypes.TIMEOUT_WARNING).toBe('chat.timeout.v1');
      expect(DerivedEventTypes.CANCELLED).toBe('chat.cancelled.v1');
    });
  });

  describe('createProgressEvent', () => {
    it('should create progress event with correct structure', () => {
      const original = createMockEvent();
      const progressEvent = createProgressEvent(
        original,
        'initial',
        {
          operation: 'image_generation',
          parameters: { prompt: 'a sunset' },
          elapsedMs: 5000,
        },
        'Generate brief progress message...'
      );

      expect(progressEvent.type).toBe('chat.progress.v1');
      expect(isDerivedEvent(progressEvent)).toBe(true);
      expect(getOriginalCorrelationId(progressEvent)).toBe('original-correlation-123');
    });

    it('should include progress_context annotation', () => {
      const original = createMockEvent();
      const progressEvent = createProgressEvent(
        original,
        'initial',
        {
          operation: 'image_generation',
          parameters: { prompt: 'a sunset' },
          elapsedMs: 5000,
        },
        'Generate brief progress message...'
      );

      const progressContext = progressEvent.annotations?.find(
        (a) => a.kind === 'progress_context'
      );

      expect(progressContext).toBeDefined();
      const parsed = JSON.parse(progressContext?.value || '{}');
      expect(parsed).toMatchObject({
        originalCorrelationId: 'original-correlation-123',
        originalMessage: '!image a sunset',
        stage: 'initial',
        operation: 'image_generation',
        parameters: { prompt: 'a sunset' },
        elapsedMs: 5000,
      });
    });

    it('should include prompt annotation', () => {
      const original = createMockEvent();
      const progressEvent = createProgressEvent(
        original,
        'initial',
        { operation: 'image_generation' },
        'Generate brief progress message...'
      );

      const promptAnnotation = progressEvent.annotations?.find(
        (a) => a.kind === 'prompt'
      );

      expect(promptAnnotation).toBeDefined();
      expect(promptAnnotation?.value).toBe('Generate brief progress message...');
      expect(promptAnnotation?.source).toBe('feedback-middleware');
    });

    it('should support custom source', () => {
      const original = createMockEvent();
      const progressEvent = createProgressEvent(
        original,
        'initial',
        { operation: 'image_generation' },
        'Generate brief progress message...',
        'custom-source'
      );

      const derivedFrom = progressEvent.annotations?.find(
        (a) => a.kind === 'derived_from'
      );

      expect(derivedFrom?.source).toBe('custom-source');
      const parsed = JSON.parse(derivedFrom?.value || '{}');
      expect(parsed).toMatchObject({
        source: 'custom-source',
      });
    });

    it('should support all progress stages', () => {
      const original = createMockEvent();

      const stages: Array<'initial' | 'update' | 'timeout' | 'completion'> = [
        'initial',
        'update',
        'timeout',
        'completion',
      ];

      for (const stage of stages) {
        const progressEvent = createProgressEvent(
          original,
          stage,
          { operation: 'test' },
          'Test prompt'
        );

        const progressContext = progressEvent.annotations?.find(
          (a) => a.kind === 'progress_context'
        );

        const parsed = JSON.parse(progressContext?.value || '{}');
        expect(parsed).toMatchObject({ stage });
      }
    });
  });

  describe('Real-world use case: Progress message flow', () => {
    it('should create progress event that llm-bot can process', () => {
      // 1. Original user request
      const originalEvent = createMockEvent();

      // 2. Feedback middleware creates progress event
      const progressEvent = createProgressEvent(
        originalEvent,
        'initial',
        {
          operation: 'image_generation',
          parameters: {
            prompt: 'a sunset over mountains',
            aspectRatio: '16:9',
          },
          startedAt: originalEvent.ingress.ingressAt,
          elapsedMs: 5000,
        },
        'Generate a brief, encouraging message (max 100 chars) that the user\'s image is being created. Reference the image subject from the prompt. Use an emoji. Be concise and friendly.',
        'feedback-middleware'
      );

      // 3. Verify progress event structure
      expect(progressEvent.type).toBe('chat.progress.v1');
      expect(progressEvent.ingress.connector).toBe('slack');
      expect(progressEvent.egress.channel).toBe('C123');
      expect(progressEvent.identity.external.id).toBe('U123');
      expect(progressEvent.message?.text).toBe('!image a sunset'); // Original message copied

      // 4. Verify llm-bot can extract prompt and context
      const promptAnnotation = progressEvent.annotations?.find((a) => a.kind === 'prompt');
      const contextAnnotation = progressEvent.annotations?.find(
        (a) => a.kind === 'progress_context'
      );

      expect(promptAnnotation?.value).toContain('Generate a brief');
      const contextParsed = JSON.parse(contextAnnotation?.value || '{}');
      expect(contextParsed).toMatchObject({
        originalCorrelationId: 'original-correlation-123',
        originalMessage: '!image a sunset',
        stage: 'initial',
        operation: 'image_generation',
        parameters: {
          prompt: 'a sunset over mountains',
          aspectRatio: '16:9',
        },
      });

      // 5. Verify traceability
      expect(getOriginalCorrelationId(progressEvent)).toBe('original-correlation-123');
      expect(isDerivedEvent(progressEvent)).toBe(true);
      expect(getDerivationChain(progressEvent)).toContain('original-correlation-123');
    });
  });
});
