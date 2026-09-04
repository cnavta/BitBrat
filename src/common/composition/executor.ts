/**
 * Composition Executor
 *
 * Executes compiled compositions with runtime reference resolution,
 * condition evaluation, and tool invocation.
 *
 * @module composition/executor
 * @version 1.0.0
 * @see technical-architecture.md §4.4
 */

import Ajv from 'ajv';
import {
  CompiledComposition,
  ExecutionContext,
  ExecutionResult,
  ExecutionStatus,
  Step,
  CallStep,
  IfValueStep,
  ValueExpression,
  Reference,
  Condition,
  isReference,
  isCallStep,
  isIfValueStep,
  CompositionErrorCode,
} from './types';

/**
 * Tool Registry Interface for Execution
 *
 * Minimal interface for tool invocation during execution
 */
export interface ToolRegistryInterface {
  /**
   * Get tool by logical ID
   */
  getTool(toolId: string): {
    id: string;
    execute?: (args: unknown, context: ExecutionContext) => Promise<unknown>;
    inputSchema?: unknown;
    outputSchema?: unknown;
  } | null;
}

/**
 * Execution Error
 *
 * Thrown when composition execution fails
 */
export class ExecutionError extends Error {
  constructor(
    public code: CompositionErrorCode,
    message: string,
    public location?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}

/**
 * Step Execution State
 *
 * Tracks output of executed steps for reference resolution
 */
interface StepState {
  [stepId: string]: unknown;
}

/**
 * Composition Executor
 *
 * Executes compiled compositions with:
 * - Sequential step execution
 * - Runtime reference resolution ($input, $context, $steps)
 * - Condition evaluation (all operators)
 * - Tool invocation via ToolRegistry
 * - Input/output schema validation (AJV)
 *
 * @example
 * ```typescript
 * const executor = new CompositionExecutor(toolRegistry);
 * const result = await executor.execute(compiled, {
 *   input: { user_id: '123' },
 *   context: { channel_id: 'abc' },
 *   sessionId: 'session-1',
 *   userRoles: ['user'],
 * });
 * ```
 */
export class CompositionExecutor {
  private ajv: Ajv;

  constructor(private registry: ToolRegistryInterface) {
    this.ajv = new Ajv({ strict: false });
  }

  /**
   * Execute a compiled composition
   *
   * @param composition - Compiled composition to execute
   * @param context - Execution context (input, context, sessionId, userRoles)
   * @returns Execution result with status and output
   * @throws ExecutionError if execution fails
   */
  async execute(
    composition: CompiledComposition,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // 1. Validate input against inputSchema
      if (composition.spec.inputSchema) {
        this.validateInput(context.input, composition.spec.inputSchema);
      }

      // 2. Execute steps sequentially
      const stepState: StepState = {};

      for (const step of composition.spec.steps) {
        // Check if step should be skipped (conditional execution)
        if (isCallStep(step) && step.when) {
          const shouldExecute = await this.evaluateCondition(
            step.when,
            context.input,
            context.context,
            stepState
          );

          if (!shouldExecute) {
            // Skip this step
            continue;
          }
        }

        // Execute step
        const stepOutput = await this.executeStep(
          step,
          context.input,
          context.context,
          stepState,
          context
        );

        // Store step output for reference resolution
        stepState[step.id] = stepOutput;
      }

      // 3. Resolve return expression
      const output = await this.resolveValue(
        composition.spec.return,
        context.input,
        context.context,
        stepState
      );

      // 4. Validate output against outputSchema
      if (composition.spec.outputSchema) {
        this.validateOutput(output, composition.spec.outputSchema);
      }

      const endTime = Date.now();

      return {
        status: ExecutionStatus.SUCCESS,
        output,
        executionTime: endTime - startTime,
        stepsExecuted: Object.keys(stepState).length,
      };
    } catch (error) {
      const endTime = Date.now();

      if (error instanceof ExecutionError) {
        return {
          status: ExecutionStatus.FAILED,
          error: error.message,
          errorCode: error.code,
          errorLocation: error.location,
          executionTime: endTime - startTime,
        };
      }

      // Unexpected error
      throw error;
    }
  }

  /**
   * Execute a single step
   *
   * @param step - Step to execute (CallStep or IfValueStep)
   * @param input - Composition input
   * @param context - Composition context
   * @param stepState - Current step execution state
   * @param execContext - Full execution context
   * @returns Step output
   */
  private async executeStep(
    step: Step,
    input: unknown,
    context: unknown,
    stepState: StepState,
    execContext: ExecutionContext
  ): Promise<unknown> {
    if (isCallStep(step)) {
      return await this.executeCallStep(step, input, context, stepState, execContext);
    } else if (isIfValueStep(step)) {
      return await this.executeIfValueStep(step, input, context, stepState);
    } else {
      // TypeScript narrows to 'never' here, but we still know step has an id
      const unknownStep = step as { id: string };
      throw new ExecutionError(
        CompositionErrorCode.INVALID_FORMAT,
        `Unknown step type for step: ${unknownStep.id}`,
        `steps[${unknownStep.id}]`
      );
    }
  }

