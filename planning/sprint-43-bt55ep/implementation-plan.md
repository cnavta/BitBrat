# Implementation Plan: Composition Schema Visibility Fix

**Sprint**: sprint-43-bt55ep
**Date**: 2026-09-05
**Status**: Ready for Approval
**Estimated Effort**: 12-15 hours (1.5-2 days)

---

## Executive Summary

This implementation plan executes the architectural decisions from `technical-architecture.md`. We'll create `JsonSchemaStandardAdapter` to bridge JSON Schema (composition format) and Standard Schema (MCP SDK requirement), enabling LLMs to see composition input parameters.

**Approach**: Option B - JSON Schema + Standard Schema Adapter
- Composition authors continue writing JSON Schema in YAML
- Adapter wraps JSON Schema at runtime (internal infrastructure)
- LLMs receive full parameter information via MCP protocol

**Dependencies**:
- `ajv@^8.12.0` - JSON Schema validator (12M+ weekly downloads)
- `ajv-formats@^2.1.1` - Format validators (email, date, uri, etc.)

---

## Phase 1: Foundation (3-5 hours)

### Task 1.1: Add Dependencies

**File**: `package.json`

**Changes**:
```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1"
  }
}
```

**Commands**:
```bash
npm install ajv@^8.12.0 ajv-formats@^2.1.1
```

**Acceptance Criteria**:
- [ ] Dependencies installed successfully
- [ ] No peer dependency conflicts
- [ ] `npm run build` succeeds

---

### Task 1.2: Create Standard Schema Adapter

**File**: `src/common/schemas/json-schema-standard-adapter.ts` (NEW)

**Implementation**:

```typescript
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
  readonly "~standard" = {
    version: 1 as const,

    /**
     * Vendor identifier for this adapter instance.
     */
    get vendor(): string {
      return this.vendorId;
    },

    /**
     * Validates a value against the JSON Schema.
     *
     * @param value - Value to validate (e.g., LLM tool call arguments)
     * @returns Success with value, or failure with issues array
     */
    validate: (value: unknown) => {
      const valid = this.validator(value);

      if (valid) {
        return { value };
      }

      // Convert Ajv errors to Standard Schema issues
      const issues = (this.validator.errors || []).map((err: ErrorObject) => ({
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
        const schema = this.schema as any;

        // Add $schema field if requested and not present
        if (options?.target && !schema.$schema) {
          return {
            ...schema,
            $schema:
              options.target === 'draft-07'
                ? 'http://json-schema.org/draft-07/schema#'
                : 'https://json-schema.org/draft/2020-12/schema',
          };
        }

        // Return original schema unchanged
        return this.schema;
      },

      /**
       * Returns the output JSON Schema.
       * For compositions, input and output schemas are the same.
       */
      output: (options?: { target?: string }) => {
        return this.jsonSchema.input(options);
      },
    },
  };
}
```

**Acceptance Criteria**:
- [ ] File compiles without TypeScript errors
- [ ] Implements `StandardSchemaWithJSON` interface correctly
- [ ] Constructor validates schema parameter
- [ ] Ajv compilation happens once at construction
- [ ] `validate()` method returns correct format
- [ ] `jsonSchema.input()` returns original schema
- [ ] JSDoc comments complete and accurate

---

### Task 1.3: Create Barrel Export

**File**: `src/common/schemas/index.ts` (NEW)

**Implementation**:
```typescript
/**
 * Schema utilities for BitBrat platform.
 *
 * This module provides adapters and utilities for working with schemas
 * across different formats and validation libraries.
 */

export {
  JsonSchemaStandardAdapter,
  StandardSchemaV1,
  StandardJSONSchemaV1,
  StandardSchemaWithJSON,
} from './json-schema-standard-adapter';
```

**Acceptance Criteria**:
- [ ] Exports all public types and classes
- [ ] File compiles without errors

---

### Task 1.4: Create Unit Tests

**File**: `src/common/schemas/json-schema-standard-adapter.test.ts` (NEW)

**Implementation**:

