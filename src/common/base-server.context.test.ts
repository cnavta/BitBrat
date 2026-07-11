/**
 * BaseServer EventContext Integration Tests
 *
 * Tests for automatic EventContext injection in message handlers.
 * Validates that correlationId and other context fields are automatically
 * available to all message handlers without manual parameter passing.
 */

import { Bit } from './base-server';
import { getEventContext, runWithEventContext } from './event-context';
import type { InternalEventV2 } from '../types/events';

// Mock message bus to avoid actual pub/sub connections
jest.mock('../services/message-bus', () => ({
  createMessageSubscriber: jest.fn(() => ({
    subscribe: jest.fn(async (subject: string, handler: any, options: any) => {
      // Store handler for manual triggering in tests
      (global as any).__testMessageHandler = handler;
      return jest.fn(); // unsubscribe function
    }),
  })),
  createMessagePublisher: jest.fn(() => ({
    publish: jest.fn(),
    close: jest.fn(),
  })),
}));

describe('BaseServer EventContext Integration', () => {
  let testBit: TestBit;
  let handlerCalls: Array<{ correlationId?: string; userId?: string; stage?: string }>;

  // Test Bit implementation
  class TestBit extends Bit {
    public handlers: Map<string, any> = new Map();

    constructor() {
      super({
        serviceName: 'test-context-service',
        mcpExposure: 'platform-only',
      });
      handlerCalls = [];
    }

    // Public wrapper to register message handlers for testing
    public async registerTestHandler(topic: string, handler: any): Promise<void> {
      this.handlers.set(topic, handler);
      await this.onMessage(topic, handler);
    }

    async setup(): Promise<void> {
      // Register a test message handler
      await this.registerTestHandler('test.context.v1', async (data: any) => {
        // Capture context from within the handler
        const ctx = getEventContext();
        handlerCalls.push({
          correlationId: ctx?.correlationId,
          userId: ctx?.userId,
          stage: ctx?.stage,
        });
      });
    }
  }

  beforeEach(async () => {
    handlerCalls = [];
    testBit = new TestBit();
    await testBit.setup();
  });

  afterEach(async () => {
    // Cleanup (no shutdown method needed for tests)
  });

  it('automatically injects correlationId from message into EventContext', async () => {
    const testMessage: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'test-correlation-123',
      type: 'test.message.v1',
    };

    // Simulate message arrival
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(testMessage)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0].correlationId).toBe('test-correlation-123');
  });

  it('injects all EventContext fields from message', async () => {
    const testMessage: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'corr-456',
      traceId: 'trace-789',
      type: 'test.message.v1',
      identity: {
        external: { id: 'ext-123', platform: 'test' },
        user: { id: 'user-abc', displayName: 'Test User' },
      },
      routing: {
        stage: 'analysis',
        slip: [],
        history: [],
      },
      metadata: {
        sessionId: 'session-def',
        requestId: 'request-ghi',
      },
    } as any;

    // Register handler that captures all fields
    let capturedContext: any;
    await testBit.registerTestHandler('test.full-context.v1', async (data: any) => {
      capturedContext = getEventContext();
    });

    // Simulate message arrival
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(testMessage)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    expect(capturedContext).toBeDefined();
    expect(capturedContext.correlationId).toBe('corr-456');
    expect(capturedContext.traceId).toBe('trace-789');
    expect(capturedContext.userId).toBe('user-abc');
    expect(capturedContext.sessionId).toBe('session-def');
    expect(capturedContext.requestId).toBe('request-ghi');
    expect(capturedContext.stage).toBe('analysis');
  });

  it('works correctly when message has no correlationId', async () => {
    const testMessage = {
      type: 'test.message.v1',
      // No correlationId
    };

    // Simulate message arrival
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(testMessage)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0].correlationId).toBeUndefined();
  });

  it('maintains context through nested async operations', async () => {
    const testMessage: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'nested-test-789',
      type: 'test.nested.v1',
    };

    const contextCaptures: string[] = [];

    await testBit.registerTestHandler('test.nested.v1', async (data: any) => {
      // Capture at handler level
      contextCaptures.push(getEventContext()?.correlationId || 'none');

      // Nested async operation
      await new Promise<void>(resolve => setTimeout(() => {
        contextCaptures.push(getEventContext()?.correlationId || 'none');
        resolve();
      }, 10));

      // Another nested operation
      await (async () => {
        contextCaptures.push(getEventContext()?.correlationId || 'none');
      })();
    });

    // Simulate message arrival
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(testMessage)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    // All nested operations should have the same correlationId
    expect(contextCaptures).toHaveLength(3);
    expect(contextCaptures).toEqual([
      'nested-test-789',
      'nested-test-789',
      'nested-test-789',
    ]);
  });

  it('isolates context between concurrent message handlers', async () => {
    const message1: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'concurrent-1',
      type: 'test.concurrent.v1',
    };

    const message2: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'concurrent-2',
      type: 'test.concurrent.v1',
    };

    const contextCaptures: string[] = [];

    await testBit.registerTestHandler('test.concurrent.v1', async (data: any) => {
      const corrId = getEventContext()?.correlationId || 'none';
      await new Promise(resolve => setTimeout(resolve, 5));
      contextCaptures.push(corrId);
    });

    // Simulate two concurrent messages
    const handler = (global as any).__testMessageHandler;
    await Promise.all([
      handler(
        Buffer.from(JSON.stringify(message1)),
        {},
        { ack: jest.fn(), nack: jest.fn() }
      ),
      handler(
        Buffer.from(JSON.stringify(message2)),
        {},
        { ack: jest.fn(), nack: jest.fn() }
      ),
    ]);

    // Both handlers should have captured their own correlationId
    expect(contextCaptures).toHaveLength(2);
    expect(contextCaptures.sort()).toEqual(['concurrent-1', 'concurrent-2']);
  });

  it('preserves context when handler throws error', async () => {
    const testMessage: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'error-test-abc',
      type: 'test.error.v1',
    };

    let capturedCorrelationId: string | undefined;

    await testBit.registerTestHandler('test.error.v1', async (data: any) => {
      capturedCorrelationId = getEventContext()?.correlationId;
      throw new Error('Test error');
    });

    // Simulate message arrival (error will be caught by base-server)
    const handler = (global as any).__testMessageHandler;
    try {
      await handler(
        Buffer.from(JSON.stringify(testMessage)),
        {},
        { ack: jest.fn(), nack: jest.fn() }
      );
    } catch {
      // Error expected
    }

    // Context should have been available before error
    expect(capturedCorrelationId).toBe('error-test-abc');
  });

  it('handles malformed message data gracefully', async () => {
    const malformedMessage = {
      // Missing required fields
      someField: 'value',
    };

    let handlerExecuted = false;
    await testBit.registerTestHandler('test.malformed.v1', async (data: any) => {
      handlerExecuted = true;
      // Should not throw even with malformed data
      const ctx = getEventContext();
      expect(ctx).toBeDefined(); // Context object exists
      expect(ctx?.correlationId).toBeUndefined(); // But fields are undefined
    });

    // Simulate message arrival
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(malformedMessage)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    expect(handlerExecuted).toBe(true);
  });

  it('handles null/undefined data gracefully', async () => {
    const testCases = [null, undefined, '', {}];

    for (const testCase of testCases) {
      let handlerExecuted = false;
      await testBit.registerTestHandler('test.null.v1', async (data: any) => {
        handlerExecuted = true;
        const ctx = getEventContext();
        expect(ctx).toBeDefined();
      });

      // Simulate message arrival
      const handler = (global as any).__testMessageHandler;
      try {
        await handler(
          Buffer.from(JSON.stringify(testCase)),
          {},
          { ack: jest.fn(), nack: jest.fn() }
        );
      } catch {
        // Some cases may fail JSON parsing, which is fine
      }
    }
  });

  it('allows manual context updates within handler', async () => {
    const testMessage: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'update-test-def',
      type: 'test.update.v1',
    };

    const contextCaptures: Array<{ correlationId?: string; stage?: string }> = [];

    await testBit.registerTestHandler('test.update.v1', async (data: any) => {
      // Initial context
      let ctx = getEventContext();
      contextCaptures.push({
        correlationId: ctx?.correlationId,
        stage: ctx?.stage,
      });

      // Manually update context (e.g., to track processing stage)
      const { updateEventContext } = await import('./event-context');
      updateEventContext({ stage: 'custom-stage' });

      // Context after update
      ctx = getEventContext();
      contextCaptures.push({
        correlationId: ctx?.correlationId,
        stage: ctx?.stage,
      });
    });

    // Simulate message arrival
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(testMessage)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    expect(contextCaptures).toHaveLength(2);
    expect(contextCaptures[0]).toEqual({
      correlationId: 'update-test-def',
      stage: undefined,
    });
    expect(contextCaptures[1]).toEqual({
      correlationId: 'update-test-def',
      stage: 'custom-stage',
    });
  });

  it('context does not leak between sequential messages', async () => {
    const message1: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'sequential-1',
      type: 'test.sequential.v1',
    };

    const message2: Partial<InternalEventV2> = {
      v: '2',
      correlationId: 'sequential-2',
      type: 'test.sequential.v1',
    };

    const contextCaptures: string[] = [];

    await testBit.registerTestHandler('test.sequential.v1', async (data: any) => {
      const corrId = getEventContext()?.correlationId || 'none';
      contextCaptures.push(corrId);
    });

    // Simulate sequential messages
    const handler = (global as any).__testMessageHandler;
    await handler(
      Buffer.from(JSON.stringify(message1)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );
    await handler(
      Buffer.from(JSON.stringify(message2)),
      {},
      { ack: jest.fn(), nack: jest.fn() }
    );

    // Each message should have its own correlationId
    expect(contextCaptures).toEqual(['sequential-1', 'sequential-2']);
  });
});