  /**
   * Execute a CallStep (tool invocation)
   */
  private async executeCallStep(
    step: CallStep,
    input: unknown,
    context: unknown,
    stepState: StepState,
    execContext: ExecutionContext
  ): Promise<unknown> {
    // Resolve tool from registry
    const tool = this.registry.getTool(step.call);

    if (!tool) {
      throw new ExecutionError(
        CompositionErrorCode.TOOL_NOT_FOUND,
        `Tool not found: ${step.call}`,
        `steps[${step.id}].call`
      );
    }

    if (!tool.execute) {
      throw new ExecutionError(
        CompositionErrorCode.TOOL_NOT_FOUND,
        `Tool ${step.call} does not support execution`,
        `steps[${step.id}].call`
      );
    }

    // Resolve arguments
    let args: unknown = {};
    if (step.with) {
      args = await this.resolveValue(step.with, input, context, stepState);
    }

    // Validate input against tool's inputSchema
    if (tool.inputSchema) {
      this.validateToolInput(args, tool.inputSchema, step.call);
    }

    // Invoke tool
    try {
      const result = await tool.execute(args, execContext);

      // Validate output against tool's outputSchema
      if (tool.outputSchema) {
        this.validateToolOutput(result, tool.outputSchema, step.call);
      }

      return result;
    } catch (error) {
      throw new ExecutionError(
        CompositionErrorCode.EXECUTION_ERROR,
        `Tool execution failed: ${step.call}`,
        `steps[${step.id}]`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute an IfValueStep (conditional value)
   */
  private async executeIfValueStep(
    step: IfValueStep,
    input: unknown,
    context: unknown,
    stepState: StepState
  ): Promise<unknown> {
    // Evaluate condition
    const conditionResult = await this.evaluateCondition(
      step.if.condition,
      input,
      context,
      stepState
    );

    // Resolve then/else branch
    if (conditionResult) {
      return await this.resolveValue(step.if.then, input, context, stepState);
    } else {
      return await this.resolveValue(step.if.else, input, context, stepState);
    }
  }

  /**
   * Resolve a value expression
   *
   * Handles:
   * - References ($input, $context, $steps)
   * - Literal values (strings, numbers, booleans)
   * - Objects (recursive resolution)
   * - Arrays (recursive resolution)
   *
   * @returns Resolved value
   */
  private async resolveValue(
    value: ValueExpression,
    input: unknown,
    context: unknown,
    stepState: StepState
  ): Promise<unknown> {
    if (isReference(value)) {
      return this.resolveReference(value, input, context, stepState);
    } else if (Array.isArray(value)) {
      // Resolve array elements
      const resolved: unknown[] = [];
      for (const item of value) {
        resolved.push(await this.resolveValue(item, input, context, stepState));
      }
      return resolved;
    } else if (value !== null && typeof value === 'object') {
      // Resolve object values
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = await this.resolveValue(val, input, context, stepState);
      }
      return resolved;
    } else {
      // Literal value
      return value;
    }
  }

  /**
   * Resolve a reference
   *
   * Uses JSON Pointer to extract value from namespace
   *
   * @param ref - Reference to resolve
   * @param input - Composition input
   * @param context - Composition context
   * @param stepState - Current step state
   * @returns Resolved value
   */
  private resolveReference(
    ref: Reference,
    input: unknown,
    context: unknown,
    stepState: StepState
  ): unknown {
    const { namespace, pointer } = ref.$ref;

    let target: unknown;
    if (namespace === 'input') {
      target = input;
    } else if (namespace === 'context') {
      target = context;
    } else if (namespace === 'steps') {
      target = stepState;
    } else {
      throw new ExecutionError(
        CompositionErrorCode.INVALID_NAMESPACE,
        `Invalid reference namespace: ${namespace}`,
        `reference`
      );
    }

    // Use JSON Pointer to extract value
    return this.getByPointer(target, pointer);
  }

  /**
   * Get value by JSON Pointer
   *
   * @param obj - Object to extract from
   * @param pointer - JSON Pointer (e.g., "/user_id", "/step1/output")
   * @returns Extracted value (undefined if path doesn't exist)
   */
  private getByPointer(obj: unknown, pointer: string): unknown {
    if (pointer === '') {
      return obj;
    }

    const parts = pointer.split('/').slice(1); // Remove leading empty string
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        // Return undefined instead of throwing (allows exists checks and skipped steps)
        return undefined;
      }

      if (typeof current !== 'object') {
        // Return undefined instead of throwing
        return undefined;
      }

      current = current[part];
    }

    return current;
  }