```typescript
import { JsonSchemaStandardAdapter } from './json-schema-standard-adapter';

describe('JsonSchemaStandardAdapter', () => {
  describe('Constructor', () => {
    it('creates adapter with valid schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      expect(() => {
        new JsonSchemaStandardAdapter(schema, 'test-vendor');
      }).not.toThrow();
    });

    it('throws on null schema', () => {
      expect(() => {
        new JsonSchemaStandardAdapter(null as any);
      }).toThrow('Schema must be a valid object');
    });

    it('throws on undefined schema', () => {
      expect(() => {
        new JsonSchemaStandardAdapter(undefined as any);
      }).toThrow('Schema must be a valid object');
    });

    it('throws on primitive schema', () => {
      expect(() => {
        new JsonSchemaStandardAdapter('not an object' as any);
      }).toThrow('Schema must be a valid object');
    });

    it('throws on invalid JSON Schema', () => {
      const invalidSchema = {
        type: 'invalid-type',
      };

      expect(() => {
        new JsonSchemaStandardAdapter(invalidSchema);
      }).toThrow('Failed to compile JSON Schema');
    });
  });

  describe('Standard Schema Interface', () => {
    it('implements version 1', () => {
      const adapter = new JsonSchemaStandardAdapter({ type: 'object' });
      expect(adapter["~standard"].version).toBe(1);
    });

    it('has vendor property', () => {
      const adapter = new JsonSchemaStandardAdapter(
        { type: 'object' },
        'custom-vendor'
      );
      expect(adapter["~standard"].vendor).toBe('custom-vendor');
    });

    it('defaults vendor to bitbrat-json-schema', () => {
      const adapter = new JsonSchemaStandardAdapter({ type: 'object' });
      expect(adapter["~standard"].vendor).toBe('bitbrat-json-schema');
    });

    it('has validate function', () => {
      const adapter = new JsonSchemaStandardAdapter({ type: 'object' });
      expect(typeof adapter["~standard"].validate).toBe('function');
    });

    it('has jsonSchema object', () => {
      const adapter = new JsonSchemaStandardAdapter({ type: 'object' });
      expect(typeof adapter["~standard"].jsonSchema).toBe('object');
    });

    it('has jsonSchema.input function', () => {
      const adapter = new JsonSchemaStandardAdapter({ type: 'object' });
      expect(typeof adapter["~standard"].jsonSchema.input).toBe('function');
    });

    it('has jsonSchema.output function', () => {
      const adapter = new JsonSchemaStandardAdapter({ type: 'object' });
      expect(typeof adapter["~standard"].jsonSchema.output).toBe('function');
    });
  });

  describe('Validation', () => {
    it('validates valid input', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].validate({ name: 'Alice' });

      expect(result).toEqual({ value: { name: 'Alice' } });
      expect(result.issues).toBeUndefined();
    });

    it('rejects invalid input', () => {
      const schema = {
        type: 'object',
        properties: {
          age: { type: 'number' },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].validate({ age: 'not-a-number' });

      expect(result.value).toBeUndefined();
      expect(result.issues).toBeDefined();
      expect(result.issues!.length).toBeGreaterThan(0);
      expect(result.issues![0].message).toContain('number');
    });

    it('handles required fields', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const adapter = new JsonSchemaStandardAdapter(schema);

      // Valid: has required field
      const validResult = adapter["~standard"].validate({ name: 'Alice' });
      expect(validResult.value).toEqual({ name: 'Alice' });

      // Invalid: missing required field
      const invalidResult = adapter["~standard"].validate({});
      expect(invalidResult.issues).toBeDefined();
      expect(invalidResult.issues!.length).toBeGreaterThan(0);
    });

    it('handles enums', () => {
      const schema = {
        type: 'object',
        properties: {
          size: {
            type: 'string',
            enum: ['small', 'medium', 'large'],
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);

      // Valid: enum value
      const validResult = adapter["~standard"].validate({ size: 'medium' });
      expect(validResult.value).toEqual({ size: 'medium' });

      // Invalid: not in enum
      const invalidResult = adapter["~standard"].validate({ size: 'xlarge' });
      expect(invalidResult.issues).toBeDefined();
    });

    it('handles nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
            },
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].validate({
        config: { enabled: true },
      });

      expect(result.value).toEqual({ config: { enabled: true } });
    });

    it('handles arrays', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);

      // Valid: string array
      const validResult = adapter["~standard"].validate({ tags: ['a', 'b'] });
      expect(validResult.value).toEqual({ tags: ['a', 'b'] });

      // Invalid: wrong item type
      const invalidResult = adapter["~standard"].validate({ tags: [1, 2] });
      expect(invalidResult.issues).toBeDefined();
    });

    it('handles number constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          age: {
            type: 'number',
            minimum: 0,
            maximum: 120,
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);

      // Valid: within range
      expect(adapter["~standard"].validate({ age: 25 }).value).toBeDefined();

      // Invalid: below minimum
      expect(adapter["~standard"].validate({ age: -1 }).issues).toBeDefined();

      // Invalid: above maximum
      expect(adapter["~standard"].validate({ age: 150 }).issues).toBeDefined();
    });

    it('handles string patterns', () => {
      const schema = {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            pattern: '^[A-Z]{3}$',
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);

      // Valid: matches pattern
      expect(adapter["~standard"].validate({ code: 'ABC' }).value).toBeDefined();

      // Invalid: doesn't match
      expect(adapter["~standard"].validate({ code: 'abc' }).issues).toBeDefined();
    });

    it('handles format validators', () => {
      const schema = {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);

      // Valid: email format
      expect(
        adapter["~standard"].validate({ email: 'test@example.com' }).value
      ).toBeDefined();

      // Invalid: not email format
      expect(
        adapter["~standard"].validate({ email: 'not-an-email' }).issues
      ).toBeDefined();
    });

    it('includes path in validation errors', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              age: { type: 'number' },
            },
          },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].validate({
        user: { age: 'invalid' },
      });

      expect(result.issues).toBeDefined();
      expect(result.issues![0].path).toContain('user');
      expect(result.issues![0].path).toContain('age');
    });
  });

  describe('JSON Schema Passthrough', () => {
    it('returns original schema via input()', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].jsonSchema.input();

      expect(result).toEqual(schema);
    });

    it('returns original schema via output()', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const inputSchema = adapter["~standard"].jsonSchema.input();
      const outputSchema = adapter["~standard"].jsonSchema.output();

      expect(outputSchema).toEqual(inputSchema);
      expect(outputSchema).toEqual(schema);
    });

    it('preserves existing $schema field', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].jsonSchema.input();

      expect(result).toEqual(schema);
      expect((result as any).$schema).toBe(
        'http://json-schema.org/draft-07/schema#'
      );
    });

    it('adds $schema field when target specified (draft-07)', () => {
      const schema = { type: 'object' };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].jsonSchema.input({
        target: 'draft-07',
      });

      expect((result as any).$schema).toBe(
        'http://json-schema.org/draft-07/schema#'
      );
    });

    it('adds $schema field when target specified (draft-2020-12)', () => {
      const schema = { type: 'object' };

      const adapter = new JsonSchemaStandardAdapter(schema);
      const result = adapter["~standard"].jsonSchema.input({
        target: 'draft-2020-12',
      });

      expect((result as any).$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema'
      );
    });

    it('does not modify original schema object', () => {
      const schema = { type: 'object' };
      const originalSchema = JSON.parse(JSON.stringify(schema));

      const adapter = new JsonSchemaStandardAdapter(schema);
      adapter["~standard"].jsonSchema.input({ target: 'draft-2020-12' });

      // Original schema should be unchanged
      expect(schema).toEqual(originalSchema);
      expect(schema).not.toHaveProperty('$schema');
    });
  });

  describe('Complex Schemas', () => {
    it('handles grockle composition schema', () => {
      const grockleSchema = {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt for image generation',
          },
          style: {
            type: 'string',
            enum: ['realistic', 'cartoon', 'abstract'],
            description: 'Art style',
          },
          size: {
            type: 'string',
            enum: ['256x256', '512x512', '1024x1024'],
            default: '512x512',
          },
        },
        required: ['prompt'],
      };

      const adapter = new JsonSchemaStandardAdapter(
        grockleSchema,
        'bitbrat-composition-grockle'
      );

      // Valid input
      const validResult = adapter["~standard"].validate({
        prompt: 'sunset over mountains',
        style: 'realistic',
        size: '1024x1024',
      });
      expect(validResult.value).toBeDefined();

      // Missing required field
      const missingResult = adapter["~standard"].validate({ style: 'cartoon' });
      expect(missingResult.issues).toBeDefined();

      // Invalid enum value
      const invalidEnumResult = adapter["~standard"].validate({
        prompt: 'test',
        style: 'invalid-style',
      });
      expect(invalidEnumResult.issues).toBeDefined();

      // Schema passthrough
      const returnedSchema = adapter["~standard"].jsonSchema.input();
      expect(returnedSchema).toEqual(grockleSchema);
    });
  });
});
```

