/**
 * Composition DSL Type Definitions
 *
 * This module defines the complete type system for the MCP Composition DSL,
 * enabling manual authoring of reusable multi-step procedures that combine
 * multiple MCP tool calls into single callable units.
 *
 * @module composition/types
 * @version 1.0.0
 * @see technical-architecture.md §4.1
 */

/**
 * JSON Schema type (draft 2020-12)
 * Used for input, output, and context schema validation
 */
export type JSONSchema = Record<string, unknown>;

// ============================================================================
// Top-Level Composition Definition
// ============================================================================

/**
 * Complete composition definition as authored in YAML/JSON
 *
 * @example
 * ```yaml
 * apiVersion: mcp-compose/v1
 * kind: Composition
 * metadata:
 *   name: viewer_greeting
 *   description: Greet returning or new viewers
 * spec:
 *   inputSchema: {...}
 *   steps: [...]
 *   return: {...}
 * ```
 */
export interface CompositionDefinition {
  /** API version identifier (currently 'mcp-compose/v1') */
  apiVersion: 'mcp-compose/v1';

  /** Resource kind (always 'Composition') */
  kind: 'Composition';

  /** Composition metadata */
  metadata: CompositionMetadata;

  /** Composition specification */
  spec: CompositionSpec;
}

/**
 * Composition metadata
 *
 * Contains identifying information and optional annotations
 */
export interface CompositionMetadata {
  /** Unique logical name (used as tool ID) */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Version number (auto-assigned by registry) */
  version?: number;

  /** Key-value labels for categorization */
  labels?: Record<string, string>;

  /** Extended metadata (arbitrary key-value pairs) */
  annotations?: Record<string, string>;
}

/**
 * Composition specification
 *
 * Defines inputs, steps, and outputs
 */
export interface CompositionSpec {
  /** JSON Schema for required input arguments */
  inputSchema: JSONSchema;

  /** Optional JSON Schema for execution context */
  contextSchema?: JSONSchema;

  /** Optional JSON Schema for output validation */
  outputSchema?: JSONSchema;

  /** Ordered list of execution steps */
  steps: Step[];

  /** Return expression defining output structure */
  return: ValueExpression;
}

// ============================================================================
// Step Definitions
// ============================================================================

/**
 * Step type union
 *
 * Each step must be one of:
 * - CallStep: Invoke a tool
 * - IfValueStep: Conditional value assignment
 */
export type Step = CallStep | IfValueStep;

/**
 * Call step - invokes a primitive or composition tool
 *
 * @example
 * ```yaml
 * - id: user
 *   call: twitch.get_user
 *   with:
 *     id: $input/user_id
 *   when:
 *     exists: $input/user_id
 * ```
 */
export interface CallStep {
  /** Unique step identifier (used in $steps references) */
  id: string;

  /** Logical tool ID to invoke */
  call: string;

  /** Optional arguments to pass to tool */
  with?: Record<string, ValueExpression>;

  /** Optional guard condition (step skipped if false) */
  when?: Condition;
}

/**
 * If/Else value step - conditional value assignment
 *
 * @example
 * ```yaml
 * - id: greeting_type
 *   if:
 *     condition:
 *       equals:
 *         - $steps/memory/returning
 *         - true
 *     then: returning_viewer
 *     else: new_viewer
 * ```
 */
export interface IfValueStep {
  /** Unique step identifier */
  id: string;

  /** Conditional value definition */
  if: {
    /** Condition to evaluate */
    condition: Condition;

    /** Value if condition is true */
    then: ValueExpression;

    /** Value if condition is false */
    else: ValueExpression;
  };
}

// ============================================================================
// Value Expressions
// ============================================================================

/**
 * Value expression type union
 *
 * Can be:
 * - Reference: Dynamic value from $input/$context/$steps
 * - Literal: Static primitive value
 * - Object: Nested key-value structure
 * - Array: Ordered list of values
 */
export type ValueExpression =
  | Reference
  | LiteralValue
  | { [key: string]: ValueExpression }
  | ValueExpression[];