  /**
   * Evaluate a condition
   *
   * Supports all condition operators:
   * - exists
   * - equals
   * - greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual
   * - all, any, not
   *
   * @returns Boolean result
   */
  private async evaluateCondition(
    condition: Condition,
    input: unknown,
    context: unknown,
    stepState: StepState
  ): Promise<boolean> {
    if ('exists' in condition) {
      // Check if value exists (not null/undefined)
      const value = await this.resolveValue(condition.exists, input, context, stepState);
      return value !== null && value !== undefined;
    } else if ('equals' in condition) {
      // Check equality
      const [left, right] = condition.equals;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      return leftValue === rightValue;
    } else if ('greaterThan' in condition) {
      // Check greater than
      const [left, right] = condition.greaterThan;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      return (leftValue as number) > (rightValue as number);
    } else if ('lessThan' in condition) {
      // Check less than
      const [left, right] = condition.lessThan;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      return (leftValue as number) < (rightValue as number);
    } else if ('greaterThanOrEqual' in condition) {
      // Check greater than or equal
      const [left, right] = condition.greaterThanOrEqual;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      return (leftValue as number) >= (rightValue as number);
    } else if ('lessThanOrEqual' in condition) {
      // Check less than or equal
      const [left, right] = condition.lessThanOrEqual;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      return (leftValue as number) <= (rightValue as number);
    } else if ('all' in condition) {
      // All sub-conditions must be true
      for (const subCondition of condition.all) {
        const result = await this.evaluateCondition(subCondition, input, context, stepState);
        if (!result) {
          return false;
        }
      }
      return true;
    } else if ('any' in condition) {
      // Any sub-condition must be true
      for (const subCondition of condition.any) {
        const result = await this.evaluateCondition(subCondition, input, context, stepState);
        if (result) {
          return true;
        }
      }
      return false;
    } else if ('not' in condition) {
      // Negate sub-condition
      const result = await this.evaluateCondition(condition.not, input, context, stepState);
      return !result;
    } else {
      throw new ExecutionError(
        CompositionErrorCode.INVALID_FORMAT,
        `Unknown condition type`,
        `condition`
      );
    }
  }

  /**
   * Validate input against inputSchema
   */
  private validateInput(input: unknown, schema: unknown): void {
    const validate = this.ajv.compile(schema as object);
    const valid = validate(input);

    if (!valid) {
      const errors = validate.errors || [];
      const errorMessages = errors.map((e) => `${e.instancePath}: ${e.message}`).join(', ');

      throw new ExecutionError(
        CompositionErrorCode.VALIDATION_ERROR,
        `Input validation failed: ${errorMessages}`,
        'input'
      );
    }
  }

  /**
   * Validate output against outputSchema
   */
  private validateOutput(output: unknown, schema: unknown): void {
    const validate = this.ajv.compile(schema as object);
    const valid = validate(output);

    if (!valid) {
      const errors = validate.errors || [];
      const errorMessages = errors.map((e) => `${e.instancePath}: ${e.message}`).join(', ');

      throw new ExecutionError(
        CompositionErrorCode.VALIDATION_ERROR,
        `Output validation failed: ${errorMessages}`,
        'return'
      );
    }
  }

  /**
   * Validate tool input against tool's inputSchema
   */
  private validateToolInput(input: unknown, schema: unknown, toolId: string): void {
    const validate = this.ajv.compile(schema as object);
    const valid = validate(input);

    if (!valid) {
      const errors = validate.errors || [];
      const errorMessages = errors.map((e) => `${e.instancePath}: ${e.message}`).join(', ');

      throw new ExecutionError(
        CompositionErrorCode.VALIDATION_ERROR,
        `Tool input validation failed for ${toolId}: ${errorMessages}`,
        `tool[${toolId}].input`
      );
    }
  }

  /**
   * Validate tool output against tool's outputSchema
   */
  private validateToolOutput(output: unknown, schema: unknown, toolId: string): void {
    const validate = this.ajv.compile(schema as object);
    const valid = validate(output);

    if (!valid) {
      const errors = validate.errors || [];
      const errorMessages = errors.map((e) => `${e.instancePath}: ${e.message}`).join(', ');

      throw new ExecutionError(
        CompositionErrorCode.VALIDATION_ERROR,
        `Tool output validation failed for ${toolId}: ${errorMessages}`,
        `tool[${toolId}].output`
      );
    }
  }
}
