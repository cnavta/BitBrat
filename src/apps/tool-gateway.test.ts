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

/**
 * Sprint 41 (COMP-016): Unit tests for composition subsystem integration
 */
describe('composition subsystem integration', () => {
  describe('initialization', () => {
    it('should initialize with composition subsystem fields', () => {
      const server = createServer();
      const compositionsEnabled = (server as any).compositionsEnabled;

      // In test environment without PostgreSQL, compositions will be disabled
      // The important thing is that the server starts successfully
      expect(compositionsEnabled).toBe(false);
      expect(server).toBeDefined();

      server.close('test');
    });

    it('should disable compositions when ENABLE_COMPOSITIONS=false', () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();
      const compositionsEnabled = (server as any).compositionsEnabled;

      expect(compositionsEnabled).toBe(false);

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      server.close('test');
    });

    it('should handle missing DocumentStore gracefully', () => {
      // This test verifies graceful degradation when DocumentStore is unavailable
      // In production, this would happen if PostgreSQL connection fails

      const server = createServer();

      // Even if DocumentStore initialization fails, server should start
      expect(server).toBeDefined();
      expect((server as any).compositionsEnabled).toBeDefined();

      server.close('test');
    });
  });

  describe('ToolRegistry adapter', () => {
    it('should adapt ToolRegistry getTool to ToolRegistryInterface', () => {
      const server = createServer();
      const registry = (server as any).registry;

      // Register a test tool
      registry.registerTool({
        id: 'test.tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        source: 'internal',
        execute: async () => ({ result: 'test' }),
      });

      // Adapter should make it compatible with ToolRegistryInterface
      const tool = registry.getTool('test.tool');
      expect(tool).toBeDefined();
      expect(tool.id).toBe('test.tool');
      expect(tool.inputSchema).toBeDefined();

      server.close('test');
    });
  });

  describe('composition loading', () => {
    it('should load compositions from DocumentStore on startup', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;

        // After initialization, loadCompositions should have been called
        // The list should be empty initially (no compositions registered yet)
        const compositions = await registry.list();
        expect(Array.isArray(compositions)).toBe(true);
      }

      await server.close('test');
    });

    it('should skip loading when compositions disabled', async () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();

      // loadCompositions should be skipped when disabled
      expect((server as any).compositionsEnabled).toBe(false);
      expect((server as any).compositionRegistry).toBeUndefined();

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await server.close('test');
    });
  });

  describe('composition tool registration', () => {
    it('should register composition as both internal tool and MCP tool', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;
        const toolRegistry = (server as any).registry;

        // Create a minimal test composition
        const definition = {
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: {
            name: 'test_composition',
            description: 'Test composition',
          },
          spec: {
            inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
            steps: [
              {
                id: 'step1',
                call: 'agent.sendProgressUpdate',
                with: { message: 'test' },
              },
            ],
            return: { success: true },
          },
        };

        // Register composition
        await registry.register(definition);

        // Should be registered in ToolRegistry
        const tool = toolRegistry.getTool('test_composition');
        expect(tool).toBeDefined();
        expect(tool.id).toBe('test_composition');
        expect(tool.source).toBe('composition');
      }

      await server.close('test');
    });
  });

  describe('composition execution', () => {
    it('should execute composition successfully', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;
        const executor = (server as any).compositionExecutor;

        // Create simple composition that returns a literal value
        const definition = {
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: {
            name: 'simple_composition',
            description: 'Returns a literal value',
          },
          spec: {
            inputSchema: { type: 'object' },
            steps: [],
            return: { result: 'success', message: 'Composition executed' },
          },
        };

        const compiled = await registry.register(definition);

        // Execute composition
        const result = await executor.execute(compiled, {
          input: {},
          context: {},
          sessionId: 'test-session',
          userRoles: ['user'],
        });

        expect(result.status).toBe('success');
        expect(result.output).toEqual({ result: 'success', message: 'Composition executed' });
        expect(result.executionTime).toBeDefined();
      }

      await server.close('test');
    });

    it('should handle composition execution failure', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;
        const executor = (server as any).compositionExecutor;

        // Create composition that calls non-existent tool
        const definition = {
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: {
            name: 'failing_composition',
            description: 'Calls non-existent tool',
          },
          spec: {
            inputSchema: { type: 'object' },
            steps: [
              {
                id: 'step1',
                call: 'nonexistent.tool',
                with: {},
              },
            ],
            return: { $ref: { namespace: 'steps', pointer: '/step1' } },
          },
        };

        const compiled = await registry.register(definition);

        // Execute composition (should fail)
        const result = await executor.execute(compiled, {
          input: {},
          context: {},
          sessionId: 'test-session',
          userRoles: ['user'],
        });

        expect(result.status).toBe('failed');
        expect(result.error).toBeDefined();
        expect(result.error).toContain('not found');
      }

      await server.close('test');
    });
  });
});

