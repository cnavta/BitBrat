import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Standard Schema v1 interface specification.
 * See: https://standardschema.dev/
 */
export interface StandardSchemaV1 {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) =>
    | { value: unknown; issues?: undefined }
    | { issues: Array<{ message: string; path?: string[] }> };
}

/**
 * Standard JSON Schema extension for Standard Schema.
 * See: https://standardschema.dev/json-schema
 */
export interface StandardJSONSchemaV1 {
  readonly jsonSchema: {
    input: (options?: { target?: string }) => unknown;
    output: (options?: { target?: string }) => unknown;
  };
}

/**
 * Combined interface: Standard Schema with JSON Schema extension.
 */
export interface StandardSchemaWithJSON {
  readonly "~standard": StandardSchemaV1 & StandardJSONSchemaV1;
}

/**
 * Wraps a JSON Schema in the Standard Schema interface for use with MCP SDK 2.0.
 *
 * This adapter bridges BitBrat's declarative JSON Schema compositions and the
 * MCP SDK's Standard Schema requirement. Composition authors continue writing
 * JSON Schema in YAML; this adapter is internal infrastructure.
 *
 * Uses Ajv for JSON Schema validation (industry standard, 12M+ downloads/week).
 * Returns original JSON Schema via jsonSchema.input() (no lossy conversion).
 *
 * @example
 * ```typescript
 * const jsonSchema = {
 *   type: 'object',
 *   properties: {
 *     prompt: { type: 'string' },
 *     style: { type: 'string', enum: ['realistic', 'cartoon'] }
 *   },
 *   required: ['prompt']
 * };
 *
 * const adapter = new JsonSchemaStandardAdapter(jsonSchema, 'grockle');
 *
 * // MCP SDK calls this to get JSON Schema for LLM
 * const schema = adapter["~standard"].jsonSchema.input();
 * // Returns original jsonSchema (no conversion)
 *
 * // MCP SDK calls this to validate tool call args
 * const result = adapter["~standard"].validate({ prompt: 'hello' });
 * // Returns { value: { prompt: 'hello' } }
 * ```
 */
export class JsonSchemaStandardAdapter implements StandardSchemaWithJSON {
  private validator: ValidateFunction;
  private readonly schema: unknown;
  private readonly vendorId: string;

  /**
   * Creates a Standard Schema adapter for a JSON Schema.
   *
   * @param schema - JSON Schema (draft-07 or 2020-12)
   * @param vendor - Vendor identifier (default: 'bitbrat-json-schema')
   * @throws {Error} If schema is invalid or Ajv compilation fails
   */
  constructor(schema: unknown, vendor: string = 'bitbrat-json-schema') {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be a valid object');
    }

    this.schema = schema;
    this.vendorId = vendor;

    // Initialize Ajv with compatibility settings
    const ajv = new Ajv({
      strict: false,       // Allow draft-07 and 2020-12
      allErrors: true,     // Return all errors, not just first
      verbose: true,       // Include schema info in errors
      coerceTypes: false,  // Strict type checking (no auto-conversion)
    });

    // Add format validators (email, date, uri, ipv4, ipv6, etc.)
    addFormats(ajv);

    // Compile validator once at construction time
    try {
      this.validator = ajv.compile(schema);
    } catch (err) {
      throw new Error(
        `Failed to compile JSON Schema: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Standard Schema interface implementation.
   * This is what MCP SDK 2.0 uses to interact with the schema.
   */
  get "~standard"() {
    const schema = this.schema;
    const validator = this.validator;
    const vendorId = this.vendorId;

    return {
      version: 1 as const,
      vendor: vendorId,

      /**
       * Validates a value against the JSON Schema.
       *
       * @param value - Value to validate (e.g., LLM tool call arguments)
       * @returns Success with value, or failure with issues array
       */
      validate: (value: unknown) => {
        const valid = validator(value);

        if (valid) {
          return { value };
        }

        // Convert Ajv errors to Standard Schema issues
        const issues = (validator.errors || []).map((err: ErrorObject) => ({
          message: err.message || 'Validation failed',
          path: err.instancePath
            ? err.instancePath.split('/').filter(Boolean)
            : undefined,
        }));

        return { issues };
      },

      /**
       * Standard JSON Schema extension.
       * MCP SDK calls this to get JSON Schema for the wire protocol.
       */
      jsonSchema: {
        /**
         * Returns the input JSON Schema.
         * Optionally adds $schema field if target specified.
         *
         * @param options - Optional target version (draft-07, draft-2020-12)
         * @returns Original JSON Schema (no conversion)
         */
        input: (options?: { target?: string }) => {
          const schemaObj = schema as any;

          // Add $schema field if requested and not present
          if (options?.target && !schemaObj.$schema) {
            return {
              ...schemaObj,
              $schema:
                options.target === 'draft-07'
                  ? 'http://json-schema.org/draft-07/schema#'
                  : 'https://json-schema.org/draft/2020-12/schema',
            };
          }

          // Return original schema unchanged
          return schema;
        },

        /**
         * Returns the output JSON Schema.
         * For compositions, input and output schemas are the same.
         */
        output: (options?: { target?: string }) => {
          const schemaObj = schema as any;

          // Add $schema field if requested and not present
          if (options?.target && !schemaObj.$schema) {
            return {
              ...schemaObj,
              $schema:
                options.target === 'draft-07'
                  ? 'http://json-schema.org/draft-07/schema#'
                  : 'https://json-schema.org/draft/2020-12/schema',
            };
          }

          // Return original schema unchanged
          return schema;
        },
      },
    };
  }
}
