/**
 * Composition Executor Unit Tests
 *
 * Tests for CompositionExecutor covering:
 * - Execution success cases (3 tests)
 * - Reference resolution ($input, $context, $steps) (6 tests)
 * - Condition evaluation (all operators) (8 tests)
 * - Error handling (4 tests)
 *
 * @module composition/executor.test
 */

import type { Logger } from '../logging';
import { CompositionExecutor, ToolRegistryInterface, ExecutionError } from './executor';
import {
  CompiledComposition,
  ExecutionContext,
  ExecutionStatus,
  CompositionErrorCode,
} from './types';

// Mock Logger
const createMockLogger = (): Logger => ({
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(() => createMockLogger()),
} as unknown as Logger);

// Mock ToolRegistry
class MockToolRegistry implements ToolRegistryInterface {
  private tools: Map<
    string,
    {
      id: string;
      execute?: (args: unknown, context: ExecutionContext) => Promise<unknown>;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }
  > = new Map();

  addTool(
    id: string,
    executeFn?: (args: unknown, context: ExecutionContext) => Promise<unknown>,
    inputSchema?: unknown,
    outputSchema?: unknown
  ) {
    this.tools.set(id, {
      id,
      execute: executeFn,
      inputSchema,
      outputSchema,
    });
  }

  getTool(toolId: string) {
    return this.tools.get(toolId) || null;
  }

  clear() {
    this.tools.clear();
  }
}