/**
 * Reference to a dynamic value
 *
 * References use JSON Pointer syntax with namespace prefixes:
 * - $input/field → Caller-provided arguments
 * - $context/field → Execution context (channel_id, etc.)
 * - $steps/stepId/field → Output from previous step
 *
 * @example
 * ```typescript
 * // Shorthand (YAML): $input/user_id
 * // Canonical (AST):
 * {
 *   $ref: {
 *     namespace: 'input',
 *     pointer: '/user_id'
 *   }
 * }
 * ```
 */
export interface Reference {
  $ref: {
    /** Namespace: input, context, or steps */
    namespace: 'input' | 'context' | 'steps';

    /** JSON Pointer path (e.g., '/user/id') */
    pointer: string;
  };
}

/**
 * Literal scalar value
 */
export type LiteralValue = string | number | boolean | null;

// ============================================================================
// Conditions
// ============================================================================

/**
 * Condition type union
 *
 * Supports deterministic boolean logic:
 * - Existence checks
 * - Equality/comparison operators
 * - Logical combinators (all, any, not)
 */
export type Condition =
  | ExistsCondition
  | EqualsCondition
  | GreaterThanCondition
  | LessThanCondition
  | GreaterThanOrEqualCondition
  | LessThanOrEqualCondition
  | AllCondition
  | AnyCondition
  | NotCondition;

/**
 * Existence check - true if reference exists and is not null/undefined
 *
 * @example
 * ```yaml
 * exists: $steps/user/org_id
 * ```
 */
export interface ExistsCondition {
  exists: ValueExpression;
}

/**
 * Equality check - strict equality (===)
 *
 * @example
 * ```yaml
 * equals:
 *   - $steps/status
 *   - active
 * ```
 */
export interface EqualsCondition {
  equals: [ValueExpression, ValueExpression];
}

/**
 * Greater than comparison (>)
 *
 * @example
 * ```yaml
 * greaterThan:
 *   - $steps/count
 *   - 100
 * ```
 */
export interface GreaterThanCondition {
  greaterThan: [ValueExpression, ValueExpression];
}

/**
 * Less than comparison (<)
 */
export interface LessThanCondition {
  lessThan: [ValueExpression, ValueExpression];
}

/**
 * Greater than or equal comparison (>=)
 */
export interface GreaterThanOrEqualCondition {
  greaterThanOrEqual: [ValueExpression, ValueExpression];
}

/**
 * Less than or equal comparison (<=)
 */
export interface LessThanOrEqualCondition {
  lessThanOrEqual: [ValueExpression, ValueExpression];
}

/**
 * Logical AND - all conditions must be true
 *
 * @example
 * ```yaml
 * all:
 *   - exists: $steps/user/id
 *   - greaterThan: [$steps/user/reputation, 50]
 * ```
 */
export interface AllCondition {
  all: Condition[];
}

/**
 * Logical OR - at least one condition must be true
 *
 * @example
 * ```yaml
 * any:
 *   - equals: [$input/role, admin]
 *   - equals: [$input/role, moderator]
 * ```
 */
export interface AnyCondition {
  any: Condition[];
}

/**
 * Logical NOT - negates the condition
 *
 * @example
 * ```yaml
 * not:
 *   equals:
 *     - $input/status
 *     - blocked
 * ```
 */
export interface NotCondition {
  not: Condition;
}

// ============================================================================
// Compiled Composition
// ============================================================================

/**
 * Compiled composition with validation metadata
 *
 * Produced by CompositionCompiler after validation
 */
export interface CompiledComposition {
  /** Unique identifier (UUID) */
  id: string;

  /** Composition metadata */
  metadata: CompositionMetadata;

  /** Composition specification */
  spec: CompositionSpec;

  /** Compilation timestamp */
  compiledAt: Date;

  /** SHA-256 hash of canonical AST (for deduplication) */
  contentHash: string;

  /** Tool dependencies with schema fingerprints */
  dependencies: ToolDependency[];

  /** Validation report */
  validationReport: ValidationReport;
}

/**
 * Tool dependency record
 *
 * Tracks which tools this composition depends on and their schema versions
 */
export interface ToolDependency {
  /** Logical tool ID */
  toolId: string;

  /** SHA-256 hash of tool's input schema */
  schemaFingerprint: string;
}

