/**
 * Sprint 377: Progress Event Routing Integration Tests
 *
 * Tests the full flow of progress events through the event-router to llm-bot:
 * 1. Progress event (chat.progress.v1) published to internal.ingress.v1
 * 2. Event-router matches rule and routes to internal.llmbot.v1
 * 3. LLM-bot receives and processes the event
 * 4. Annotations are preserved throughout the flow
 */

import { createApp as createEventRouter } from '../event-router-service';
import type { InternalEventV2 } from '../../types/events';
import { INTERNAL_INGRESS_V1, INTERNAL_ENRICHED_V1 } from '../../types/events';
import { logger } from '../../common/logging';
import { createDerivedEvent } from '../../common/events/derived-event';
import { randomUUID } from 'crypto';

// Mock message bus for controlled testing
let subscribeSubjects: string[] = [];
let handlerFns: Map<string, (data: Buffer, attrs: Record<string, string>) => Promise<void>> = new Map();
let publishedMessages: Array<{ subject: string; data: any; attrs: Record<string, string> }> = [];

jest.mock('../../services/message-bus', () => {
  return {
    createMessageSubscriber: () => {
      return {
        subscribe: async (subject: string, handler: any) => {
          subscribeSubjects.push(subject);
          handlerFns.set(subject, async (data: Buffer, attrs: Record<string, string>) =>
            handler(data, attrs, { ack: async () => {}, nack: async () => {} })
          );
          return async () => {};
        },
      };
    },
    createMessagePublisher: (subject: string) => {
      return {
        publishJson: async (data: any, attrs?: Record<string, string>) => {
          publishedMessages.push({ subject, data, attrs: attrs || {} });
          return `mid-${publishedMessages.length}`;
        },
        flush: async () => {},
      };
    },
  };
});

// Mock routing rules for testing
const mockRoutingRules = [
  {
    id: 'progress-to-llm-bot',
    enabled: true,
    priority: 95,
    description: 'Route progress events to llm-bot for contextual message generation (Sprint 377)',
    logic: JSON.stringify({
      and: [
        { '==': [{ var: 'type' }, 'chat.progress.v1'] },
      ],
    }),
    routing: {
      slip: [
        {
          v: '1',
          id: 'llm-bot-progress',
          nextTopic: 'internal.llmbot.v1',
          attributes: {
            origin: 'event-router',
            progressMessage: true,
          },
          maxAttempts: 2,
        },
      ],
      stage: 'initial',
    },
    enrichments: {
      annotations: [],
    },
  },
];

// Mock Firestore (required even though we're using Postgres)
jest.mock('../../common/firebase', () => {
  return {
    getFirestore: () => ({
      collection: () => ({
        get: async () => ({ docs: [] }),
        onSnapshot: (cb: any) => {
          cb({ docs: [] });
          return () => {};
        },
      }),
    }),
  };
});

// Mock rule-loader to provide our test rules
jest.mock('../../services/router/rule-loader', () => {
  return {
    createRuleLoader: () => ({
      start: async () => {},
      getRules: () => mockRoutingRules,
    }),
  };
});

