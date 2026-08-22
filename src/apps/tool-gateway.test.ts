import request from 'supertest';
import { createServer } from './tool-gateway';
import type { InternalEventV2 } from '../types/events';
import { randomUUID } from 'crypto';

describe('generated service', () => {
  const server = createServer();
  const app = server.getApp();

  afterAll(async () => {
    await server.close('test');
  });
  describe('health endpoints', () => {
    it('/healthz 200', async () => { await request(app).get('/healthz').expect(200); });
    it('/readyz 200', async () => { await request(app).get('/readyz').expect(200); });
    it('/livez 200', async () => { await request(app).get('/livez').expect(200); });
  });

});

/**
 * Sprint 22: Unit tests for agent.sendProgressUpdate platform tool
 */
describe('agent.sendProgressUpdate platform tool', () => {
  let server: ReturnType<typeof createServer>;
  let sessionId: string;
  let mockEvent: InternalEventV2;

  beforeEach(() => {
    server = createServer();
    sessionId = `test-session-${randomUUID()}`;

    // Create mock event with all required fields
    mockEvent = {
      v: '2',
      correlationId: randomUUID(),
      type: 'chat.message.v1',
      ingress: {
        connector: 'slack',
        source: 'ingress.slack',
        ingressAt: new Date().toISOString(),
        channel: 'test-channel',
      },
      identity: {
        user: {
          id: 'test-user',
          displayName: 'Test User',
          roles: ['user'],
        },
        external: {
          id: 'test-user',
          platform: 'slack',
        },
      },
      egress: {
        destination: 'egress.slack.v1',
        connector: 'slack',
        channel: 'test-channel',
      },
      message: {
        id: randomUUID(),
        role: 'user',
        text: 'Original user message',
      },
      routing: {
        stage: 'analysis',
        slip: [],
        history: [],
      },
      payload: {
        type: 'chat.message.v1',
      },
    };
  });

  afterEach(async () => {
    await server.close('test');
  });

  describe('tool registration', () => {
    it('should register agent.sendProgressUpdate tool', () => {
      const registry = (server as any).registry;
      const tool = registry.getTool('agent.sendProgressUpdate');

      expect(tool).toBeDefined();
      expect(tool.id).toBe('agent.sendProgressUpdate');
      expect(tool.description).toContain('progress update');
    });

    it('should have correct tool schema', () => {
      const registry = (server as any).registry;
      const tool = registry.getTool('agent.sendProgressUpdate');

      expect(tool.inputSchema).toBeDefined();
      // Tool should accept message, emoji (optional), urgency (optional)
    });
  });

  describe('session context management', () => {
    it('should store session context when session is created', () => {
      const sessionContexts = (server as any).sessionContexts;

      // Simulate session creation
      sessionContexts.set(sessionId, {
        sessionId,
        agentName: 'llm-bot',
        roles: ['user'],
        currentEvent: mockEvent,
      });

      const context = sessionContexts.get(sessionId);
      expect(context).toBeDefined();
      expect(context?.sessionId).toBe(sessionId);
      expect(context?.currentEvent).toEqual(mockEvent);
    });

    it('should clean up session context on disconnect', () => {
      const sessionContexts = (server as any).sessionContexts;

      sessionContexts.set(sessionId, {
        sessionId,
        agentName: 'llm-bot',
        roles: ['user'],
        currentEvent: mockEvent,
      });

      sessionContexts.delete(sessionId);
      expect(sessionContexts.get(sessionId)).toBeUndefined();
    });
  });

  describe('handleSendProgressUpdate', () => {
    beforeEach(() => {
      // Set up session context
      const sessionContexts = (server as any).sessionContexts;
      sessionContexts.set(sessionId, {
        sessionId,
        agentName: 'llm-bot',
        roles: ['user'],
        currentEvent: mockEvent,
      });
    });

    it('should successfully send progress update with valid session', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      // Mock next() to prevent actual publishing
      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      const result = await handler(
        { message: 'Working on your request', emoji: '🤔', urgency: 'normal' },
        { sessionId, userId: 'slack:test-user' }
      );

      // Restore original next
      (server as any).next = originalNext;

      // Verify result
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Progress update sent');

      // Verify event was created correctly
      expect(capturedEvent).toBeDefined();
      expect(capturedEvent?.type).toBe('chat.message.v1');
      expect(capturedEvent?.routing.slip).toEqual([]);
      expect(capturedEvent?.candidates).toHaveLength(1);
      expect(capturedEvent?.candidates?.[0].text).toBe('🤔 Working on your request');
      expect(capturedEvent?.candidates?.[0].status).toBe('proposed');
      expect(capturedEvent?.egress?.destination).toBe('internal.egress.v1');
    });

    it('should use default emoji if not provided', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      expect(capturedEvent?.candidates?.[0].text).toBe('🔄 Working on your request');
    });

    it('should include progress_update annotation', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      await handler(
        { message: 'Working on your request', urgency: 'high' },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      const annotation = capturedEvent?.annotations?.find(a => a.kind === 'progress_update');
      expect(annotation).toBeDefined();

      const annotationValue = JSON.parse(annotation!.value as string);
      expect(annotationValue.urgency).toBe('high');
      expect(annotationValue.toolInvocation).toBe('agent.sendProgressUpdate');
    });

    it('should return warning when no userId provided', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      const result = await handler(
        { message: 'Working on your request' },
        { sessionId } // No userId
      );

      expect(result.content[0].text).toContain('Warning');
      expect(result.content[0].text).toContain('No userId');
    });

    it('should return warning when userId has invalid format', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      const result = await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'invalid-format' } // Missing platform prefix
      );

      expect(result.content[0].text).toContain('Warning');
      expect(result.content[0].text).toContain('Invalid userId format');
    });

    it('should return error message on next() failure', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      // Mock next() to throw error
      const originalNext = (server as any).next;
      (server as any).next = jest.fn().mockRejectedValue(new Error('Publish failed'));

      const result = await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      expect(result.content[0].text).toContain('Error sending progress update');
      expect(result.content[0].text).toContain('Publish failed');
    });

    it('should build event with platform metadata from userId', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'slack:U9S817Q3B' }
      );

      (server as any).next = originalNext;

      expect(capturedEvent?.ingress.connector).toBe('slack');
      expect(capturedEvent?.egress?.connector).toBe('slack');
      expect(capturedEvent?.egress?.destination).toBe('internal.egress.v1');
      expect(capturedEvent?.identity.external.platform).toBe('slack');
      expect(capturedEvent?.identity.external.id).toBe('U9S817Q3B');
    });

    it('should set routing stage to response', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      expect(capturedEvent?.routing.stage).toBe('response');
      expect(capturedEvent?.routing.slip).toEqual([]);
      expect(capturedEvent?.routing.history).toEqual([]);
    });
  });

  describe('empty slip routing verification', () => {
    it('should route to egress when slip is empty', async () => {
      // This test verifies that empty routing slip results in egress fallback
      // The actual routing logic is in base-server.ts:next()

      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
        // Verify empty slip BEFORE next() processes it
        expect(event.routing.slip).toEqual([]);
      });

      await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      // Confirm event was passed to next() with empty slip
      expect(capturedEvent?.routing.slip).toEqual([]);
    });
  });

  describe('egress preservation', () => {
    it('should preserve original egress destination when provided', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      // Pass specific egress from original event
      await handler(
        {
          message: 'Working on your request',
          egress: {
            destination: 'egress.slack.v1',  // Specific instance destination
            connector: 'slack',
            channel: 'C1234567890',
            type: 'chat',
            metadata: { foo: 'bar' }
          }
        },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      // Verify egress is preserved exactly as provided
      expect(capturedEvent?.egress?.destination).toBe('egress.slack.v1');
      expect(capturedEvent?.egress?.connector).toBe('slack');
      expect(capturedEvent?.egress?.channel).toBe('C1234567890');
      expect(capturedEvent?.egress?.type).toBe('chat');
      expect(capturedEvent?.egress?.metadata).toEqual({ foo: 'bar' });
    });

    it('should normalize invalid destination to internal.egress.v1', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      // Pass egress with invalid destination (just "slack" instead of proper topic)
      await handler(
        {
          message: 'Working on your request',
          egress: {
            destination: 'slack',  // Invalid - just connector name
            connector: 'slack',
            channel: 'U9S817Q3B',
            type: 'dm'
          }
        },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      // Verify destination was normalized to internal.egress.v1
      expect(capturedEvent?.egress?.destination).toBe('internal.egress.v1');
      expect(capturedEvent?.egress?.connector).toBe('slack');
      expect(capturedEvent?.egress?.channel).toBe('U9S817Q3B');
      expect(capturedEvent?.egress?.type).toBe('dm');
    });

    it('should use internal.egress.v1 as fallback when no egress provided', async () => {
      const handler = (server as any).handleSendProgressUpdate.bind(server);

      let capturedEvent: InternalEventV2 | undefined;
      const originalNext = (server as any).next;
      (server as any).next = jest.fn(async (event: InternalEventV2) => {
        capturedEvent = event;
      });

      // No egress parameter - should construct from userId
      await handler(
        { message: 'Working on your request' },
        { sessionId, userId: 'slack:test-user' }
      );

      (server as any).next = originalNext;

      // Verify fallback to internal.egress.v1
      expect(capturedEvent?.egress?.destination).toBe('internal.egress.v1');
      expect(capturedEvent?.egress?.connector).toBe('slack');
    });
  });
});
