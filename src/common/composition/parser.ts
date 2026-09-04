/**
 * Composition Parser
 *
 * Parses YAML or JSON composition definitions into canonical AST representation.
 * Handles reference canonicalization and structural validation.
 *
 * @module composition/parser
 * @version 1.0.0
 * @see technical-architecture.md §4.2
 */

import yaml from 'js-yaml';
import {
  CompositionDefinition,
  CompositionSpec,
  Step,
  CallStep,
  IfValueStep,
  ValueExpression,
  Reference,
  Condition,
  LiteralValue,
  CompositionErrorCode,
} from './types';

/**
 * Composition Parser
 *
 * Converts YAML or JSON source into canonical CompositionDefinition AST.
 * Performs structural validation and reference canonicalization.
 *
 * @example
 * ```typescript
 * const parser = new CompositionParser();
 * const yaml = fs.readFileSync('viewer_greeting.yaml', 'utf-8');
 * const composition = parser.parse(yaml);
 * ```
 */
export class CompositionParser {
  /**
   * Parse composition source into canonical AST
   *
   * @param source - YAML string, JSON string, or parsed object
   * @returns Canonical CompositionDefinition
   * @throws Error if source is invalid or malformed
   */
  parse(source: string | object): CompositionDefinition {
    let obj: unknown;

    // Parse source to object
    if (typeof source === 'string') {
      obj = this.parseString(source);
    } else {
      obj = source;
    }

    // Validate top-level structure
    this.validateTopLevel(obj);

    // Canonicalize and return
    return this.canonicalize(obj as Record<string, unknown>);
  }

  /**
   * Parse string source (YAML or JSON)
   *
   * Attempts YAML first (more permissive), falls back to JSON
   */
  private parseString(source: string): unknown {
    // Try YAML first (YAML parser handles JSON too)
    try {
      return yaml.load(source);
    } catch (yamlError) {
      // If YAML fails, try strict JSON
      try {
        return JSON.parse(source);
      } catch (jsonError) {
        throw new Error(
          `Failed to parse composition: Invalid YAML/JSON format. ` +
          `YAML error: ${(yamlError as Error).message}. ` +
          `JSON error: ${(jsonError as Error).message}`
        );
      }
    }
  }

