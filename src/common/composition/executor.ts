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
import type { Logger } from '../logging';
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
  TemplateExpression,
  Condition,
  isReference,
  isTemplateExpression,
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
 * const executor = new CompositionExecutor(toolRegistry, logger);
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

  constructor(
    private registry: ToolRegistryInterface,
    private logger: Logger
  ) {
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
    const compositionName = composition.metadata.name;
    const stepCount = composition.spec.steps.length;

    this.logger.debug('execution_started', {
      composition: compositionName,
      stepCount,
      hasInputSchema: !!composition.spec.inputSchema,
      hasOutputSchema: !!composition.spec.outputSchema,
      sessionId: context.sessionId,
    });

    const startTime = Date.now();

    try {
      // 1. Validate input against inputSchema
      if (composition.spec.inputSchema) {
        this.logger.trace('execution_validating_input', {
          composition: compositionName,
        });
        this.validateInput(context.input, composition.spec.inputSchema);
        this.logger.debug('execution_input_validated', {
          composition: compositionName,
        });
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
            this.logger.debug('execution_step_skipped', {
              composition: compositionName,
              stepId: step.id,
              reason: 'condition_false',
            });
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
      this.logger.trace('execution_resolving_return', {
        composition: compositionName,
      });

      const output = await this.resolveValue(
        composition.spec.return,
        context.input,
        context.context,
        stepState
      );

      // 4. Validate output against outputSchema
      if (composition.spec.outputSchema) {
        this.logger.trace('execution_validating_output', {
          composition: compositionName,
        });
        this.validateOutput(output, composition.spec.outputSchema);
        this.logger.debug('execution_output_validated', {
          composition: compositionName,
        });
      }

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      const stepsExecuted = Object.keys(stepState).length;

      this.logger.info('execution_succeeded', {
        composition: compositionName,
        executionTime,
        stepsExecuted,
        totalSteps: stepCount,
      });

      return {
        status: ExecutionStatus.SUCCESS,
        output,
        executionTime,
        stepsExecuted,
      };
    } catch (error) {
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      if (error instanceof ExecutionError) {
        this.logger.error('execution_failed', {
          composition: compositionName,
          executionTime,
          errorCode: error.code,
          errorMessage: error.message,
          errorLocation: error.location,
        });

        return {
          status: ExecutionStatus.FAILED,
          error: error.message,
          errorCode: error.code,
          errorLocation: error.location,
          executionTime,
        };
      }

      // Unexpected error
      this.logger.error('execution_failed_unexpected', {
        composition: compositionName,
        executionTime,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

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
    const stepType = isCallStep(step) ? 'call' : isIfValueStep(step) ? 'if_value' : 'unknown';

    this.logger.trace('step_execution_started', {
      stepId: step.id,
      stepType,
    });

    const startTime = Date.now();

    try {
      let result: unknown;

      if (isCallStep(step)) {
        result = await this.executeCallStep(step, input, context, stepState, execContext);
      } else if (isIfValueStep(step)) {
        result = await this.executeIfValueStep(step, input, context, stepState);
      } else {
        // TypeScript narrows to 'never' here, but we still know step has an id
        const unknownStep = step as { id: string };

        this.logger.error('step_execution_unknown_type', {
          stepId: unknownStep.id,
        });

        throw new ExecutionError(
          CompositionErrorCode.INVALID_FORMAT,
          `Unknown step type for step: ${unknownStep.id}`,
          `steps[${unknownStep.id}]`
        );
      }

      const executionTime = Date.now() - startTime;

      this.logger.debug('step_execution_succeeded', {
        stepId: step.id,
        stepType,
        executionTime,
        hasOutput: result !== undefined && result !== null,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('step_execution_failed', {
        stepId: step.id,
        stepType,
        executionTime,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof ExecutionError ? error.code : undefined,
      });

      throw error;
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
    this.logger.trace('tool_invocation_resolving', {
      stepId: step.id,
      toolId: step.call,
    });

    // Resolve tool from registry
    const tool = this.registry.getTool(step.call);

    if (!tool) {
      this.logger.error('tool_invocation_not_found', {
        stepId: step.id,
        toolId: step.call,
      });

      throw new ExecutionError(
        CompositionErrorCode.TOOL_NOT_FOUND,
        `Tool not found: ${step.call}`,
        `steps[${step.id}].call`
      );
    }

    if (!tool.execute) {
      this.logger.error('tool_invocation_not_executable', {
        stepId: step.id,
        toolId: step.call,
      });

      throw new ExecutionError(
        CompositionErrorCode.TOOL_NOT_FOUND,
        `Tool ${step.call} does not support execution`,
        `steps[${step.id}].call`
      );
    }

    // Resolve arguments
    let args: unknown = {};
    if (step.with) {
      this.logger.trace('tool_invocation_resolving_args', {
        stepId: step.id,
        toolId: step.call,
      });
      args = await this.resolveValue(step.with, input, context, stepState);
    }

    // Validate input against tool's inputSchema
    if (tool.inputSchema) {
      this.logger.trace('tool_invocation_validating_input', {
        stepId: step.id,
        toolId: step.call,
      });
      this.validateToolInput(args, tool.inputSchema, step.call);
    }

    // Invoke tool
    this.logger.debug('tool_invocation_started', {
      stepId: step.id,
      toolId: step.call,
      hasArgs: !!step.with,
      hasInputSchema: !!tool.inputSchema,
      hasOutputSchema: !!tool.outputSchema,
    });

    const startTime = Date.now();

    try {
      const result = await tool.execute(args, execContext);

      const executionTime = Date.now() - startTime;

      // Validate output against tool's outputSchema
      if (tool.outputSchema) {
        this.logger.trace('tool_invocation_validating_output', {
          stepId: step.id,
          toolId: step.call,
        });
        this.validateToolOutput(result, tool.outputSchema, step.call);
      }

      this.logger.debug('tool_invocation_succeeded', {
        stepId: step.id,
        toolId: step.call,
        executionTime,
        hasResult: result !== undefined && result !== null,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('tool_invocation_failed', {
        stepId: step.id,
        toolId: step.call,
        executionTime,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

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
   * - Template expressions ({{variable}} interpolation)
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
    } else if (isTemplateExpression(value)) {
      // Template expression - MUST come before generic object check
      // because templates are objects with 'template' property
      return await this.resolveTemplate(value, input, context, stepState);
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

    this.logger.trace('reference_resolution_started', {
      namespace,
      pointer,
    });

    let target: unknown;
    if (namespace === 'input') {
      target = input;
    } else if (namespace === 'context') {
      target = context;
    } else if (namespace === 'steps') {
      target = stepState;
    } else {
      this.logger.error('reference_resolution_invalid_namespace', {
        namespace,
        pointer,
      });

      throw new ExecutionError(
        CompositionErrorCode.INVALID_NAMESPACE,
        `Invalid reference namespace: ${namespace}`,
        `reference`
      );
    }

    // Use JSON Pointer to extract value
    const value = this.getByPointer(target, pointer);

    this.logger.trace('reference_resolution_succeeded', {
      namespace,
      pointer,
      hasValue: value !== undefined,
    });

    return value;
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
   * Resolve a template expression
   *
   * Interpolates {{variable}} placeholders with resolved variable values.
   * Variables are resolved recursively using resolveValue() and coerced to strings.
   *
   * String coercion rules:
   * - null/undefined → empty string ''
   * - string → unchanged
   * - number/boolean → String(value)
   * - object/array → ERROR (must reference specific field)
   *
   * @param template - Template expression to resolve
   * @param input - Composition input
   * @param context - Composition context
   * @param stepState - Current step state
   * @returns Interpolated string
   * @throws ExecutionError if variable is undefined or object/array coercion attempted
   */
  private async resolveTemplate(
    template: TemplateExpression,
    input: unknown,
    context: unknown,
    stepState: StepState
  ): Promise<string> {
    const templateString = template.template;

    // Extract variable definitions (all properties except 'template')
    const variableDefinitions: Record<string, ValueExpression> = {};
    for (const [key, value] of Object.entries(template)) {
      if (key !== 'template') {
        variableDefinitions[key] = value;
      }
    }

    const variableCount = Object.keys(variableDefinitions).length;

    this.logger.trace('template_interpolation_started', {
      templateString,
      variableCount,
    });

    // Resolve all variables
    const resolvedVariables: Record<string, string> = {};
    for (const [varName, varExpression] of Object.entries(variableDefinitions)) {
      this.logger.trace('template_variable_resolving', {
        variableName: varName,
      });

      const resolvedValue = await this.resolveValue(
        varExpression,
        input,
        context,
        stepState
      );

      // Coerce to string
      if (resolvedValue === null || resolvedValue === undefined) {
        this.logger.debug('template_variable_null', {
          variableName: varName,
        });
        resolvedVariables[varName] = '';
      } else if (typeof resolvedValue === 'string') {
        resolvedVariables[varName] = resolvedValue;
      } else if (typeof resolvedValue === 'number' || typeof resolvedValue === 'boolean') {
        resolvedVariables[varName] = String(resolvedValue);
      } else {
        // Object/array -> error with helpful message
        const type = Array.isArray(resolvedValue) ? 'array' : 'object';

        this.logger.error('template_variable_non_scalar', {
          variableName: varName,
          type,
        });

        throw new ExecutionError(
          CompositionErrorCode.VALIDATION_ERROR,
          `Template variable "${varName}" resolved to ${type}. ` +
          `Templates require scalar values. ` +
          `Use a reference to a specific field (e.g., $ref: { namespace: steps, pointer: /${varName}/field })`,
          `template.${varName}`
        );
      }
    }

    this.logger.debug('template_variables_resolved', {
      variableCount,
      variables: Object.keys(resolvedVariables),
    });

    // Step 1: Replace escaped braces with placeholder to protect them
    const ESCAPE_PLACEHOLDER = '\x00ESCAPED_BRACE\x00';
    let result = templateString.replace(/\\\{\{/g, ESCAPE_PLACEHOLDER);

    // Step 2: Interpolate variables into template string
    // Regex: /\{\{(\w+)\}\}/g matches {{variable_name}}
    result = result.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      if (varName in resolvedVariables) {
        return resolvedVariables[varName];
      } else {
        // Undefined variable - throw clear error
        this.logger.error('template_variable_undefined', {
          variableName: varName,
          availableVariables: Object.keys(resolvedVariables),
        });

        throw new ExecutionError(
          CompositionErrorCode.UNDEFINED_REFERENCE,
          `Undefined template variable: {{${varName}}}. ` +
          `Define it as a property of the template object.`,
          `template`
        );
      }
    });

    // Step 3: Restore escaped braces: placeholder -> {{
    result = result.replace(new RegExp(ESCAPE_PLACEHOLDER, 'g'), '{{');

    this.logger.debug('template_interpolation_succeeded', {
      resultLength: result.length,
    });

    return result;
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
    // Determine condition type for logging
    const conditionType = Object.keys(condition)[0] as string;

    this.logger.trace('condition_evaluation_started', {
      conditionType,
    });

    let result: boolean;

    if ('exists' in condition) {
      // Check if value exists (not null/undefined)
      const value = await this.resolveValue(condition.exists, input, context, stepState);
      result = value !== null && value !== undefined;

      this.logger.trace('condition_evaluation_exists', {
        result,
        hasValue: result,
      });
    } else if ('equals' in condition) {
      // Check equality
      const [left, right] = condition.equals;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      result = leftValue === rightValue;

      this.logger.trace('condition_evaluation_equals', {
        result,
      });
    } else if ('greaterThan' in condition) {
      // Check greater than
      const [left, right] = condition.greaterThan;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      result = (leftValue as number) > (rightValue as number);

      this.logger.trace('condition_evaluation_greaterThan', {
        result,
      });
    } else if ('lessThan' in condition) {
      // Check less than
      const [left, right] = condition.lessThan;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      result = (leftValue as number) < (rightValue as number);

      this.logger.trace('condition_evaluation_lessThan', {
        result,
      });
    } else if ('greaterThanOrEqual' in condition) {
      // Check greater than or equal
      const [left, right] = condition.greaterThanOrEqual;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      result = (leftValue as number) >= (rightValue as number);

      this.logger.trace('condition_evaluation_greaterThanOrEqual', {
        result,
      });
    } else if ('lessThanOrEqual' in condition) {
      // Check less than or equal
      const [left, right] = condition.lessThanOrEqual;
      const leftValue = await this.resolveValue(left, input, context, stepState);
      const rightValue = await this.resolveValue(right, input, context, stepState);
      result = (leftValue as number) <= (rightValue as number);

      this.logger.trace('condition_evaluation_lessThanOrEqual', {
        result,
      });
    } else if ('all' in condition) {
      // All sub-conditions must be true
      this.logger.trace('condition_evaluation_all_started', {
        subConditionCount: condition.all.length,
      });

      for (const subCondition of condition.all) {
        const subResult = await this.evaluateCondition(subCondition, input, context, stepState);
        if (!subResult) {
          result = false;
          this.logger.trace('condition_evaluation_all_short_circuit', {
            result: false,
          });
          return result;
        }
      }
      result = true;

      this.logger.trace('condition_evaluation_all_succeeded', {
        result: true,
      });
    } else if ('any' in condition) {
      // Any sub-condition must be true
      this.logger.trace('condition_evaluation_any_started', {
        subConditionCount: condition.any.length,
      });

      for (const subCondition of condition.any) {
        const subResult = await this.evaluateCondition(subCondition, input, context, stepState);
        if (subResult) {
          result = true;
          this.logger.trace('condition_evaluation_any_short_circuit', {
            result: true,
          });
          return result;
        }
      }
      result = false;

      this.logger.trace('condition_evaluation_any_failed', {
        result: false,
      });
    } else if ('not' in condition) {
      // Negate sub-condition
      const subResult = await this.evaluateCondition(condition.not, input, context, stepState);
      result = !subResult;

      this.logger.trace('condition_evaluation_not', {
        result,
      });
    } else {
      this.logger.error('condition_evaluation_unknown_type', {
        conditionKeys: Object.keys(condition),
      });

      throw new ExecutionError(
        CompositionErrorCode.INVALID_FORMAT,
        `Unknown condition type`,
        `condition`
      );
    }

    this.logger.debug('condition_evaluation_completed', {
      conditionType,
      result,
    });

    return result;
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
   * Sprint 43: Support both JSON Schema (for compositions) and Zod schemas (for platform tools)
   */
  private validateToolInput(input: unknown, schema: unknown, toolId: string): void {
    // Check if this is a Zod schema (has safeParse method)
    if (schema && typeof schema === 'object' && 'safeParse' in schema && typeof (schema as any).safeParse === 'function') {
      // Use Zod validation
      const result = (schema as any).safeParse(input);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new ExecutionError(
          CompositionErrorCode.VALIDATION_ERROR,
          `Tool input validation failed for ${toolId}: ${errorMessages}`,
          `tool[${toolId}].input`
        );
      }
      return;
    }

    // Use Ajv for JSON Schema validation
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
   * Sprint 43: Support both JSON Schema (for compositions) and Zod schemas (for platform tools)
   */
  private validateToolOutput(output: unknown, schema: unknown, toolId: string): void {
    // Check if this is a Zod schema (has safeParse method)
    if (schema && typeof schema === 'object' && 'safeParse' in schema && typeof (schema as any).safeParse === 'function') {
      // Use Zod validation
      const result = (schema as any).safeParse(output);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new ExecutionError(
          CompositionErrorCode.VALIDATION_ERROR,
          `Tool output validation failed for ${toolId}: ${errorMessages}`,
          `tool[${toolId}].output`
        );
      }
      return;
    }

    // Use Ajv for JSON Schema validation
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