**Acceptance Criteria**:
- [ ] All tests pass (`npm test`)
- [ ] Code coverage >95% for adapter
- [ ] Tests cover: validation, passthrough, errors, edge cases
- [ ] Tests validate Standard Schema interface compliance
- [ ] Tests include real-world composition schema (grockle)

---

### Task 1.5: Verify Foundation

**Commands**:
```bash
npm run build
npm test -- json-schema-standard-adapter.test.ts
```

**Acceptance Criteria**:
- [ ] TypeScript compiles without errors
- [ ] All unit tests pass (100%)
- [ ] No new linting errors
- [ ] Adapter ready for integration

---

## Phase 2: Integration (3-4 hours)

### Task 2.1: Integrate with Tool Gateway

**File**: `src/apps/tool-gateway.ts`

**Changes**:

```typescript
// Add import at top of file
import { JsonSchemaStandardAdapter } from '../common/schemas/json-schema-standard-adapter';
import { z } from 'zod';

// Add new helper method (private, after executeComposition)
/**
 * Wraps a JSON Schema in a Standard Schema adapter for MCP registration.
 *
 * @param jsonSchema - JSON Schema from composition spec
 * @param toolId - Composition tool ID (for logging and vendor string)
 * @returns Standard Schema adapter or z.any() fallback
 */
private wrapJsonSchemaWithAdapter(
  jsonSchema: any,
  toolId: string
): any {
  // No schema provided - use z.any()
  if (!jsonSchema) {
    this.logger.debug('composition.schema.missing', { toolId });
    return z.any();
  }

  const startTime = Date.now();

  try {
    // Create Standard Schema adapter
    const adapter = new JsonSchemaStandardAdapter(
      jsonSchema,
      `bitbrat-composition-${toolId}`
    );

    const durationMs = Date.now() - startTime;

    this.logger.debug('composition.schema.wrapped', {
      toolId,
      vendor: adapter["~standard"].vendor,
      hasValidation: typeof adapter["~standard"].validate === 'function',
      hasJsonSchema: typeof adapter["~standard"].jsonSchema === 'object',
      durationMs,
    });

    return adapter;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;

    this.logger.warn('composition.schema.wrap_failed', {
      toolId,
      error: err.message,
      fallback: 'z.any()',
      durationMs,
    });

    // Fail-open: Use z.any() so composition remains usable
    return z.any();
  }
}

// Modify existing registerCompositionTool method
private async registerCompositionTool(composition: any): Promise<void> {
  const toolId = composition.metadata.name;
  const description =
    composition.metadata.description || `Composition: ${toolId}`;
  const jsonSchema = composition.spec.inputSchema;

  try {
    // 1. Register in ToolRegistry (unchanged - uses JSON Schema)
    this.registry.registerTool({
      id: toolId,
      displayName: toolId,
      description,
      inputSchema: jsonSchema,
      source: 'composition',
      execute: async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      },
    });

    // 2. Wrap JSON Schema for MCP registration (NEW)
    const standardSchema = this.wrapJsonSchemaWithAdapter(jsonSchema, toolId);

    // 3. Register via Bit MCP interface (modified - uses adapter)
    this.registerTool(
      toolId,
      description,
      standardSchema,
      async (args: unknown, extra?: any) => {
        return await this.executeComposition(composition, args, extra);
      }
    );

    this.logger.debug('tool_gateway.composition.registered', {
      toolId,
      version: composition.metadata.version,
      hasStandardSchema: standardSchema !== z.any(),
    });
  } catch (err) {
    this.logger.error('tool_gateway.composition.registration_failed', {
      toolId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

**Acceptance Criteria**:
- [ ] Import added without errors
- [ ] `wrapJsonSchemaWithAdapter()` method compiles
- [ ] `registerCompositionTool()` modified correctly
- [ ] No changes to `executeComposition()` (validation unchanged)
- [ ] TypeScript build succeeds
- [ ] Existing tool-gateway tests still pass

---

### Task 2.2: Add Integration Tests

**File**: `src/apps/tool-gateway.test.ts`

**Add test suite**:

```typescript
describe('Composition Schema Visibility (Sprint 43)', () => {
  describe('wrapJsonSchemaWithAdapter', () => {
    it('wraps valid JSON Schema in adapter', () => {
      const gateway = new ToolGateway();
      const jsonSchema = {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
        },
        required: ['prompt'],
      };

      const result = gateway['wrapJsonSchemaWithAdapter'](jsonSchema, 'test-tool');

      // Should not be z.any()
      expect(result).not.toBe(z.any());

      // Should have Standard Schema interface
      expect(result).toHaveProperty('~standard');
      expect(result["~standard"].version).toBe(1);
      expect(result["~standard"].vendor).toBe('bitbrat-composition-test-tool');
    });

    it('returns z.any() when no schema provided', () => {
      const gateway = new ToolGateway();
      const result = gateway['wrapJsonSchemaWithAdapter'](undefined, 'test-tool');

      expect(result).toBe(z.any());
    });

    it('returns z.any() on invalid schema (fail-open)', () => {
      const gateway = new ToolGateway();
      const invalidSchema = { type: 'invalid-type' };

      const result = gateway['wrapJsonSchemaWithAdapter'](invalidSchema, 'test-tool');

      // Should fail-open to z.any()
      expect(result).toBe(z.any());
    });

    it('logs debug on successful wrapping', () => {
      const gateway = new ToolGateway();
      const loggerSpy = jest.spyOn(gateway['logger'], 'debug');

      const jsonSchema = { type: 'object' };
      gateway['wrapJsonSchemaWithAdapter'](jsonSchema, 'test-tool');

      expect(loggerSpy).toHaveBeenCalledWith(
        'composition.schema.wrapped',
        expect.objectContaining({
          toolId: 'test-tool',
          vendor: 'bitbrat-composition-test-tool',
        })
      );
    });

    it('logs warning on wrapping failure', () => {
      const gateway = new ToolGateway();
      const loggerSpy = jest.spyOn(gateway['logger'], 'warn');

      const invalidSchema = { type: 'invalid-type' };
      gateway['wrapJsonSchemaWithAdapter'](invalidSchema, 'test-tool');

      expect(loggerSpy).toHaveBeenCalledWith(
        'composition.schema.wrap_failed',
        expect.objectContaining({
          toolId: 'test-tool',
          fallback: 'z.any()',
        })
      );
    });
  });

  describe('registerCompositionTool with Standard Schema', () => {
    it('registers composition with wrapped schema', async () => {
      const gateway = new ToolGateway();
      await gateway.setup();

      const composition = {
        metadata: {
          name: 'test-comp',
          version: 1,
          description: 'Test composition',
        },
        spec: {
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          steps: [],
        },
      };

      await gateway['registerCompositionTool'](composition);

      // Verify tool registered in ToolRegistry
      const tool = gateway['registry'].getTool('test-comp');
      expect(tool).toBeDefined();
      expect(tool?.id).toBe('test-comp');

      // Verify tool registered in MCP server
      const mcpTools = await gateway['server'].listTools();
      const mcpTool = mcpTools.find((t) => t.name === 'test-comp');
      expect(mcpTool).toBeDefined();
    });

    it('registers composition without schema (z.any() fallback)', async () => {
      const gateway = new ToolGateway();
      await gateway.setup();

      const composition = {
        metadata: { name: 'no-schema', version: 1 },
        spec: { steps: [] },
      };

      await gateway['registerCompositionTool'](composition);

      // Should still register successfully
      const tool = gateway['registry'].getTool('no-schema');
      expect(tool).toBeDefined();
    });

    it('logs success with hasStandardSchema flag', async () => {
      const gateway = new ToolGateway();
      await gateway.setup();
      const loggerSpy = jest.spyOn(gateway['logger'], 'debug');

      const composition = {
        metadata: { name: 'with-schema', version: 1 },
        spec: {
          inputSchema: { type: 'object' },
          steps: [],
        },
      };

      await gateway['registerCompositionTool'](composition);

      expect(loggerSpy).toHaveBeenCalledWith(
        'tool_gateway.composition.registered',
        expect.objectContaining({
          toolId: 'with-schema',
          hasStandardSchema: true,
        })
      );
    });
  });
});
```

**Acceptance Criteria**:
- [ ] All integration tests pass
- [ ] Tests verify adapter wrapping
- [ ] Tests verify MCP registration
- [ ] Tests verify fail-open behavior
- [ ] Tests verify logging

---

### Task 2.3: Update Package Lock

**Commands**:
```bash
npm install  # Update package-lock.json with new dependencies
```

**Acceptance Criteria**:
- [ ] `package-lock.json` updated
- [ ] No dependency conflicts
- [ ] Clean `npm audit` (or document known issues)

---

## Phase 3: Testing & Validation (2-3 hours)

### Task 3.1: Run Full Test Suite

**Commands**:
```bash
npm run build
npm test
npm run lint
```

**Acceptance Criteria**:
- [ ] All tests pass (no regressions)
- [ ] New tests pass (adapter + integration)
- [ ] No new linting errors
- [ ] TypeScript compilation clean

---

### Task 3.2: Agent-Dev Validation

**Test Plan**:

```bash
# 1. Provision agent-dev context
agent_dev.provision({ name: "agent-dev-sprint43-validation" })

