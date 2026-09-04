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

import { CompositionExecutor, ToolRegistryInterface, ExecutionError } from './executor';
import {
  CompiledComposition,
  ExecutionContext,
  ExecutionStatus,
  CompositionErrorCode,
} from './types';

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
    executor = new CompositionExecutor(registry);
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
});
