/**
 * Tests for config tools
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  configShowTool,
  configValidateTool,
  configDoctorTool,
  schemaReadTool,
} from '../../tools/config.js';
import { createMockConnection } from '../../test-utils/mocks.js';
import { extractTextContent, parseJsonContent } from '../../test-utils/helpers.js';

describe('Config Tools', () => {
  let mockConnection: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  describe('config.show', () => {
    it('should return architecture.yaml content in YAML format', async () => {
      const result = await configShowTool.handler({ format: 'yaml' }, mockConnection);

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      const text = extractTextContent(result);
      expect(text).toContain('name: BitBrat Platform');
      expect(text).toContain('services:');
    });

    it('should return architecture.yaml content in JSON format', async () => {
      const result = await configShowTool.handler({ format: 'json' }, mockConnection);

      const json = parseJsonContent(result);
      expect(json).toBeDefined();
      expect(json.name).toBe('BitBrat Platform');
      expect(json.services).toBeDefined();
    });

    it('should default to YAML format when no format specified', async () => {
      const result = await configShowTool.handler({}, mockConnection);

      const text = extractTextContent(result);
      expect(text).toContain('name: BitBrat Platform');
    });
  });

  describe('config.validate', () => {
    it('should validate architecture.yaml structure', async () => {
      const result = await configValidateTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      expect(json).toBeDefined();
      expect(json).toHaveProperty('valid');
      expect(json).toHaveProperty('issuesCount');
      expect(json).toHaveProperty('warningsCount');
      expect(json).toHaveProperty('issues');
      expect(json).toHaveProperty('warnings');
    });

    it('should run validation and return results', async () => {
      const result = await configValidateTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      // Check that validation ran and returned structured results
      expect(typeof json.valid).toBe('boolean');
      expect(typeof json.issuesCount).toBe('number');
      expect(typeof json.warningsCount).toBe('number');
    });
  });

  describe('config.doctor', () => {
    it('should run environment diagnostics', async () => {
      const result = await configDoctorTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      expect(json).toBeDefined();
      expect(json).toHaveProperty('healthy');
      expect(json).toHaveProperty('checks');
      expect(Array.isArray(json.checks)).toBe(true);
    });

    it('should check for architecture.yaml', async () => {
      const result = await configDoctorTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      const archCheck = json.checks.find((c: any) => c.name === 'architecture.yaml');
      expect(archCheck).toBeDefined();
      expect(archCheck.status).toBe('ok');
    });

    it('should check Node.js version', async () => {
      const result = await configDoctorTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      const nodeCheck = json.checks.find((c: any) => c.name === 'node-version');
      expect(nodeCheck).toBeDefined();
      expect(['ok', 'warning']).toContain(nodeCheck.status);
    });

    it('should check .brat directory writability', async () => {
      const result = await configDoctorTool.handler({}, mockConnection);

      const json = parseJsonContent(result);
      const bratCheck = json.checks.find((c: any) => c.name === '.brat-writable');
      expect(bratCheck).toBeDefined();
    });
  });

  describe('schema.read', () => {
    it('should read envelope.v1 schema', async () => {
      const result = await schemaReadTool.handler({ name: 'envelope.v1' }, mockConnection);

      const text = extractTextContent(result);
      expect(text).toContain('"$schema"');
      expect(text).toContain('envelope');
    });

    it('should handle schema name with .json extension', async () => {
      const result = await schemaReadTool.handler({ name: 'envelope.v1.json' }, mockConnection);

      const text = extractTextContent(result);
      expect(text).toContain('"$schema"');
    });

    it('should return error for non-existent schema', async () => {
      const result = await schemaReadTool.handler({ name: 'nonexistent' }, mockConnection);

      expect(result.isError).toBe(true);
      const text = extractTextContent(result);
      expect(text).toContain('Schema not found');
    });
  });
});
