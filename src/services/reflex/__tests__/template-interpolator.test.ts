/**
 * Unit tests for template-interpolator.ts
 */

import { describe, it, expect } from '@jest/globals';
import {
  interpolateTemplate,
  validateTemplate,
  extractTemplatePaths,
} from '../template-interpolator.js';

describe('Template Interpolator', () => {
  const testData = {
    user: {
      name: 'JohnDoe',
      id: 'user-123',
    },
    message: {
      text: 'hello world',
      timestamp: '2026-07-04T12:00:00Z',
    },
    count: 42,
    enabled: true,
    nested: {
      deep: {
        value: 'found',
      },
    },
  };

  describe('interpolateTemplate', () => {
    it('should interpolate simple field paths', () => {
      const result = interpolateTemplate('User: {{user.name}}', testData);
      expect(result).toBe('User: JohnDoe');
    });

    it('should interpolate multiple placeholders', () => {
      const result = interpolateTemplate('{{user.name}} said: {{message.text}}', testData);
      expect(result).toBe('JohnDoe said: hello world');
    });

    it('should interpolate nested paths', () => {
      const result = interpolateTemplate('Found: {{nested.deep.value}}', testData);
      expect(result).toBe('Found: found');
    });

    it('should interpolate number values', () => {
      const result = interpolateTemplate('Count: {{count}}', testData);
      expect(result).toBe('Count: 42');
    });

    it('should interpolate boolean values', () => {
      const result = interpolateTemplate('Enabled: {{enabled}}', testData);
      expect(result).toBe('Enabled: true');
    });

    it('should keep placeholder for missing fields', () => {
      const result = interpolateTemplate('Missing: {{missing.field}}', testData);
      expect(result).toBe('Missing: {{missing.field}}');
    });

    it('should keep placeholder for undefined values', () => {
      const result = interpolateTemplate('Value: {{user.age}}', testData);
      expect(result).toBe('Value: {{user.age}}');
    });

    it('should handle escaped braces', () => {
      const result = interpolateTemplate('Literal: \\{\\{not.interpolated\\}\\}', testData);
      expect(result).toBe('Literal: {{not.interpolated}}');
    });

    it('should handle mixed escaped and real placeholders', () => {
      const result = interpolateTemplate('Real: {{user.name}}, Literal: \\{\\{fake\\}\\}', testData);
      expect(result).toBe('Real: JohnDoe, Literal: {{fake}}');
    });

    it('should handle templates with no placeholders', () => {
      const result = interpolateTemplate('No placeholders here', testData);
      expect(result).toBe('No placeholders here');
    });

    it('should handle empty template', () => {
      const result = interpolateTemplate('', testData);
      expect(result).toBe('');
    });

    it('should trim whitespace in field paths', () => {
      const result = interpolateTemplate('{{ user.name }}', testData);
      expect(result).toBe('JohnDoe');
    });

    it('should handle custom missing field value', () => {
      const result = interpolateTemplate('Value: {{missing}}', testData, {
        missingFieldValue: '[NOT_FOUND]',
      });
      expect(result).toBe('Value: [NOT_FOUND]');
    });
  });

  describe('validateTemplate', () => {
    it('should validate correct templates', () => {
      const result = validateTemplate('Hello {{user.name}}!');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate templates with multiple placeholders', () => {
      const result = validateTemplate('{{a}} {{b}} {{c.d}}');
      expect(result.isValid).toBe(true);
    });

    it('should detect unmatched opening braces', () => {
      const result = validateTemplate('Hello {{user.name');
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Unmatched braces');
    });

    it('should detect unmatched closing braces', () => {
      const result = validateTemplate('Hello user.name}}');
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should detect empty placeholders', () => {
      const result = validateTemplate('Hello {{}}!');
      expect(result.isValid).toBe(false);
      expect(result.errors![0]).toContain('Empty placeholder');
    });

    it('should allow escaped braces', () => {
      const result = validateTemplate('Literal: \\{\\{not.a.placeholder\\}\\}');
      expect(result.isValid).toBe(true);
    });

    it('should validate empty templates', () => {
      const result = validateTemplate('');
      expect(result.isValid).toBe(true);
    });
  });

  describe('extractTemplatePaths', () => {
    it('should extract single path', () => {
      const paths = extractTemplatePaths('Hello {{user.name}}!');
      expect(paths).toEqual(['user.name']);
    });

    it('should extract multiple paths', () => {
      const paths = extractTemplatePaths('{{user.name}} said {{message.text}} at {{message.timestamp}}');
      expect(paths).toEqual(['user.name', 'message.text', 'message.timestamp']);
    });

    it('should extract nested paths', () => {
      const paths = extractTemplatePaths('Value: {{nested.deep.value}}');
      expect(paths).toEqual(['nested.deep.value']);
    });

    it('should handle templates with no placeholders', () => {
      const paths = extractTemplatePaths('No placeholders');
      expect(paths).toEqual([]);
    });

    it('should deduplicate repeated paths', () => {
      const paths = extractTemplatePaths('{{user.name}} and {{user.name}} again');
      expect(paths).toEqual(['user.name', 'user.name']);
    });

    it('should ignore escaped braces', () => {
      const paths = extractTemplatePaths('{{user.name}} and \\{\\{fake\\}\\}');
      expect(paths).toEqual(['user.name']);
    });
  });

  describe('Edge cases', () => {
    it('should handle object values by stringifying', () => {
      const data = {
        obj: { a: 1, b: 2 },
      };
      const result = interpolateTemplate('Object: {{obj}}', data);
      expect(result).toBe('Object: {"a":1,"b":2}');
    });

    it('should handle array values by stringifying', () => {
      const data = {
        arr: [1, 2, 3],
      };
      const result = interpolateTemplate('Array: {{arr}}', data);
      expect(result).toBe('Array: [1,2,3]');
    });

    it('should handle null values', () => {
      const data = {
        nullValue: null,
      };
      const result = interpolateTemplate('Null: {{nullValue}}', data);
      expect(result).toBe('Null: {{nullValue}}');
    });

    it('should handle deeply nested missing paths', () => {
      const result = interpolateTemplate('{{a.b.c.d.e.f.g}}', testData);
      expect(result).toBe('{{a.b.c.d.e.f.g}}');
    });
  });
});