/**
 * Validation report
 *
 * Contains validation results from compilation
 */
export interface ValidationReport {
  /** Overall validation status */
  valid: boolean;

  /** Validation errors (prevent compilation) */
  errors: ValidationError[];

  /** Validation warnings (non-blocking) */
  warnings: ValidationWarning[];
}

/**
 * Validation error
 *
 * Indicates a problem that prevents compilation
 */
export interface ValidationError {
  /** Error code (e.g., 'COMPOSE-TOOL-001') */
  code: string;

  /** Human-readable error message */
  message: string;

  /** Optional JSON path to error location */
  location?: string;
}

/**
 * Validation warning
 *
 * Indicates a potential issue (non-blocking)
 */
export interface ValidationWarning {
  /** Warning code */
  code: string;

  /** Human-readable warning message */
  message: string;

  /** Optional JSON path to warning location */
  location?: string;
}

// ============================================================================
// Execution Context
// ============================================================================

/**
 * Execution context for composition runtime
 *
 * Passed to executor with caller-provided data and authorization context
 */
export interface ExecutionContext {
  /** Caller-provided input arguments (validated against inputSchema) */
  input: unknown;

  /** Execution context (channel_id, etc.) */
  context: unknown;

  /** MCP session identifier */
  sessionId: string;

  /** Correlation ID for tracing */
  correlationId: string;

  /** Caller's authorization roles */
  userRoles: string[];
}

/**
 * Execution state during runtime
 *
 * Maintains resolved values for reference resolution
 */
export interface ExecutionState {
  /** Input arguments */
  input: unknown;

  /** Execution context */
  context: unknown;

  /** Step results keyed by step.id */
  steps: Map<string, unknown>;
}

/**
 * Execution status enumeration
 */
export enum ExecutionStatus {
  /** Execution completed successfully */
  SUCCESS = 'success',

  /** Execution failed with error */
  FAILED = 'failed',
}

/**
 * Execution result
 *
 * Returned by executor after composition execution
 */
export interface ExecutionResult {
  /** Execution status */
  status: ExecutionStatus;

  /** Composition output (if successful) */
  output?: unknown;

  /** Error message (if failed) */
  error?: string;

  /** Error code (if failed) */
  errorCode?: CompositionErrorCode;

  /** Error location (if failed) */
  errorLocation?: string;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Number of steps executed */
  stepsExecuted?: number;
}

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Standard composition error codes
 *
 * Used in ValidationError.code for consistent error handling
 */
export enum CompositionErrorCode {
  /** Tool not found in registry */
  TOOL_NOT_FOUND = 'COMPOSE-TOOL-001',

  /** Circular dependency detected */
  CIRCULAR_DEPENDENCY = 'COMPOSE-CYCLE-001',

  /** Reference to undefined step */
  UNDEFINED_REFERENCE = 'COMPOSE-REF-001',

  /** Invalid reference namespace */
  INVALID_NAMESPACE = 'COMPOSE-REF-002',

  /** Input schema validation failed */
  INPUT_VALIDATION_FAILED = 'COMPOSE-INPUT-001',

  /** Output schema validation failed */
  OUTPUT_VALIDATION_FAILED = 'COMPOSE-OUTPUT-001',

  /** Step execution failed */
  STEP_EXECUTION_FAILED = 'COMPOSE-EXEC-001',

  /** Invalid composition format */
  INVALID_FORMAT = 'COMPOSE-FORMAT-001',

  /** General execution error */
  EXECUTION_ERROR = 'COMPOSE-EXEC-002',

  /** General validation error */
  VALIDATION_ERROR = 'COMPOSE-VALID-001',
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for Reference
 */
export function isReference(value: unknown): value is Reference {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$ref' in value &&
    typeof (value as Reference).$ref === 'object' &&
    'namespace' in (value as Reference).$ref &&
    'pointer' in (value as Reference).$ref
  );
}

/**
 * Type guard for CallStep
 */
export function isCallStep(step: Step): step is CallStep {
  return 'call' in step;
}

/**
 * Type guard for IfValueStep
 */
export function isIfValueStep(step: Step): step is IfValueStep {
  return 'if' in step;
}