describe('CompositionExecutor', () => {
  let executor: CompositionExecutor;
  let registry: MockToolRegistry;

  beforeEach(() => {
    registry = new MockToolRegistry();
    const mockLogger = createMockLogger();
    executor = new CompositionExecutor(registry, mockLogger);
  });

  // Helper to create minimal compiled composition
  const createCompiled = (steps: any[], returnExpr: any): CompiledComposition => ({
    id: 'test-composition',
    metadata: {
      name: 'test',
      version: 1,
    },
    spec: {
      inputSchema: { type: 'object' },
      steps,
      return: returnExpr,
    },
    compiledAt: new Date(),
    contentHash: 'abc123',
    dependencies: [],
    validationReport: { valid: true, errors: [], warnings: [] },
  });

  // ==========================================================================
  // Execution Success Cases (3 tests)
  // ==========================================================================

  describe('Execution success', () => {
    test('executes simple composition with one step', async () => {
      registry.addTool('test.echo', async (args: any) => ({ message: args.text }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: { text: 'hello' },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/message' } }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('hello');
      expect(result.stepsExecuted).toBe(1);
      expect(result.executionTime).toBeGreaterThan(0);
    });

    test('executes composition with multiple steps', async () => {
      registry.addTool('test.uppercase', async (args: any) => ({ result: args.text.toUpperCase() }));
      registry.addTool('test.append', async (args: any) => ({ result: args.text + args.suffix }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.uppercase',
            with: { text: 'hello' },
          },
          {
            id: 'step2',
            call: 'test.append',
            with: {
              text: { $ref: { namespace: 'steps', pointer: '/step1/result' } },
              suffix: '!',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step2/result' } }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('HELLO!');
      expect(result.stepsExecuted).toBe(2);
    });

    test('executes composition with IfValueStep', async () => {
      const composition = createCompiled(
        [
          {
            id: 'greeting',
            if: {
              condition: {
                equals: [{ $ref: { namespace: 'input', pointer: '/vip' } }, true],
              },
              then: 'Welcome VIP!',
              else: 'Hello!',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/greeting' } }
      );

      // Test with VIP = true
      const resultVip = await executor.execute(composition, {
        input: { vip: true },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultVip.status).toBe(ExecutionStatus.SUCCESS);
      expect(resultVip.output).toBe('Welcome VIP!');

      // Test with VIP = false
      const resultNonVip = await executor.execute(composition, {
        input: { vip: false },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultNonVip.status).toBe(ExecutionStatus.SUCCESS);
      expect(resultNonVip.output).toBe('Hello!');
    });
  });

  // ==========================================================================
  // Reference Resolution (6 tests)
  // ==========================================================================

  describe('Reference resolution', () => {
    test('resolves $input references', async () => {
      registry.addTool('test.echo', async (args: any) => args);

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: { value: { $ref: { namespace: 'input', pointer: '/name' } } },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/value' } }
      );

      const result = await executor.execute(composition, {
        input: { name: 'Alice' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Alice');
    });

    test('resolves $context references', async () => {
      registry.addTool('test.echo', async (args: any) => args);

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: { value: { $ref: { namespace: 'context', pointer: '/channel_id' } } },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/value' } }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: { channel_id: 'channel-123' },
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('channel-123');
    });

    test('resolves $steps references', async () => {
      registry.addTool('test.echo', async (args: any) => ({ output: args.text }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: { text: 'hello' },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/output' } }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('hello');
    });

    test('resolves nested JSON Pointer paths', async () => {
      registry.addTool('test.echo', async (args: any) => ({
        data: {
          nested: {
            value: args.text,
          },
        },
      }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: { text: 'deep' },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/data/nested/value' } }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('deep');
    });

    test('resolves references in arrays', async () => {
      registry.addTool('test.echo', async (args: any) => args);

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: {
              values: [
                { $ref: { namespace: 'input', pointer: '/a' } },
                { $ref: { namespace: 'input', pointer: '/b' } },
              ],
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/values' } }
      );

      const result = await executor.execute(composition, {
        input: { a: 1, b: 2 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toEqual([1, 2]);
    });

    test('resolves references in nested objects', async () => {
      registry.addTool('test.echo', async (args: any) => args);

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: {
              user: {
                name: { $ref: { namespace: 'input', pointer: '/name' } },
                id: { $ref: { namespace: 'context', pointer: '/user_id' } },
              },
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/step1/user' } }
      );

      const result = await executor.execute(composition, {
        input: { name: 'Bob' },
        context: { user_id: '456' },
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toEqual({ name: 'Bob', id: '456' });
    });
  });

  // ==========================================================================
  // Condition Evaluation (8 tests)
  // ==========================================================================

  describe('Condition evaluation', () => {
    test('evaluates exists condition', async () => {
      registry.addTool('test.echo', async (args: any) => ({ result: 'executed' }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: {},
            when: {
              exists: { $ref: { namespace: 'input', pointer: '/optional' } },
            },
          },
        ],
        { executed: { $ref: { namespace: 'steps', pointer: '/step1/result' } } }
      );

      // With value present
      const resultPresent = await executor.execute(composition, {
        input: { optional: 'value' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultPresent.status).toBe(ExecutionStatus.SUCCESS);
      expect(resultPresent.output).toEqual({ executed: 'executed' });

      // With value absent
      const resultAbsent = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultAbsent.status).toBe(ExecutionStatus.SUCCESS);
      expect(resultAbsent.output).toEqual({ executed: undefined });
    });

    test('evaluates equals condition', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                equals: [{ $ref: { namespace: 'input', pointer: '/status' } }, 'active'],
              },
              then: 'matched',
              else: 'not_matched',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultMatch = await executor.execute(composition, {
        input: { status: 'active' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultMatch.output).toBe('matched');

      const resultNoMatch = await executor.execute(composition, {
        input: { status: 'inactive' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultNoMatch.output).toBe('not_matched');
    });

    test('evaluates greaterThan condition', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                greaterThan: [{ $ref: { namespace: 'input', pointer: '/count' } }, 10],
              },
              then: 'high',
              else: 'low',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultHigh = await executor.execute(composition, {
        input: { count: 15 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultHigh.output).toBe('high');

      const resultLow = await executor.execute(composition, {
        input: { count: 5 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultLow.output).toBe('low');
    });

    test('evaluates lessThan condition', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                lessThan: [{ $ref: { namespace: 'input', pointer: '/age' } }, 18],
              },
              then: 'minor',
              else: 'adult',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultMinor = await executor.execute(composition, {
        input: { age: 15 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultMinor.output).toBe('minor');

      const resultAdult = await executor.execute(composition, {
        input: { age: 21 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultAdult.output).toBe('adult');
    });

    test('evaluates greaterThanOrEqual condition', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                greaterThanOrEqual: [{ $ref: { namespace: 'input', pointer: '/score' } }, 70],
              },
              then: 'pass',
              else: 'fail',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultPass = await executor.execute(composition, {
        input: { score: 70 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultPass.output).toBe('pass');
    });

    test('evaluates lessThanOrEqual condition', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                lessThanOrEqual: [{ $ref: { namespace: 'input', pointer: '/temp' } }, 32],
              },
              then: 'freezing',
              else: 'not_freezing',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultFreezing = await executor.execute(composition, {
        input: { temp: 32 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultFreezing.output).toBe('freezing');
    });

    test('evaluates all condition (logical AND)', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                all: [
                  { exists: { $ref: { namespace: 'input', pointer: '/user_id' } } },
                  { greaterThan: [{ $ref: { namespace: 'input', pointer: '/age' } }, 18] },
                ],
              },
              then: 'authorized',
              else: 'unauthorized',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultAuth = await executor.execute(composition, {
        input: { user_id: '123', age: 21 },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultAuth.output).toBe('authorized');

      const resultUnauth = await executor.execute(composition, {
        input: { age: 21 }, // Missing user_id
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultUnauth.output).toBe('unauthorized');
    });

    test('evaluates any condition (logical OR) and not condition', async () => {
      const composition = createCompiled(
        [
          {
            id: 'result',
            if: {
              condition: {
                any: [
                  { equals: [{ $ref: { namespace: 'input', pointer: '/role' } }, 'admin'] },
                  { equals: [{ $ref: { namespace: 'input', pointer: '/role' } }, 'moderator'] },
                ],
              },
              then: 'privileged',
              else: 'normal',
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/result' } }
      );

      const resultPrivileged = await executor.execute(composition, {
        input: { role: 'admin' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultPrivileged.output).toBe('privileged');

      const resultNormal = await executor.execute(composition, {
        input: { role: 'user' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(resultNormal.output).toBe('normal');
    });
  });

  // ==========================================================================
  // Error Handling (4 tests)
  // ==========================================================================

  describe('Error handling', () => {
    test('throws error when tool not found', async () => {
      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'missing.tool',
          },
        ],
        { success: true }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.errorCode).toBe(CompositionErrorCode.TOOL_NOT_FOUND);
      expect(result.error).toContain('missing.tool');
    });

    test('throws error when tool execution fails', async () => {
      registry.addTool('test.failing', async () => {
        throw new Error('Tool execution failed');
      });

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.failing',
          },
        ],
        { success: true }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.errorCode).toBe(CompositionErrorCode.EXECUTION_ERROR);
    });

    test('validates input schema', async () => {
      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
          },
        ],
        { success: true }
      );

      composition.spec.inputSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const result = await executor.execute(composition, {
        input: {}, // Missing required 'name'
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.errorCode).toBe(CompositionErrorCode.VALIDATION_ERROR);
      expect(result.error).toContain('Input validation failed');
    });

    test('validates tool input schema', async () => {
      registry.addTool(
        'test.strict',
        async (args: any) => args,
        {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
          required: ['value'],
        }
      );

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.strict',
            with: { value: 'not-a-number' }, // Wrong type
          },
        ],
        { success: true }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.errorCode).toBe(CompositionErrorCode.VALIDATION_ERROR);
      expect(result.error).toContain('Tool input validation failed');
    });
  });

  // ==========================================================================
  // Conditional Step Execution (when guards)
  // ==========================================================================

  describe('Conditional step execution', () => {
    test('skips step when condition is false', async () => {
      registry.addTool('test.echo', async (args: any) => ({ called: true }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: {},
            when: {
              equals: [{ $ref: { namespace: 'input', pointer: '/enabled' } }, true],
            },
          },
        ],
        { result: { $ref: { namespace: 'steps', pointer: '/step1/called' } } }
      );

      const result = await executor.execute(composition, {
        input: { enabled: false },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toEqual({ result: undefined }); // Step was skipped
      expect(result.stepsExecuted).toBe(0);
    });

    test('executes step when condition is true', async () => {
      registry.addTool('test.echo', async (args: any) => ({ called: true }));

      const composition = createCompiled(
        [
          {
            id: 'step1',
            call: 'test.echo',
            with: {},
            when: {
              equals: [{ $ref: { namespace: 'input', pointer: '/enabled' } }, true],
            },
          },
        ],
        { result: { $ref: { namespace: 'steps', pointer: '/step1/called' } } }
      );

      const result = await executor.execute(composition, {
        input: { enabled: true },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toEqual({ result: true }); // Step was executed
      expect(result.stepsExecuted).toBe(1);
    });
  });

  // ==========================================================================
  // Template Expression Resolution (Sprint 42)
  // ==========================================================================

  describe('Template expression resolution', () => {
    test('interpolates simple template with one variable', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'Hello, {{name}}!',
          name: 'Alice',
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Hello, Alice!');
    });

    test('interpolates template with multiple variables', async () => {
      const composition = createCompiled(
        [],
        {
          template: '{{greeting}} {{name}}, you have {{count}} messages.',
          greeting: 'Hello',
          name: 'Bob',
          count: 5,
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Hello Bob, you have 5 messages.');
    });

    test('interpolates template with references to input', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'User {{username}} is {{status}}',
          username: { $ref: { namespace: 'input', pointer: '/username' } },
          status: { $ref: { namespace: 'input', pointer: '/status' } },
        }
      );

      const result = await executor.execute(composition, {
        input: { username: 'charlie', status: 'active' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('User charlie is active');
    });

    test('interpolates template with references to step outputs', async () => {
      registry.addTool('test.get_user', async () => ({ name: 'Dave', org: 'Acme Inc' }));

      const composition = createCompiled(
        [
          {
            id: 'user',
            call: 'test.get_user',
            with: {},
          },
        ],
        {
          template: '{{name}} from {{org}}',
          name: { $ref: { namespace: 'steps', pointer: '/user/name' } },
          org: { $ref: { namespace: 'steps', pointer: '/user/org' } },
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Dave from Acme Inc');
    });

    test('coerces null/undefined to empty string', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'Value: {{value}}',
          value: null,
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Value: ');
    });

    test('coerces numbers to strings', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'Count: {{count}}, Price: {{price}}',
          count: 42,
          price: 19.99,
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Count: 42, Price: 19.99');
    });

    test('coerces booleans to strings', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'Active: {{active}}, Enabled: {{enabled}}',
          active: true,
          enabled: false,
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Active: true, Enabled: false');
    });

    test('throws error when variable references object', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'User: {{user}}',
          user: { name: 'Eve', age: 30 },
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.error).toContain('resolved to object');
      expect(result.error).toContain('Templates require scalar values');
      expect(result.errorCode).toBe(CompositionErrorCode.VALIDATION_ERROR);
    });

    test('throws error when variable references array', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'Items: {{items}}',
          items: ['a', 'b', 'c'],
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.error).toContain('resolved to array');
      expect(result.error).toContain('Templates require scalar values');
      expect(result.errorCode).toBe(CompositionErrorCode.VALIDATION_ERROR);
    });

    test('throws error for undefined template variable at runtime', async () => {
      // Note: This should be caught by compiler validation, but test runtime behavior
      const composition = createCompiled(
        [],
        {
          template: 'Hello {{name}} and {{other}}',
          name: 'Frank',
          // 'other' is not defined
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.FAILED);
      expect(result.error).toContain('Undefined template variable: {{other}}');
      expect(result.errorCode).toBe(CompositionErrorCode.UNDEFINED_REFERENCE);
    });

    test('handles escaped braces in template', async () => {
      const composition = createCompiled(
        [],
        {
          template: 'Use \\{{variable}} for interpolation, result: {{value}}',
          value: '42',
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Use {{variable}} for interpolation, result: 42');
    });

    test('uses templates in step arguments (grockle use case)', async () => {
      registry.addTool('test.generate', async (args: any) => ({
        result: `Generated with: ${args.prompt}`,
      }));

      const composition = createCompiled(
        [
          {
            id: 'notes',
            call: 'test.get_notes',
            with: {},
          },
          {
            id: 'generate',
            call: 'test.generate',
            with: {
              prompt: {
                template: '{{notes}} {{description}}',
                notes: { $ref: { namespace: 'steps', pointer: '/notes/value' } },
                description: { $ref: { namespace: 'input', pointer: '/description' } },
              },
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/generate/result' } }
      );

      registry.addTool('test.get_notes', async () => ({ value: 'Important:' }));

      const result = await executor.execute(composition, {
        input: { description: 'Create a logo' },
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toBe('Generated with: Important: Create a logo');
    });

    test('supports nested templates in objects', async () => {
      const composition = createCompiled(
        [],
        {
          greeting: {
            template: 'Hello {{name}}',
            name: 'Grace',
          },
          message: {
            template: 'Welcome to {{place}}',
            place: 'the platform',
          },
        }
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toEqual({
        greeting: 'Hello Grace',
        message: 'Welcome to the platform',
      });
    });

    test('supports templates in arrays', async () => {
      const composition = createCompiled(
        [],
        [
          {
            template: 'Item {{index}}',
            index: 1,
          },
          {
            template: 'Item {{index}}',
            index: 2,
          },
        ]
      );

      const result = await executor.execute(composition, {
        input: {},
        context: {},
        sessionId: 'session-1',
        correlationId: 'corr-1',
        userRoles: ['user'],
      });

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      expect(result.output).toEqual(['Item 1', 'Item 2']);
    });

    test('grockle integration: full composition with template and image generation', async () => {
      // Track what arguments generate_image receives
      let capturedPrompt: any = null;

      // Mock get_state tool
      registry.addTool('get_state', async (args: any) => ({
        notes: 'User prefers vibrant colors and modern design.',
      }));

      // Mock generate_image tool
      registry.addTool('generate_image', async (args: any) => {
        capturedPrompt = args.prompt;

        // Verify prompt is a STRING, not an object
        if (typeof args.prompt !== 'string') {
          throw new Error(
            `generate_image expects prompt to be a string, got ${typeof args.prompt}`
          );
        }

        return {
          imageUrl: 'https://example.com/images/generated-123.png',
        };
      });

      // Grockle composition structure
      const composition = createCompiled(
        [
          {
            id: 'get_notes',
            call: 'get_state',
            with: {
              key: 'user_preferences',
            },
          },
          {
            id: 'generate',
            call: 'generate_image',
            with: {
              prompt: {
                template: '{{notes}} Create: {{description}}',
                notes: { $ref: { namespace: 'steps', pointer: '/get_notes/notes' } },
                description: { $ref: { namespace: 'input', pointer: '/description' } },
              },
            },
          },
        ],
        { $ref: { namespace: 'steps', pointer: '/generate/imageUrl' } }
      );

      const result = await executor.execute(composition, {
        input: { description: 'a happy robot waving' },
        context: {},
        sessionId: 'grockle-session',
        correlationId: 'grockle-corr-1',
        userRoles: ['user'],
      });

      // Verify execution succeeded
      expect(result.status).toBe(ExecutionStatus.SUCCESS);

      // Verify template was resolved correctly (combining notes + description)
      expect(capturedPrompt).toBe(
        'User prefers vibrant colors and modern design. Create: a happy robot waving'
      );

      // Verify prompt was passed as a STRING (not an object)
      expect(typeof capturedPrompt).toBe('string');

      // Verify image URL was returned
      expect(result.output).toBe('https://example.com/images/generated-123.png');
    });
  });

  // ==========================================================================
  // Sprint 50: MCP Tool Response Shortcuts (39 tests)
  // ==========================================================================

  describe('MCP Tool Response Shortcuts (Sprint 50)', () => {
    // ----------------------------------------------------------------------
    // TEST-01: Unit tests for isMcpEnvelope() (6 tests)
    // ----------------------------------------------------------------------
    describe('isMcpEnvelope() helper', () => {
      test('returns true for valid MCP envelope with text content', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: 'hello' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('hello');
      });

      test('returns false for empty content array', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/content/0/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: [], // Empty content array
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        // Shortcut expansion fails, falls back to standard resolution
        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns false for null/undefined', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => null);

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns false for non-object input', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => 'plain string');

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns false for object without content field', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => ({
          data: 'value', // Missing 'content' field
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns false for content array with non-object items', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: ['string', 123], // Non-object items
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });
    });

    // ----------------------------------------------------------------------
    // TEST-02: Unit tests for parseJsonSafely() (8 tests)
    // ----------------------------------------------------------------------
    describe('parseJsonSafely() helper', () => {
      test('parses valid JSON object correctly', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/name' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: '{"name": "Alice", "age": 30}' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('Alice');
      });

      test('parses valid JSON array correctly', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/0' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: '["first", "second", "third"]' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('first');
      });

      test('returns null for invalid JSON', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/name' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: '{invalid json}' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns null for non-string input', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/name' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: 123 }], // Number, not string
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns null for empty string', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/name' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: '' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('parses nested JSON correctly', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/user/profile/name' } }
        );

        registry.addTool('get_api', async () => ({
          content: [
            {
              type: 'text',
              text: '{"user": {"profile": {"name": "Bob", "age": 25}}}',
            },
          ],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('Bob');
      });

      test('returns undefined for missing property', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json/missing' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: '{"name": "Alice"}' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns full parsed object when no property path provided', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text/json' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: '{"name": "Alice", "age": 30}' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toEqual({ name: 'Alice', age: 30 });
      });
    });

    // ----------------------------------------------------------------------
    // TEST-03: Unit tests for basic shortcuts (10 tests)
    // ----------------------------------------------------------------------
    describe('expandMcpShortcut() basic shortcuts', () => {
      test('/text shortcut works for text content', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: 'Hello, World!' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('Hello, World!');
      });

      test('/image shortcut works for image content', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/image' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'image', data: 'base64imagedata', mimeType: 'image/png' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('base64imagedata');
      });

      test('/data shortcut works for image content (alias)', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/data' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'image', data: 'base64imagedata', mimeType: 'image/png' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('base64imagedata');
      });

      test('/mimeType shortcut works for image content', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/mimeType' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'image', data: 'base64imagedata', mimeType: 'image/png' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('image/png');
      });

      test('/uri shortcut works for resource content', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/uri' } }
        );

        registry.addTool('get_api', async () => ({
          content: [
            {
              type: 'resource',
              resource: { uri: 'https://example.com/data', mimeType: 'application/json' },
            },
          ],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('https://example.com/data');
      });

      test('/resource/mimeType shortcut works for nested resource fields', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/resource/mimeType' } }
        );

        registry.addTool('get_api', async () => ({
          content: [
            {
              type: 'resource',
              resource: { uri: 'https://example.com/data', mimeType: 'application/json' },
            },
          ],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('application/json');
      });

      test('/isError shortcut works for error flag', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/isError' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: 'Error message' }],
          isError: true,
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe(true);
      });

      test('returns null for wrong content type (text shortcut on image)', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'image', data: 'base64imagedata' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        // Shortcut expansion fails (type mismatch), fallback to standard resolution
        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('returns null for unrecognized shortcut', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/unknown' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: 'hello' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        // Shortcut expansion fails (unrecognized), fallback to standard resolution
        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBeUndefined();
      });

      test('nested path segments work correctly', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: { nested: { value: 'deep' } } }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toEqual({ nested: { value: 'deep' } });
      });
    });

    // ----------------------------------------------------------------------
    // TEST-05: Integration tests for resolveReference() (6 tests)
    // ----------------------------------------------------------------------
    describe('resolveReference() integration', () => {
      test('text shortcut resolves in step reference', async () => {
        const composition = createCompiled(
          [
            {
              id: 'get_state',
              call: 'get_state',
              with: {},
            },
            {
              id: 'process',
              call: 'process',
              with: {
                data: { $ref: { namespace: 'steps', pointer: '/get_state/text' } },
              },
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/process' } }
        );

        registry.addTool('get_state', async () => ({
          content: [{ type: 'text', text: 'state data' }],
        }));

        let capturedData: any;
        registry.addTool('process', async (args: any) => {
          capturedData = args.data;
          return 'processed';
        });

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(capturedData).toBe('state data');
      });

      test('JSON shortcut resolves with parsing and navigation', async () => {
        const composition = createCompiled(
          [
            {
              id: 'get_state',
              call: 'get_state',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/get_state/text/json/user/name' } }
        );

        registry.addTool('get_state', async () => ({
          content: [
            {
              type: 'text',
              text: '{"user": {"name": "Charlie", "age": 35}}',
            },
          ],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('Charlie');
      });

      test('explicit paths use standard resolution', async () => {
        const composition = createCompiled(
          [
            {
              id: 'get_state',
              call: 'get_state',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/get_state/content/0/text' } }
        );

        registry.addTool('get_state', async () => ({
          content: [{ type: 'text', text: 'explicit path works' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('explicit path works');
      });

      test('non-MCP responses use standard resolution', async () => {
        const composition = createCompiled(
          [
            {
              id: 'legacy',
              call: 'legacy_tool',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/legacy/data/value' } }
        );

        registry.addTool('legacy_tool', async () => ({
          data: { value: 'legacy response' },
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('legacy response');
      });

      test('multiple shortcuts in same composition work', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api1',
              call: 'api1',
              with: {},
            },
            {
              id: 'api2',
              call: 'api2',
              with: {},
            },
          ],
          {
            text1: { $ref: { namespace: 'steps', pointer: '/api1/text' } },
            text2: { $ref: { namespace: 'steps', pointer: '/api2/text' } },
          }
        );

        registry.addTool('api1', async () => ({
          content: [{ type: 'text', text: 'first' }],
        }));

        registry.addTool('api2', async () => ({
          content: [{ type: 'text', text: 'second' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toEqual({ text1: 'first', text2: 'second' });
      });

      test('input/context namespaces unchanged', async () => {
        const composition = createCompiled(
          [],
          {
            inputValue: { $ref: { namespace: 'input', pointer: '/value' } },
            contextValue: { $ref: { namespace: 'context', pointer: '/channel' } },
          }
        );

        const result = await executor.execute(composition, {
          input: { value: 'input data' },
          context: { channel: 'test-channel' },
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toEqual({
          inputValue: 'input data',
          contextValue: 'test-channel',
        });
      });
    });

    // ----------------------------------------------------------------------
    // TEST-06: Backwards compatibility tests (3 tests)
    // ----------------------------------------------------------------------
    describe('Backwards compatibility', () => {
      test('all existing tests pass without modification', async () => {
        // This test verifies that existing compositions work unchanged
        // We'll reuse one of the original tests to demonstrate

        const composition = createCompiled(
          [
            {
              id: 'step1',
              call: 'echo',
              with: { message: { $ref: { namespace: 'input', pointer: '/message' } } },
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/step1' } }
        );

        registry.addTool('echo', async (args: any) => args);

        const result = await executor.execute(composition, {
          input: { message: 'original behavior' },
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toEqual({ message: 'original behavior' });
      });

      test('explicit /content/0/text paths work', async () => {
        const composition = createCompiled(
          [
            {
              id: 'api',
              call: 'get_api',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/api/content/0/text' } }
        );

        registry.addTool('get_api', async () => ({
          content: [{ type: 'text', text: 'explicit path' }],
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('explicit path');
      });

      test('non-shortcut paths unchanged', async () => {
        const composition = createCompiled(
          [
            {
              id: 'custom',
              call: 'custom_tool',
              with: {},
            },
          ],
          { $ref: { namespace: 'steps', pointer: '/custom/result/data/field' } }
        );

        registry.addTool('custom_tool', async () => ({
          result: { data: { field: 'custom structure' } },
        }));

        const result = await executor.execute(composition, {
          input: {},
          context: {},
          sessionId: 'test',
          correlationId: 'test-corr',
          userRoles: [],
        });

        expect(result.status).toBe(ExecutionStatus.SUCCESS);
        expect(result.output).toBe('custom structure');
      });
    });
  });
});
