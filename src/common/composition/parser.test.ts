/**
 * Composition Parser Unit Tests
 *
 * Tests for CompositionParser covering:
 * - Valid YAML parsing (3 tests)
 * - Valid JSON parsing (2 tests)
 * - Reference canonicalization (4 tests)
 * - Invalid structure errors (3 tests)
 * - Edge cases (3 tests)
 *
 * @module composition/parser.test
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CompositionParser } from './parser';
import { CompositionDefinition, isReference, CompositionErrorCode } from './types';

describe('CompositionParser', () => {
  let parser: CompositionParser;

  beforeEach(() => {
    parser = new CompositionParser();
  });

  // ==========================================================================
  // Valid YAML Parsing (3 tests)
  // ==========================================================================

  describe('YAML parsing', () => {
    test('parses minimal valid YAML composition', () => {
      const yaml = readFileSync(
        join(__dirname, '__tests__/fixtures/valid-minimal.yaml'),
        'utf-8'
      );

      const result = parser.parse(yaml);

      expect(result.apiVersion).toBe('mcp-compose/v1');
      expect(result.kind).toBe('Composition');
      expect(result.metadata.name).toBe('minimal_example');
      expect(result.spec.steps).toHaveLength(1);
      expect(result.spec.steps[0].id).toBe('echo');
    });

    test('parses full-featured YAML composition with all fields', () => {
      const yaml = readFileSync(
        join(__dirname, '__tests__/fixtures/valid-full-featured.yaml'),
        'utf-8'
      );

      const result = parser.parse(yaml);

      expect(result.metadata.name).toBe('viewer_greeting');
      expect(result.metadata.description).toBeDefined();
      expect(result.metadata.labels).toBeDefined();
      expect(result.metadata.annotations).toBeDefined();
      expect(result.spec.contextSchema).toBeDefined();
      expect(result.spec.outputSchema).toBeDefined();
      expect(result.spec.steps).toHaveLength(4);
    });

    test('parses YAML with nested objects and arrays', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: nested_example
spec:
  inputSchema:
    type: object
  steps:
    - id: test
      call: test.tool
      with:
        nested:
          deep:
            value: $input/data
        array: [1, 2, 3]
  return:
    nested:
      result: $steps/test/output
    array: [$steps/test/a, $steps/test/b]
      `;

      const result = parser.parse(yaml);

      expect(result.metadata.name).toBe('nested_example');

      // Check nested object in step.with
      const step = result.spec.steps[0] as any;
      expect(step.with.nested).toBeDefined();
      expect(step.with.array).toEqual([1, 2, 3]);

      // Check nested object in return
      expect(result.spec.return).toHaveProperty('nested');
      expect(result.spec.return).toHaveProperty('array');
    });
  });

  // ==========================================================================
  // Valid JSON Parsing (2 tests)
  // ==========================================================================

  describe('JSON parsing', () => {
    test('parses valid JSON composition', () => {
      const json = readFileSync(
        join(__dirname, '__tests__/fixtures/valid-basic.json'),
        'utf-8'
      );

      const result = parser.parse(json);

      expect(result.apiVersion).toBe('mcp-compose/v1');
      expect(result.kind).toBe('Composition');
      expect(result.metadata.name).toBe('json_example');
      expect(result.spec.steps).toHaveLength(1);
    });

    test('parses object directly (pre-parsed JSON)', () => {
      const obj = {
        apiVersion: 'mcp-compose/v1',
        kind: 'Composition',
        metadata: {
          name: 'object_example',
        },
        spec: {
          inputSchema: { type: 'object' },
          steps: [
            {
              id: 'test',
              call: 'test.tool',
            },
          ],
          return: { success: true },
        },
      };

      const result = parser.parse(obj);

      expect(result.metadata.name).toBe('object_example');
    });
  });

  // ==========================================================================
  // Reference Canonicalization (4 tests)
  // ==========================================================================

  describe('Reference canonicalization', () => {
    test('canonicalizes $input references', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: input_ref_test
spec:
  inputSchema:
    type: object
  steps:
    - id: test
      call: test.tool
      with:
        value: $input/user_id
  return:
    input: $input/name
      `;

      const result = parser.parse(yaml);

      // Check step.with reference
      const step = result.spec.steps[0] as any;
      expect(isReference(step.with.value)).toBe(true);
      expect(step.with.value.$ref.namespace).toBe('input');
      expect(step.with.value.$ref.pointer).toBe('/user_id');

      // Check return reference
      const returnExpr = result.spec.return as any;
      expect(isReference(returnExpr.input)).toBe(true);
      expect(returnExpr.input.$ref.namespace).toBe('input');
      expect(returnExpr.input.$ref.pointer).toBe('/name');
    });

    test('canonicalizes $context references', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: context_ref_test
spec:
  inputSchema:
    type: object
  steps:
    - id: test
      call: test.tool
      with:
        channel: $context/channel_id
  return:
    context: $context/user
      `;

      const result = parser.parse(yaml);

      const step = result.spec.steps[0] as any;
      expect(step.with.channel.$ref.namespace).toBe('context');
      expect(step.with.channel.$ref.pointer).toBe('/channel_id');
    });

    test('canonicalizes $steps references', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: steps_ref_test
spec:
  inputSchema:
    type: object
  steps:
    - id: first
      call: test.tool1
    - id: second
      call: test.tool2
      with:
        value: $steps/first/output
  return:
    result: $steps/second/data
      `;

      const result = parser.parse(yaml);

      const step = result.spec.steps[1] as any;
      expect(step.with.value.$ref.namespace).toBe('steps');
      expect(step.with.value.$ref.pointer).toBe('/first/output');

      const returnExpr = result.spec.return as any;
      expect(returnExpr.result.$ref.namespace).toBe('steps');
      expect(returnExpr.result.$ref.pointer).toBe('/second/data');
    });

    test('canonicalizes nested path references', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: nested_ref_test
spec:
  inputSchema:
    type: object
  steps:
    - id: test
      call: test.tool
  return:
    deep: $steps/test/nested/deep/value
      `;

      const result = parser.parse(yaml);

      const returnExpr = result.spec.return as any;
      expect(returnExpr.deep.$ref.namespace).toBe('steps');
      expect(returnExpr.deep.$ref.pointer).toBe('/test/nested/deep/value');
    });
  });

  // ==========================================================================
  // Invalid Structure Errors (3 tests)
  // ==========================================================================

  describe('Invalid structure errors', () => {
    test('throws on invalid apiVersion', () => {
      const yaml = `
apiVersion: invalid-version
kind: Composition
metadata:
  name: test
spec:
  inputSchema: {}
  steps: []
  return: {}
      `;

      expect(() => parser.parse(yaml)).toThrow(/Invalid apiVersion/);
      expect(() => parser.parse(yaml)).toThrow(CompositionErrorCode.INVALID_FORMAT);
    });

    test('throws on invalid kind', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: InvalidKind
metadata:
  name: test
spec:
  inputSchema: {}
  steps: []
  return: {}
      `;

      expect(() => parser.parse(yaml)).toThrow(/Invalid kind/);
      expect(() => parser.parse(yaml)).toThrow(CompositionErrorCode.INVALID_FORMAT);
    });

    test('throws on missing metadata.name', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  description: Missing name field
spec:
  inputSchema: {}
  steps: []
  return: {}
      `;

      expect(() => parser.parse(yaml)).toThrow(/Missing required field: metadata.name/);
      expect(() => parser.parse(yaml)).toThrow(CompositionErrorCode.INVALID_FORMAT);
    });
  });

  // ==========================================================================
  // Edge Cases (3 tests)
  // ==========================================================================

  describe('Edge cases', () => {
    test('throws on malformed YAML', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
  metadata:  # Wrong indentation
    name: test
      `;

      expect(() => parser.parse(yaml)).toThrow(/Failed to parse composition/);
    });

    test('throws on invalid reference format', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: test
spec:
  inputSchema: {}
  steps:
    - id: test
      call: test.tool
      with:
        value: $invalid-format
  return: {}
      `;

      expect(() => parser.parse(yaml)).toThrow(/Invalid reference format/);
      expect(() => parser.parse(yaml)).toThrow(CompositionErrorCode.INVALID_FORMAT);
    });

    test('throws on invalid reference namespace', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: test
spec:
  inputSchema: {}
  steps:
    - id: test
      call: test.tool
      with:
        value: $invalid_namespace/foo
  return: {}
      `;

      expect(() => parser.parse(yaml)).toThrow(/Invalid reference namespace/);
      expect(() => parser.parse(yaml)).toThrow(CompositionErrorCode.INVALID_NAMESPACE);
    });
  });

  // ==========================================================================
  // Condition Canonicalization Tests
  // ==========================================================================

  describe('Condition canonicalization', () => {
    test('canonicalizes exists condition', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: condition_test
spec:
  inputSchema: {}
  steps:
    - id: test
      call: test.tool
      when:
        exists: $input/value
  return: {}
      `;

      const result = parser.parse(yaml);
      const step = result.spec.steps[0] as any;

      expect(step.when).toBeDefined();
      expect(step.when.exists).toBeDefined();
      expect(isReference(step.when.exists)).toBe(true);
    });

    test('canonicalizes equals condition', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: condition_test
spec:
  inputSchema: {}
  steps:
    - id: test
      if:
        condition:
          equals:
            - $input/status
            - active
        then: yes
        else: no
  return: {}
      `;

      const result = parser.parse(yaml);
      const step = result.spec.steps[0] as any;

      expect(step.if.condition.equals).toHaveLength(2);
      expect(isReference(step.if.condition.equals[0])).toBe(true);
      expect(step.if.condition.equals[1]).toBe('active');
    });

    test('canonicalizes comparison conditions', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: comparison_test
spec:
  inputSchema: {}
  steps:
    - id: test
      call: test.tool
      when:
        greaterThan:
          - $input/count
          - 100
  return: {}
      `;

      const result = parser.parse(yaml);
      const step = result.spec.steps[0] as any;

      expect(step.when.greaterThan).toHaveLength(2);
      expect(isReference(step.when.greaterThan[0])).toBe(true);
      expect(step.when.greaterThan[1]).toBe(100);
    });

    test('canonicalizes logical combinators (all, any, not)', () => {
      const yaml = `
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: combinator_test
spec:
  inputSchema: {}
  steps:
    - id: test
      call: test.tool
      when:
        all:
          - exists: $input/user_id
          - greaterThan: [$input/age, 18]
  return: {}
      `;

      const result = parser.parse(yaml);
      const step = result.spec.steps[0] as any;

      expect(step.when.all).toBeDefined();
      expect(step.when.all).toHaveLength(2);
      expect(step.when.all[0].exists).toBeDefined();
      expect(step.when.all[1].greaterThan).toBeDefined();
    });
  });
});
