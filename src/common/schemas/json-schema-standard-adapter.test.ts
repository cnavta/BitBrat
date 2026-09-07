import { JsonSchemaStandardAdapter } from './json-schema-standard-adapter';

describe('JsonSchemaStandardAdapter', () => {
  describe('Constructor (TASK-005)', () => {
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
        type: 'invalid-type' as any,
      };

      expect(() => {
        new JsonSchemaStandardAdapter(invalidSchema);
      }).toThrow('Failed to compile JSON Schema');
    });

    it('uses custom vendor string', () => {
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
  });

  describe('Standard Schema Interface (TASK-006)', () => {
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

  describe('Validation Logic (TASK-007)', () => {
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

  describe('JSON Schema Passthrough (TASK-008)', () => {
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

  describe('Complex Schema - Grockle (TASK-009)', () => {
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

    it('handles grockle composition schema - valid input', () => {
      const adapter = new JsonSchemaStandardAdapter(
        grockleSchema,
        'bitbrat-composition-grockle'
      );

      const validResult = adapter["~standard"].validate({
        prompt: 'sunset over mountains',
        style: 'realistic',
        size: '1024x1024',
      });

      expect(validResult.value).toBeDefined();
      expect(validResult.issues).toBeUndefined();
    });

    it('handles grockle composition schema - missing required field', () => {
      const adapter = new JsonSchemaStandardAdapter(
        grockleSchema,
        'bitbrat-composition-grockle'
      );

      const missingResult = adapter["~standard"].validate({ style: 'cartoon' });

      expect(missingResult.issues).toBeDefined();
      expect(missingResult.issues!.length).toBeGreaterThan(0);
      expect(
        missingResult.issues!.some((issue) => issue.message?.includes('required'))
      ).toBe(true);
    });

    it('handles grockle composition schema - invalid enum value', () => {
      const adapter = new JsonSchemaStandardAdapter(
        grockleSchema,
        'bitbrat-composition-grockle'
      );

      const invalidEnumResult = adapter["~standard"].validate({
        prompt: 'test',
        style: 'invalid-style',
      });

      expect(invalidEnumResult.issues).toBeDefined();
      expect(invalidEnumResult.issues!.length).toBeGreaterThan(0);
    });

    it('handles grockle composition schema - schema passthrough', () => {
      const adapter = new JsonSchemaStandardAdapter(
        grockleSchema,
        'bitbrat-composition-grockle'
      );

      const returnedSchema = adapter["~standard"].jsonSchema.input();

      expect(returnedSchema).toEqual(grockleSchema);
    });
  });
});