# 2. Deploy tool-gateway with adapter
npm run brat -- bit deploy tool-gateway --context agent-dev-sprint43-validation

# 3. Verify service starts
fleet.info({ bit: "tool-gateway", context: "agent-dev-sprint43-validation" })

# 4. Register test composition with complex schema
# (Via tool-gateway MCP tools or database insert)

# 5. Check tool-gateway logs for schema wrapping
fleet.logs({
  bit: "tool-gateway",
  context: "agent-dev-sprint43-validation",
  limit: 50
})
# Look for: "composition.schema.wrapped" debug logs

# 6. Deploy llm-bot
npm run brat -- bit deploy llm-bot --context agent-dev-sprint43-validation

# 7. Check llm-bot discovers composition tools
fleet.logs({
  bit: "llm-bot",
  context: "agent-dev-sprint43-validation",
  limit: 50
})
# Look for: "tools_discovered" with composition tools in toolNames array

# 8. Send test message using composition
message.send({
  context: "agent-dev-sprint43-validation",
  text: "@bitbrat use [composition-name]",
  waitForResponse: true
})

# 9. Verify LLM called composition with correct parameters
# (Check trace or logs for tool call)

# 10. Clean up
agent_dev.destroy({ name: "agent-dev-sprint43-validation", confirm: true })
```

**Acceptance Criteria**:
- [ ] Tool-gateway starts without errors
- [ ] Adapter wrapping succeeds (debug logs confirm)
- [ ] LLM-bot discovers composition tools
- [ ] LLM can see composition schemas (not z.any())
- [ ] LLM makes tool calls with correct parameters
- [ ] No crashes or errors in logs

---

### Task 3.3: Create Validation Script

**File**: `planning/sprint-43-bt55ep/validate_deliverable.sh` (NEW)

**Implementation**:

```bash
#!/bin/bash
set -e