  /**
   * Validate top-level structure
   *
   * Ensures required fields are present and have correct values
   */
  private validateTopLevel(obj: unknown): asserts obj is {
    apiVersion: string;
    kind: string;
    metadata: { name: string };
    spec: unknown;
  } {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Composition must be an object`
      );
    }

    const composition = obj as Record<string, unknown>;

    // Validate apiVersion
    if (composition.apiVersion !== 'mcp-compose/v1') {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Invalid apiVersion: "${composition.apiVersion}". ` +
        `Expected "mcp-compose/v1"`
      );
    }

    // Validate kind
    if (composition.kind !== 'Composition') {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Invalid kind: "${composition.kind}". ` +
        `Expected "Composition"`
      );
    }

    // Validate metadata
    if (typeof composition.metadata !== 'object' || composition.metadata === null) {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Missing required field: metadata`
      );
    }

    const metadata = composition.metadata as Record<string, unknown>;
    if (typeof metadata.name !== 'string' || !metadata.name) {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Missing required field: metadata.name`
      );
    }

    // Validate spec
    if (typeof composition.spec !== 'object' || composition.spec === null) {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Missing required field: spec`
      );
    }
  }

  /**
   * Canonicalize composition into standard AST format
   *
   * Converts shorthand references to explicit $ref objects
   */
  private canonicalize(obj: Record<string, unknown>): CompositionDefinition {
    const spec = obj.spec as Record<string, unknown>;

    return {
      apiVersion: 'mcp-compose/v1',
      kind: 'Composition',
      metadata: {
        name: (obj.metadata as Record<string, unknown>).name as string,
        description: (obj.metadata as Record<string, unknown>).description as string | undefined,
        version: (obj.metadata as Record<string, unknown>).version as number | undefined,
        labels: (obj.metadata as Record<string, unknown>).labels as Record<string, string> | undefined,
        annotations: (obj.metadata as Record<string, unknown>).annotations as Record<string, string> | undefined,
      },
      spec: {
        inputSchema: spec.inputSchema as Record<string, unknown>,
        contextSchema: spec.contextSchema as Record<string, unknown> | undefined,
        outputSchema: spec.outputSchema as Record<string, unknown> | undefined,
        steps: (spec.steps as unknown[]).map((s) => this.canonicalizeStep(s)),
        return: this.canonicalizeValue(spec.return),
      },
    };
  }

  /**
   * Canonicalize a step
   */
  private canonicalizeStep(step: unknown): Step {
    if (typeof step !== 'object' || step === null) {
      throw new Error(`${CompositionErrorCode.INVALID_FORMAT}: Step must be an object`);
    }

    const stepObj = step as Record<string, unknown>;

    if (!stepObj.id || typeof stepObj.id !== 'string') {
      throw new Error(`${CompositionErrorCode.INVALID_FORMAT}: Step missing required field: id`);
    }

    // CallStep
    if ('call' in stepObj) {
      if (typeof stepObj.call !== 'string') {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: CallStep.call must be a string`
        );
      }

      const callStep: CallStep = {
        id: stepObj.id,
        call: stepObj.call,
      };

      if (stepObj.with) {
        callStep.with = this.canonicalizeObject(stepObj.with as Record<string, unknown>);
      }

      if (stepObj.when) {
        callStep.when = this.canonicalizeCondition(stepObj.when);
      }

      return callStep;
    }

    // IfValueStep
    if ('if' in stepObj) {
      const ifBlock = stepObj.if as Record<string, unknown>;

      if (!ifBlock.condition) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: IfValueStep missing required field: if.condition`
        );
      }

      if (!('then' in ifBlock)) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: IfValueStep missing required field: if.then`
        );
      }

      if (!('else' in ifBlock)) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: IfValueStep missing required field: if.else`
        );
      }

      const ifValueStep: IfValueStep = {
        id: stepObj.id,
        if: {
          condition: this.canonicalizeCondition(ifBlock.condition),
          then: this.canonicalizeValue(ifBlock.then),
          else: this.canonicalizeValue(ifBlock.else),
        },
      };

      return ifValueStep;
    }

    throw new Error(
      `${CompositionErrorCode.INVALID_FORMAT}: Step must have either 'call' or 'if' field`
    );
  }

  /**
   * Canonicalize a value expression
   *
   * Converts shorthand references ($input/foo) to explicit Reference objects
   */
  private canonicalizeValue(val: unknown): ValueExpression {
    // Null
    if (val === null) {
      return null;
    }

    // Shorthand reference: "$input/foo" → {$ref: ...}
    if (typeof val === 'string' && val.startsWith('$')) {
      return this.parseReference(val);
    }

    // Primitive literal
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      return val as LiteralValue;
    }

    // Array
    if (Array.isArray(val)) {
      return val.map((item) => this.canonicalizeValue(item));
    }

    // Object (check if it's already a canonical reference)
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;

      // Already canonical reference
      if ('$ref' in obj && typeof obj.$ref === 'object' && obj.$ref !== null) {
        const ref = obj.$ref as { namespace?: unknown; pointer?: unknown };
        if (typeof ref.namespace === 'string' && typeof ref.pointer === 'string') {
          return obj as unknown as Reference;
        }
      }

      // Regular object - canonicalize values
      return this.canonicalizeObject(obj);
    }

    // Shouldn't reach here
    throw new Error(
      `${CompositionErrorCode.INVALID_FORMAT}: Unsupported value type: ${typeof val}`
    );
  }

  /**
   * Canonicalize an object (key-value pairs)
   */
  private canonicalizeObject(obj: Record<string, unknown>): Record<string, ValueExpression> {
    const result: Record<string, ValueExpression> = {};

    for (const [key, val] of Object.entries(obj)) {
      result[key] = this.canonicalizeValue(val);
    }

    return result;
  }

  /**
   * Parse shorthand reference into canonical Reference object
   *
   * @param ref - Shorthand reference (e.g., "$input/user_id")
   * @returns Canonical Reference object
   *
   * @example
   * "$input/user_id" → {$ref: {namespace: "input", pointer: "/user_id"}}
   */
  private parseReference(ref: string): Reference {
    // Format: $namespace/path/to/value
    const match = ref.match(/^\$([^/]+)\/(.+)$/);

    if (!match) {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Invalid reference format: "${ref}". ` +
        `Expected format: $namespace/path`
      );
    }

    const namespace = match[1];
    const path = match[2];

    // Validate namespace
    if (!['input', 'context', 'steps'].includes(namespace)) {
      throw new Error(
        `${CompositionErrorCode.INVALID_NAMESPACE}: Invalid reference namespace: "${namespace}". ` +
        `Must be one of: input, context, steps`
      );
    }

    // Convert path to JSON Pointer format
    // "foo/bar" → "/foo/bar"
    const pointer = '/' + path;

    return {
      $ref: {
        namespace: namespace as 'input' | 'context' | 'steps',
        pointer,
      },
    };
  }

  /**
   * Canonicalize a condition
   */
  private canonicalizeCondition(cond: unknown): Condition {
    if (typeof cond !== 'object' || cond === null) {
      throw new Error(
        `${CompositionErrorCode.INVALID_FORMAT}: Condition must be an object`
      );
    }

    const condObj = cond as Record<string, unknown>;

    // Exists
    if ('exists' in condObj) {
      return {
        exists: this.canonicalizeValue(condObj.exists),
      };
    }

    // Equals
    if ('equals' in condObj) {
      if (!Array.isArray(condObj.equals) || condObj.equals.length !== 2) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: equals condition requires array of 2 values`
        );
      }
      return {
        equals: [
          this.canonicalizeValue(condObj.equals[0]),
          this.canonicalizeValue(condObj.equals[1]),
        ],
      };
    }

    // GreaterThan
    if ('greaterThan' in condObj) {
      if (!Array.isArray(condObj.greaterThan) || condObj.greaterThan.length !== 2) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: greaterThan condition requires array of 2 values`
        );
      }
      return {
        greaterThan: [
          this.canonicalizeValue(condObj.greaterThan[0]),
          this.canonicalizeValue(condObj.greaterThan[1]),
        ],
      };
    }

    // LessThan
    if ('lessThan' in condObj) {
      if (!Array.isArray(condObj.lessThan) || condObj.lessThan.length !== 2) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: lessThan condition requires array of 2 values`
        );
      }
      return {
        lessThan: [
          this.canonicalizeValue(condObj.lessThan[0]),
          this.canonicalizeValue(condObj.lessThan[1]),
        ],
      };
    }

    // GreaterThanOrEqual
    if ('greaterThanOrEqual' in condObj) {
      if (!Array.isArray(condObj.greaterThanOrEqual) || condObj.greaterThanOrEqual.length !== 2) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: greaterThanOrEqual condition requires array of 2 values`
        );
      }
      return {
        greaterThanOrEqual: [
          this.canonicalizeValue(condObj.greaterThanOrEqual[0]),
          this.canonicalizeValue(condObj.greaterThanOrEqual[1]),
        ],
      };
    }

    // LessThanOrEqual
    if ('lessThanOrEqual' in condObj) {
      if (!Array.isArray(condObj.lessThanOrEqual) || condObj.lessThanOrEqual.length !== 2) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: lessThanOrEqual condition requires array of 2 values`
        );
      }
      return {
        lessThanOrEqual: [
          this.canonicalizeValue(condObj.lessThanOrEqual[0]),
          this.canonicalizeValue(condObj.lessThanOrEqual[1]),
        ],
      };
    }

    // All (logical AND)
    if ('all' in condObj) {
      if (!Array.isArray(condObj.all)) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: all condition requires array of conditions`
        );
      }
      return {
        all: condObj.all.map((c) => this.canonicalizeCondition(c)),
      };
    }

    // Any (logical OR)
    if ('any' in condObj) {
      if (!Array.isArray(condObj.any)) {
        throw new Error(
          `${CompositionErrorCode.INVALID_FORMAT}: any condition requires array of conditions`
        );
      }
      return {
        any: condObj.any.map((c) => this.canonicalizeCondition(c)),
      };
    }

    // Not (logical negation)
    if ('not' in condObj) {
      return {
        not: this.canonicalizeCondition(condObj.not),
      };
    }

    throw new Error(
      `${CompositionErrorCode.INVALID_FORMAT}: Unknown condition operator. ` +
      `Supported: exists, equals, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual, all, any, not`
    );
  }
}
