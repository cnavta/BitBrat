/**
 * Tests for pattern matching with capture extraction (Sprint 34)
 * 
 * Tests the new matchPatternWithCaptures() function and related
 * capture extraction functionality.
 */

import {
  matchPatternWithCaptures,
  matchPattern,
} from '../pattern-matcher';

describe('Pattern Matcher - Capture Extraction', () => {
  describe('matchPatternWithCaptures - Regex patterns', () => {
    test('should extract single capture group', () => {
      const result = matchPatternWithCaptures('!bid 50', '^!bid (\\d+)$', 'regex');

      expect(result.matched).toBe(true);
      expect(result.captures).toBeDefined();
      expect(result.captures![0]).toBe('!bid 50'); // Full match
      expect(result.captures![1]).toBe('50'); // First capture group
    });

    test('should extract multiple capture groups', () => {
      const result = matchPatternWithCaptures(
        '!timer 30 Break time',
        '^!timer (\\d+) (.+)$',
        'regex'
      );

      expect(result.matched).toBe(true);
      expect(result.captures).toBeDefined();
      expect(result.captures![0]).toBe('!timer 30 Break time');
      expect(result.captures![1]).toBe('30');
      expect(result.captures![2]).toBe('Break time');
    });

    test('should handle no capture groups in regex', () => {
      const result = matchPatternWithCaptures('!ping', '^!ping$', 'regex');

      expect(result.matched).toBe(true);
      expect(result.captures).toBeDefined();
      expect(result.captures![0]).toBe('!ping'); // Full match only
      expect(result.captures![1]).toBeUndefined(); // No groups
    });

    test('should return no captures when pattern does not match', () => {
      const result = matchPatternWithCaptures('hello', '^!bid (\\d+)$', 'regex');

      expect(result.matched).toBe(false);
      expect(result.captures).toBeUndefined();
    });

    test('should handle alternation in capture groups', () => {
      const result = matchPatternWithCaptures(
        '!volume on',
        '^!volume (on|off)$',
        'regex'
      );

      expect(result.matched).toBe(true);
      expect(result.captures).toBeDefined();
      expect(result.captures![0]).toBe('!volume on');
      expect(result.captures![1]).toBe('on'); // Captured alternation
    });

    test('should handle nested capture groups', () => {
      const result = matchPatternWithCaptures(
        'volume 50%',
        '^volume (\\d+)(%)$',
        'regex'
      );

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('volume 50%');
      expect(result.captures![1]).toBe('50');
      expect(result.captures![2]).toBe('%');
    });

    test('should handle case-insensitive regex with captures', () => {
      const result = matchPatternWithCaptures(
        'BID 100',
        '^bid (\\d+)$',
        'regex',
        { flags: 'i' }
      );

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('BID 100');
      expect(result.captures![1]).toBe('100');
    });
  });

  describe('matchPatternWithCaptures - Non-regex patterns', () => {
    test('should extract full match for exact pattern', () => {
      const result = matchPatternWithCaptures('!ping', '!ping', 'exact');

      expect(result.matched).toBe(true);
      expect(result.captures).toBeDefined();
      expect(result.captures![0]).toBe('!ping');
      expect(result.captures![1]).toBeUndefined(); // No capture groups
    });

    test('should extract matched substring for contains pattern', () => {
      const result = matchPatternWithCaptures(
        'hello subscribe world',
        'subscribe',
        'contains'
      );

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('subscribe');
    });

    test('should preserve original casing in contains match', () => {
      const result = matchPatternWithCaptures(
        'HELLO SUBSCRIBE WORLD',
        'subscribe',
        'contains',
        { caseSensitive: false }
      );

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('SUBSCRIBE'); // Original casing preserved
    });

    test('should extract prefix for prefix pattern', () => {
      const result = matchPatternWithCaptures('!timer 60', '!', 'prefix');

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('!');
    });

    test('should extract suffix for suffix pattern', () => {
      const result = matchPatternWithCaptures(
        'Is this a question?',
        '?',
        'suffix'
      );

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('?');
    });

    test('should return no captures for non-matching contains', () => {
      const result = matchPatternWithCaptures(
        'hello world',
        'goodbye',
        'contains'
      );

      expect(result.matched).toBe(false);
      expect(result.captures).toBeUndefined();
    });
  });

  describe('Backward compatibility with matchPattern()', () => {
    test('original matchPattern() should still return boolean', () => {
      const result = matchPattern('!bid 50', '^!bid (\\d+)$', 'regex');

      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    test('matchPattern() should work unchanged for all pattern types', () => {
      expect(matchPattern('!ping', '!ping', 'exact')).toBe(true);
      expect(matchPattern('hello', 'ell', 'contains')).toBe(true);
      expect(matchPattern('!cmd', '!', 'prefix')).toBe(true);
      expect(matchPattern('test?', '?', 'suffix')).toBe(true);
      expect(matchPattern('abc123', '^[a-z]+\\d+$', 'regex')).toBe(true);
    });
  });

  describe('Performance', () => {
    test('should complete regex capture extraction within 10ms', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        matchPatternWithCaptures('!bid 50', '^!bid (\\d+)$', 'regex');
      }
      
      const avgTime = (performance.now() - startTime) / 100;
      expect(avgTime).toBeLessThan(10);
    });

    test('should complete non-regex capture extraction within 10ms', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        matchPatternWithCaptures('hello subscribe world', 'subscribe', 'contains');
      }
      
      const avgTime = (performance.now() - startTime) / 100;
      expect(avgTime).toBeLessThan(10);
    });
  });

  describe('Edge cases', () => {
    test('should handle empty string match', () => {
      const result = matchPatternWithCaptures('', '^$', 'regex');

      expect(result.matched).toBe(true);
      expect(result.captures![0]).toBe('');
    });

    test('should handle capture of empty group', () => {
      const result = matchPatternWithCaptures('test', '^(test)()$', 'regex');

      expect(result.matched).toBe(true);
      expect(result.captures![1]).toBe('test');
      expect(result.captures![2]).toBe(''); // Empty capture group
    });

    test('should handle many capture groups', () => {
      const result = matchPatternWithCaptures(
        'a b c d e',
        '^(\\w) (\\w) (\\w) (\\w) (\\w)$',
        'regex'
      );

      expect(result.matched).toBe(true);
      expect(result.captures![1]).toBe('a');
      expect(result.captures![2]).toBe('b');
      expect(result.captures![3]).toBe('c');
      expect(result.captures![4]).toBe('d');
      expect(result.captures![5]).toBe('e');
    });

    test('should handle special regex characters in captures', () => {
      const result = matchPatternWithCaptures(
        'Price: $50.00',
        '^Price: \\$(\\d+\\.\\d+)$',
        'regex'
      );

      expect(result.matched).toBe(true);
      expect(result.captures![1]).toBe('50.00');
    });
  });
});