echo "=== Sprint 43 Validation Script ==="
echo ""

# Phase 1: Unit Tests
echo "Phase 1: Running unit tests..."
npm test -- json-schema-standard-adapter.test.ts
echo "✅ Unit tests passed"
echo ""

# Phase 2: Integration Tests
echo "Phase 2: Running integration tests..."
npm test -- tool-gateway.test.ts
echo "✅ Integration tests passed"
echo ""

# Phase 3: Build Verification
echo "Phase 3: Verifying TypeScript build..."
npm run build
echo "✅ Build successful"
echo ""

# Phase 4: Lint Check
echo "Phase 4: Running linter..."
npm run lint
echo "✅ Lint check passed"
echo ""

# Phase 5: Dependency Check
echo "Phase 5: Checking dependencies..."
if grep -q '"ajv"' package.json; then
  echo "✅ Ajv dependency present"
else
  echo "❌ Ajv dependency missing"
  exit 1
fi

if grep -q '"ajv-formats"' package.json; then
  echo "✅ ajv-formats dependency present"
else
  echo "❌ ajv-formats dependency missing"
  exit 1
fi
echo ""

# Phase 6: File Check
echo "Phase 6: Verifying created files..."
FILES=(
  "src/common/schemas/json-schema-standard-adapter.ts"
  "src/common/schemas/json-schema-standard-adapter.test.ts"
  "src/common/schemas/index.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file exists"
  else
    echo "❌ $file missing"
    exit 1
  fi
done
echo ""

echo "=== All validation checks passed! ==="
```

**Make executable**:
```bash
chmod +x planning/sprint-43-bt55ep/validate_deliverable.sh
```

**Acceptance Criteria**:
- [ ] Script runs without errors
- [ ] All checks pass
- [ ] Can be run in CI/CD pipeline

---

## Phase 4: Deployment & Monitoring (1-2 hours)

### Task 4.1: Documentation Updates

**File 1**: `documentation/guides/compositions.md`

**Add section** (after existing content):

```markdown
## Input Schema Format

Compositions use **JSON Schema 2020-12** to define input parameters. This schema is visible to LLMs when they discover your composition as a tool.

### Simple Schema Example

```yaml
spec:
  inputSchema:
    type: object
    properties:
      prompt:
        type: string
        description: Text prompt for the operation
      temperature:
        type: number
        minimum: 0
        maximum: 1
        default: 0.7
    required:
      - prompt
```

When an LLM sees this composition, it knows:
- `prompt` is **required** and must be a string
- `temperature` is **optional** and defaults to 0.7
- `temperature` must be between 0 and 1

### Best Practices

1. **Keep schemas simple**: Flat objects work best for LLMs
2. **Use descriptions**: Help LLMs understand parameter purpose
3. **Provide defaults**: Make optional parameters truly optional
4. **Use enums**: Constrain choices for better LLM accuracy
5. **Validate types**: Always specify `type` for properties

### Advanced Features

See `documentation/reference/composition-schema.md` for:
- Nested objects and arrays
- Conditional schemas
- Format validators (email, uri, date)
- Pattern matching with regex
```

**File 2**: `CHANGELOG.md`

**Add entry**:

```markdown
## [0.41.0] - 2026-09-06

### Added
- **Composition Schema Visibility**: LLMs can now see composition input schemas
  - Implemented `JsonSchemaStandardAdapter` for JSON Schema → Standard Schema conversion
  - Compositions with JSON Schema now properly expose parameters to LLMs
  - Added comprehensive unit and integration tests
  - Dependencies: `ajv@^8.12.0`, `ajv-formats@^2.1.1`

### Fixed
- **Issue**: LLMs reported "tool has no input defined" for compositions
  - Root cause: MCP SDK 2.0 requires Standard Schema interface
  - Solution: Wrap JSON Schema in Standard Schema adapter using Ajv
  - Fallback: Fail-open to `z.any()` for invalid schemas

### Changed
- `tool-gateway`: Enhanced composition registration with schema adapter
  - New method: `wrapJsonSchemaWithAdapter()`
  - Fail-open strategy preserves backward compatibility

### Performance
- Adapter creation: ~3-5ms per composition (one-time cost)
- Validation: ~0.1-0.5ms per tool call (unchanged from current)
- Memory: ~40KB per composition (acceptable for schema visibility)

### Migration
- **No breaking changes**: Fully backward compatible
- Existing compositions work without modification
- Invalid schemas automatically fall back to current behavior (z.any())
```

**Acceptance Criteria**:
- [ ] Documentation updated
- [ ] CHANGELOG entry added
- [ ] Examples clear and accurate
- [ ] Best practices documented

---

### Task 4.2: Commit Sprint Artifacts

**Commands**:
```bash
git add .
git commit -m "feat(sprint-43): Implement composition schema visibility

Implements JsonSchemaStandardAdapter to expose composition input schemas
to LLMs via MCP SDK 2.0, enabling proper parameter discovery.

Changes:
- Add JsonSchemaStandardAdapter (Standard Schema interface)
- Integrate adapter with tool-gateway composition registration
- Add comprehensive unit and integration tests
- Add dependencies: ajv@^8.12.0, ajv-formats@^2.1.1

Sprint: sprint-43-bt55ep
Phase: Implementation complete

🤖 Generated with Claude Code"
```

**Acceptance Criteria**:
- [ ] All changes committed
- [ ] Commit message follows convention
- [ ] Sprint artifacts included

---

### Task 4.3: Update Sprint Status

**Command**:
```bash
mcp__sprint-mcp-local__update-sprint-status({
  sprintId: "sprint-43-bt55ep",
  status: "validating"
})
```

**Acceptance Criteria**:
- [ ] Sprint status updated
- [ ] Manifest updated
- [ ] Index updated

---

## Success Criteria Summary

### Functional Requirements
- [ ] **FR-1**: LLMs see composition schemas in `tools_discovered`
- [ ] **FR-2**: Adapter wrapping succeeds >99% of time
- [ ] **FR-3**: Validation consistency between adapter and executor
- [ ] **FR-4**: Fail-open for invalid schemas (z.any() fallback)
- [ ] **FR-5**: No regressions in existing composition execution

### Non-Functional Requirements
- [ ] **NFR-1**: Adapter creation latency P95 <5ms
- [ ] **NFR-2**: Memory overhead <50KB per composition
- [ ] **NFR-3**: Zero crashes related to adapter
- [ ] **NFR-4**: 100% backward compatible
- [ ] **NFR-5**: Documentation complete

### Test Coverage
- [ ] Unit test coverage >95% for adapter
- [ ] Integration tests verify MCP registration
- [ ] End-to-end validation in agent-dev
- [ ] All existing tests still pass

---

## Rollback Plan

**Trigger Conditions**:
- Adapter wrapping success rate <95%
- Tool-gateway memory usage increases >20%
- Composition execution errors increase >10%
- Any crashes related to adapter

**Rollback Steps**:
1. Revert tool-gateway changes (keep adapter code for future use)
2. Change `registerCompositionTool()` back to `z.any()`
3. Redeploy tool-gateway
4. Verify behavior returns to baseline
5. Investigate root cause
6. Fix and re-validate in agent-dev before retry

---

## Timeline

| Phase | Tasks | Estimated Time | Cumulative |
|-------|-------|----------------|------------|
| Phase 1: Foundation | 1.1-1.5 | 3-5 hours | 3-5 hours |
| Phase 2: Integration | 2.1-2.3 | 3-4 hours | 6-9 hours |
| Phase 3: Testing | 3.1-3.3 | 2-3 hours | 8-12 hours |
| Phase 4: Deployment | 4.1-4.3 | 1-2 hours | 9-14 hours |

**Total**: 9-14 hours (conservative estimate with buffer)

---

## Dependencies

**External**:
- `ajv@^8.12.0` (JSON Schema validator)
- `ajv-formats@^2.1.1` (Format validators)

**Internal**:
- No changes to Bit base class required
- No changes to CompositionExecutor required
- No changes to database schema required

**Blockers**:
- None identified

---

## Next Steps After Approval

1. User reviews and approves this plan
2. Update sprint status to `in-progress`
3. Execute Phase 1 (Foundation)
4. Execute Phase 2 (Integration)
5. Execute Phase 3 (Testing & Validation)
6. Execute Phase 4 (Deployment & Documentation)
7. Create PR for review
8. Complete sprint

---

**Status**: ✅ Ready for user approval
**Architect Approval**: ✅ Approved (see technical-architecture.md)
**Implementation Ready**: ✅ All tasks defined with clear acceptance criteria