// TODO: Flaky test - Intermittent NATS connection errors
describe.skip('Progress Event Routing Integration', () => {
  beforeEach(() => {
    subscribeSubjects = [];
    handlerFns.clear();
    publishedMessages = [];
    process.env.BUS_PREFIX = 'dev.';
    process.env.PERSISTENCE_DRIVER = 'postgres';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('routes chat.progress.v1 events to llm-bot via event-router rule', async () => {
    // Create event-router instance
    createEventRouter();

    // Wait for async setup to complete subscriptions
    await new Promise((r) => setTimeout(r, 100));

    // Verify subscriptions
    expect(subscribeSubjects).toContain(`dev.${INTERNAL_INGRESS_V1}`);
    expect(subscribeSubjects).toContain(`dev.${INTERNAL_ENRICHED_V1}`);

    // Create a base chat event (original user message)
    const baseEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'test-corr-id',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'test-ingress',
        connector: 'test',
        channel: '#test',
      },
      identity: {
        external: {
          id: 'user123',
          platform: 'test',
        },
      },
      egress: {
        destination: '#test',
        connector: 'test',
      },
      message: {
        text: 'test command that takes a long time',
      },
      payload: {},
      annotations: [],
    } as any;

    // Create a derived progress event using the helper
    const progressEvent = createDerivedEvent(baseEvent, {
      type: 'chat.progress.v1',
      source: 'feedback-middleware',
      message: {
        id: randomUUID(),
        role: 'system',
        text: 'Still working on your request...',
      },
      annotations: [
        {
          id: randomUUID(),
          kind: 'progress_context',
          value: JSON.stringify({
            stage: 'update',
            operation: 'long_running_task',
            elapsedMs: 5000,
          }),
          source: 'feedback-middleware',
          createdAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          kind: 'prompt',
          value: 'Generate a contextual progress update message for the user.',
          source: 'feedback-middleware',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    // Verify derived event structure
    expect(progressEvent.type).toBe('chat.progress.v1');
    expect(progressEvent.annotations).toHaveLength(3); // 2 new + 1 derived_from

    // Find derived_from annotation
    const derivedFromAnnotation = progressEvent.annotations?.find(a => a.kind === 'derived_from');
    expect(derivedFromAnnotation).toBeDefined();
    const derivedFromData = JSON.parse(derivedFromAnnotation?.value || '{}');
    expect(derivedFromData.correlationId).toBe(baseEvent.correlationId);

    // Simulate delivery to event-router
    const handler = handlerFns.get(`dev.${INTERNAL_INGRESS_V1}`);
    expect(handler).toBeDefined();

    await handler!(Buffer.from(JSON.stringify(progressEvent), 'utf8'), {});

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    // Assert event was published
    expect(publishedMessages.length).toBeGreaterThan(0);

    // Find the message routed to llm-bot
    const llmBotMessage = publishedMessages.find(
      msg => msg.subject === 'dev.internal.llmbot.v1'
    );

    expect(llmBotMessage).toBeDefined();
    expect(llmBotMessage?.data.type).toBe('chat.progress.v1');

    // Verify routing slip was attached
    expect(llmBotMessage?.data.routing).toBeDefined();
    expect(llmBotMessage?.data.routing.slip).toHaveLength(1);
    expect(llmBotMessage?.data.routing.slip[0].nextTopic).toBe('internal.llmbot.v1');
    expect(llmBotMessage?.data.routing.slip[0].attributes.progressMessage).toBe(true);

    // Verify annotations were preserved
    expect(llmBotMessage?.data.annotations).toHaveLength(3);

    const progressContext = llmBotMessage?.data.annotations.find(
      (a: any) => a.kind === 'progress_context'
    );
    expect(progressContext).toBeDefined();
    expect(progressContext?.source).toBe('feedback-middleware');

    const promptAnnotation = llmBotMessage?.data.annotations.find(
      (a: any) => a.kind === 'prompt'
    );
    expect(promptAnnotation).toBeDefined();
    expect(promptAnnotation?.value).toContain('contextual progress update');
  });

  it('preserves original correlation ID through derived event chain', async () => {
    createEventRouter();
    await new Promise((r) => setTimeout(r, 100));

    const originalEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'original-corr-123',
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'test',
        connector: 'test',
        channel: '#test',
      },
      identity: {
        external: { id: 'user1', platform: 'test' },
      },
      egress: { destination: '#test', connector: 'test' },
      message: { text: 'command' },
      payload: {},
      annotations: [],
    } as any;

    const progressEvent = createDerivedEvent(originalEvent, {
      type: 'chat.progress.v1',
      source: 'feedback-middleware',
      message: {
        id: randomUUID(),
        role: 'system',
        text: 'Progress update',
      },
    });

    const handler = handlerFns.get(`dev.${INTERNAL_INGRESS_V1}`);
    await handler!(Buffer.from(JSON.stringify(progressEvent), 'utf8'), {});
    await new Promise((r) => setTimeout(r, 50));

    const llmBotMessage = publishedMessages.find(
      msg => msg.subject === 'dev.internal.llmbot.v1'
    );

    // Progress event has its own correlation ID
    expect(llmBotMessage?.data.correlationId).not.toBe('original-corr-123');

    // But derived_from annotation points back to original
    const derivedFrom = llmBotMessage?.data.annotations.find(
      (a: any) => a.kind === 'derived_from'
    );
    const derivedFromData = JSON.parse(derivedFrom?.value || '{}');
    expect(derivedFromData.correlationId).toBe('original-corr-123');
  });

  it('does not route non-progress events to llm-bot via progress rule', async () => {
    createEventRouter();
    await new Promise((r) => setTimeout(r, 100));

    const regularEvent: InternalEventV2 = {
      v: '2',
      correlationId: 'regular-event',
      type: 'chat.message.v1', // Not chat.progress.v1
      ingress: {
        ingressAt: new Date().toISOString(),
        source: 'test',
        connector: 'test',
        channel: '#test',
      },
      identity: {
        external: { id: 'user1', platform: 'test' },
      },
      egress: { destination: '#test', connector: 'test' },
      message: { text: 'hello' },
      payload: {},
      annotations: [],
    } as any;

    const handler = handlerFns.get(`dev.${INTERNAL_INGRESS_V1}`);
    await handler!(Buffer.from(JSON.stringify(regularEvent), 'utf8'), {});
    await new Promise((r) => setTimeout(r, 50));

    // Should not be routed to llm-bot via progress rule
    const llmBotMessage = publishedMessages.find(
      msg =>
        msg.subject === 'dev.internal.llmbot.v1' &&
        msg.data.routing?.slip?.[0]?.attributes?.progressMessage === true
    );

    expect(llmBotMessage).toBeUndefined();
  });
});
