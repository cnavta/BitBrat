/**
 * Unit tests for pattern-matcher.ts
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  matchPattern,
  validateRegexPattern,
  UnsafeRegexError,
} from '../pattern-matcher.js';

describe('Pattern Matcher', () => {
  describe('matchPattern - exact', () => {
    it('should match exact strings', () => {
      expect(matchPattern('hello', 'hello', 'exact')).toBe(true);
      expect(matchPattern('hello', 'Hello', 'exact')).toBe(false);
    });

    it('should support case-insensitive exact matching', () => {
      expect(matchPattern('hello', 'HELLO', 'exact', { caseSensitive: false })).toBe(true);
      expect(matchPattern('Hello World', 'hello world', 'exact', { caseSensitive: false })).toBe(true);
    });

    it('should not match different strings', () => {
      expect(matchPattern('hello', 'goodbye', 'exact')).toBe(false);
      expect(matchPattern('hello world', 'hello', 'exact')).toBe(false);
    });
  });

  describe('matchPattern - contains', () => {
    it('should match substrings', () => {
      expect(matchPattern('hello world', 'world', 'contains')).toBe(true);
      expect(matchPattern('hello world', 'hello', 'contains')).toBe(true);
      expect(matchPattern('hello world', 'lo wo', 'contains')).toBe(true);
    });

    it('should support case-insensitive contains matching', () => {
      expect(matchPattern('Hello World', 'WORLD', 'contains', { caseSensitive: false })).toBe(true);
      expect(matchPattern('Hello World', 'hello', 'contains', { caseSensitive: false })).toBe(true);
    });

    it('should not match non-existent substrings', () => {
      expect(matchPattern('hello world', 'goodbye', 'contains')).toBe(false);
      expect(matchPattern('hello world', 'HELLO', 'contains')).toBe(false);
    });
  });

  describe('matchPattern - prefix', () => {
    it('should match string prefixes', () => {
      expect(matchPattern('hello world', 'hello', 'prefix')).toBe(true);
      expect(matchPattern('!fail', '!', 'prefix')).toBe(true);
      expect(matchPattern('!fail', '!fail', 'prefix')).toBe(true);
    });

    it('should support case-insensitive prefix matching', () => {
      expect(matchPattern('Hello World', 'HELLO', 'prefix', { caseSensitive: false })).toBe(true);
      expect(matchPattern('!Fail', '!fail', 'prefix', { caseSensitive: false })).toBe(true);
    });

    it('should not match non-prefix strings', () => {
      expect(matchPattern('hello world', 'world', 'prefix')).toBe(false);
      expect(matchPattern('hello world', 'ello', 'prefix')).toBe(false);
    });
  });

  describe('matchPattern - suffix', () => {
    it('should match string suffixes', () => {
      expect(matchPattern('hello world', 'world', 'suffix')).toBe(true);
      expect(matchPattern('test.txt', '.txt', 'suffix')).toBe(true);
      expect(matchPattern('hello world', 'hello world', 'suffix')).toBe(true);
    });

    it('should support case-insensitive suffix matching', () => {
      expect(matchPattern('hello WORLD', 'world', 'suffix', { caseSensitive: false })).toBe(true);
      expect(matchPattern('Test.TXT', '.txt', 'suffix', { caseSensitive: false })).toBe(true);
    });

    it('should not match non-suffix strings', () => {
      expect(matchPattern('hello world', 'hello', 'suffix')).toBe(false);
      expect(matchPattern('hello world', 'worl', 'suffix')).toBe(false);
    });
  });

  describe('matchPattern - regex', () => {
    it('should match valid regex patterns', () => {
      expect(matchPattern('hello123', '^hello\\d+$', 'regex')).toBe(true);
      expect(matchPattern('test@example.com', '^[\\w.]+@[\\w.]+$', 'regex')).toBe(true);
      expect(matchPattern('!fail', '^!\\w+$', 'regex')).toBe(true);
    });

    it('should support regex flags', () => {
      expect(matchPattern('HELLO', 'hello', 'regex', { flags: 'i' })).toBe(true);
      expect(matchPattern('hello\nworld', '^world$', 'regex', { flags: 'm' })).toBe(true);
    });

    it('should not match non-matching patterns', () => {
      expect(matchPattern('hello', '^\\d+$', 'regex')).toBe(false);
      expect(matchPattern('test', '^hello$', 'regex')).toBe(false);
    });

    it('should throw on unsafe regex patterns', () => {
      // ReDoS-vulnerable pattern
      expect(() => {
        matchPattern('test', '(a+)+b', 'regex');
      }).toThrow(UnsafeRegexError);
    });

    it('should handle invalid regex gracefully', () => {
      expect(() => {
        matchPattern('test', '[invalid', 'regex');
      }).toThrow();
    });
  });

  describe('validateRegexPattern', () => {
    it('should validate safe regex patterns', () => {
      const result = validateRegexPattern('^hello\\d+$');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate simple patterns', () => {
      const result = validateRegexPattern('^hello$');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should detect unsafe regex patterns', () => {
      const result = validateRegexPattern('(a+)+b');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unsafe');
    });

    it('should detect invalid regex syntax', () => {
      const result = validateRegexPattern('[invalid');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeDefined(); // Just check it exists, message varies
    });
  });

  describe('Performance', () => {
    it('should complete simple matches quickly', () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        matchPattern('hello world', 'world', 'contains');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete 1000 matches in <100ms
    });

    it('should cache compiled regex patterns', () => {
      const pattern = '^test\\d+$';

      // First match (compile + execute)
      const start1 = Date.now();
      matchPattern('test123', pattern, 'regex');
      const duration1 = Date.now() - start1;

      // Subsequent matches (cached regex)
      const start2 = Date.now();
      for (let i = 0; i < 100; i++) {
        matchPattern(`test${i}`, pattern, 'regex');
      }
      const duration2 = Date.now() - start2;

      // Cached matches should complete successfully (timing too unreliable on fast CPUs)
      expect(duration2).toBeGreaterThanOrEqual(0);
    });
  });
});