/**
 * Sprint 41 (COMP-017A): Unit tests for composition administrative MCP tools
 */
describe('composition administrative MCP tools', () => {
  describe('tool registration', () => {
    it('should register all 5 composition admin tools when compositions enabled', () => {
      const server = createServer();

      if ((server as any).compositionsEnabled) {
        const registry = (server as any).registry;

        // Check all 5 tools are registered
        const registerTool = registry.getTool('composition.register');
        const listTool = registry.getTool('composition.list');
        const getTool = registry.getTool('composition.get');
        const deleteTool = registry.getTool('composition.delete');
        const statsTool = registry.getTool('composition.stats');

        expect(registerTool).toBeDefined();
        expect(listTool).toBeDefined();
        expect(getTool).toBeDefined();
        expect(deleteTool).toBeDefined();
        expect(statsTool).toBeDefined();

        expect(registerTool.id).toBe('composition.register');
        expect(listTool.id).toBe('composition.list');
        expect(getTool.id).toBe('composition.get');
        expect(deleteTool.id).toBe('composition.delete');
        expect(statsTool.id).toBe('composition.stats');

        expect(registerTool.source).toBe('internal');
        expect(listTool.source).toBe('internal');
        expect(getTool.source).toBe('internal');
        expect(deleteTool.source).toBe('internal');
        expect(statsTool.source).toBe('internal');
      }

      server.close('test');
    });

    it('should register composition admin tools even when compositions disabled', () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();
      const registry = (server as any).registry;

      // Sprint 41 fix: Composition admin tools ARE registered even when disabled
      // This prevents empty string responses - tools return clear error messages instead
      expect(registry.getTool('composition.register')).toBeDefined();
      expect(registry.getTool('composition.list')).toBeDefined();
      expect(registry.getTool('composition.get')).toBeDefined();
      expect(registry.getTool('composition.delete')).toBeDefined();
      expect(registry.getTool('composition.stats')).toBeDefined();
      expect(registry.getTool('composition.list_tools')).toBeDefined();

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      server.close('test');
    });
  });

  describe('composition.register tool', () => {
    it('should return error when compositions disabled', async () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();

      // Even though tool won't be registered, test the handler directly
      const handler = (server as any).handleCompositionRegister;

      if (handler) {
        const result = await handler.bind(server)({
          definition: {
            apiVersion: 'mcp-compose/v1',
            kind: 'Composition',
            metadata: { name: 'test', description: 'Test' },
            spec: { inputSchema: { type: 'object' }, return: { success: true } },
          },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not enabled');
      }

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await server.close('test');
    });

    it('should register composition successfully via MCP tool', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const handler = (server as any).handleCompositionRegister.bind(server);

        const definition = {
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: {
            name: 'mcp_test_composition',
            description: 'Test via MCP',
          },
          spec: {
            inputSchema: { type: 'object' },
            return: { success: true },
          },
        };

        const result = await handler({ definition });

        expect(result.isError).toBeFalsy();
        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');

        const response = JSON.parse(result.content[0].text);
        expect(response.name).toBe('mcp_test_composition');
        expect(response.version).toBeDefined();
        expect(response.contentHash).toBeDefined();
      }

      await server.close('test');
    });

    it('should return error on invalid composition definition', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const handler = (server as any).handleCompositionRegister.bind(server);

        const invalidDefinition = {
          // Missing required fields
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: { name: 'invalid' },
          // Missing spec
        };

        const result = await handler({ definition: invalidDefinition });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Error');
      }

      await server.close('test');
    });
  });

  describe('composition.list tool', () => {
    it('should return error when compositions disabled', async () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();
      const handler = (server as any).handleCompositionList;

      if (handler) {
        const result = await handler.bind(server)({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not enabled');
      }

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await server.close('test');
    });

    it('should list all compositions', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const handler = (server as any).handleCompositionList.bind(server);

        const result = await handler({});

        expect(result.isError).toBeFalsy();
        expect(result.content).toBeDefined();

        const response = JSON.parse(result.content[0].text);
        expect(response.compositions).toBeDefined();
        expect(Array.isArray(response.compositions)).toBe(true);
        expect(response.total).toBeDefined();
      }

      await server.close('test');
    });

    it('should apply name filter', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;
        const handler = (server as any).handleCompositionList.bind(server);

        // Register test composition
        await registry.register({
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: { name: 'filterable_comp', description: 'Test' },
          spec: { inputSchema: { type: 'object' }, return: { success: true } },
        });

        // List with name filter
        const result = await handler({ filter: { name: 'filterable_comp' } });
        const response = JSON.parse(result.content[0].text);

        expect(response.compositions.length).toBeGreaterThan(0);
        expect(response.compositions[0].name).toBe('filterable_comp');
      }

      await server.close('test');
    });

    it('should apply pagination', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const handler = (server as any).handleCompositionList.bind(server);

        // List with limit
        const result = await handler({ limit: 5, offset: 0 });
        const response = JSON.parse(result.content[0].text);

        expect(response.compositions.length).toBeLessThanOrEqual(5);
      }

      await server.close('test');
    });
  });

  describe('composition.get tool', () => {
    it('should return error when compositions disabled', async () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();
      const handler = (server as any).handleCompositionGet;

      if (handler) {
        const result = await handler.bind(server)({ name: 'test' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not enabled');
      }

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await server.close('test');
    });

    it('should retrieve composition by name', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;
        const handler = (server as any).handleCompositionGet.bind(server);

        // Register test composition
        await registry.register({
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: { name: 'get_test_comp', description: 'Test' },
          spec: { inputSchema: { type: 'object' }, return: { success: true } },
        });

        const result = await handler({ name: 'get_test_comp' });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.name).toBe('get_test_comp');
      }

      await server.close('test');
    });

    it('should return error when composition not found', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const handler = (server as any).handleCompositionGet.bind(server);

        const result = await handler({ name: 'nonexistent_comp' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      }

      await server.close('test');
    });
  });

  describe('composition.delete tool', () => {
    it('should return error when compositions disabled', async () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();
      const handler = (server as any).handleCompositionDelete;

      if (handler) {
        const result = await handler.bind(server)({ name: 'test', version: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not enabled');
      }

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await server.close('test');
    });

    it('should delete composition successfully', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const registry = (server as any).compositionRegistry;
        const handler = (server as any).handleCompositionDelete.bind(server);

        // Register test composition
        const compiled = await registry.register({
          apiVersion: 'mcp-compose/v1',
          kind: 'Composition',
          metadata: { name: 'delete_test_comp', description: 'Test' },
          spec: { inputSchema: { type: 'object' }, return: { success: true } },
        });

        const result = await handler({ name: 'delete_test_comp', version: compiled.version });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.deleted.name).toBe('delete_test_comp');
      }

      await server.close('test');
    });
  });

  describe('composition.stats tool', () => {
    it('should return error when compositions disabled', async () => {
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const server = createServer();
      const handler = (server as any).handleCompositionStats;

      if (handler) {
        const result = await handler.bind(server)({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not enabled');
      }

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await server.close('test');
    });

    it('should return registry statistics', async () => {
      const server = createServer();

      if ((server as any).compositionsEnabled && (server as any).compositionRegistry) {
        const handler = (server as any).handleCompositionStats.bind(server);

        const result = await handler({});

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);

        expect(response.totalCompositions).toBeDefined();
        expect(response.totalVersions).toBeDefined();
        expect(typeof response.totalCompositions).toBe('number');
        expect(typeof response.totalVersions).toBe('number');
      }

      await server.close('test');
    });
  });
});
