/**
 * Pattern Matcher for Reflex Bit
 *
 * Provides fast, safe pattern matching with 5 match types:
 * - exact: Strict equality matching
 * - contains: Substring matching
 * - prefix: String starts with pattern
 * - suffix: String ends with pattern
 * - regex: Regular expression matching with ReDoS protection
 *
 * Performance target: <10ms per match evaluation
 */

import safeRegex from 'safe-regex';
import { logger } from '../../common/logging';
import { PatternMatchType } from '../../types/reflex.js';

/**
 * Error thrown when an unsafe regex pattern is detected.
 */
export class UnsafeRegexError extends Error {
  constructor(pattern: string) {
    super(`Unsafe regex pattern detected (potential ReDoS): ${pattern}`);
    this.name = 'UnsafeRegexError';
  }
}

/**
 * Cache for compiled regex patterns to avoid recompilation.
 * Key format: `${pattern}|${flags}`
 */
const regexCache = new Map<string, RegExp>();

/**
 * Validates that a regex pattern is safe (not vulnerable to ReDoS attacks).
 *
 * @param pattern - Regular expression pattern to validate
 * @throws {UnsafeRegexError} If the pattern is potentially vulnerable to ReDoS
 */
function validateRegexSafety(pattern: string): void {
  if (!safeRegex(pattern)) {
    throw new UnsafeRegexError(pattern);
  }
}

/**
 * Validates a regex pattern for safety and syntax.
 *
 * Public wrapper for pattern validation used by reflex-service.
 *
 * @param pattern - Regular expression pattern to validate
 * @returns Validation result with isValid flag and optional error message
 *
 * @example
 * const result = validateRegexPattern('^!command (\\d+)$');
 * if (result.isValid) {
 *   console.log('Pattern is safe');
 * } else {
 *   logger.error('Pattern error:', result.error);
 * }
 */
export function validateRegexPattern(pattern: string): { isValid: boolean; error?: string } {
  try {
    validateRegexSafety(pattern);
    // Also try to compile it to check syntax
    new RegExp(pattern);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Gets or creates a compiled regex pattern from cache.
 *
 * @param pattern - Regular expression pattern
 * @param flags - Optional regex flags (i, m, s, etc.)
 * @returns Compiled RegExp object
 * @throws {UnsafeRegexError} If the pattern is unsafe
 */
function getCompiledRegex(pattern: string, flags?: string): RegExp {
  const cacheKey = `${pattern}|${flags || ''}`;

  let regex = regexCache.get(cacheKey);
  if (regex) {
    return regex;
  }

  // Validate safety before compiling
  validateRegexSafety(pattern);

  try {
    regex = new RegExp(pattern, flags);
    regexCache.set(cacheKey, regex);
    return regex;
  } catch (error) {
    throw new Error(
      `Invalid regex pattern: ${pattern} (flags: ${flags || 'none'}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Performs exact string matching (case-sensitive or insensitive).
 *
 * @param value - Value to test
 * @param pattern - Exact string to match
 * @param caseSensitive - Whether matching should be case-sensitive (default: true)
 * @returns true if value exactly matches pattern
 *
 * @example
 * matchExact('!fail', '!fail', true) // true
 * matchExact('!FAIL', '!fail', false) // true
 * matchExact('!FAIL', '!fail', true) // false
 */
function matchExact(value: string, pattern: string, caseSensitive = true): boolean {
  if (caseSensitive) {
    return value === pattern;
  }
  return value.toLowerCase() === pattern.toLowerCase();
}

/**
 * Checks if value contains the pattern as a substring.
 *
 * @param value - Value to test
 * @param pattern - Substring to search for
 * @param caseSensitive - Whether matching should be case-sensitive (default: true)
 * @returns true if value contains pattern
 *
 * @example
 * matchContains('subscribe now', 'subscribe', true) // true
 * matchContains('SUBSCRIBE now', 'subscribe', false) // true
 * matchContains('hello world', 'subscribe', true) // false
 */
function matchContains(value: string, pattern: string, caseSensitive = true): boolean {
  if (caseSensitive) {
    return value.includes(pattern);
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Checks if value starts with the pattern.
 *
 * @param value - Value to test
 * @param pattern - Prefix to match
 * @param caseSensitive - Whether matching should be case-sensitive (default: true)
 * @returns true if value starts with pattern
 *
 * @example
 * matchPrefix('!timer 60', '!', true) // true
 * matchPrefix('TIMER', 'timer', false) // true
 * matchPrefix('hello', '!', true) // false
 */
function matchPrefix(value: string, pattern: string, caseSensitive = true): boolean {
  if (caseSensitive) {
    return value.startsWith(pattern);
  }
  return value.toLowerCase().startsWith(pattern.toLowerCase());
}

/**
 * Checks if value ends with the pattern.
 *
 * @param value - Value to test
 * @param pattern - Suffix to match
 * @param caseSensitive - Whether matching should be case-sensitive (default: true)
 * @returns true if value ends with pattern
 *
 * @example
 * matchSuffix('Is this a question?', '?', true) // true
 * matchSuffix('QUESTION?', '?', false) // true
 * matchSuffix('statement', '?', true) // false
 */
function matchSuffix(value: string, pattern: string, caseSensitive = true): boolean {
  if (caseSensitive) {
    return value.endsWith(pattern);
  }
  return value.toLowerCase().endsWith(pattern.toLowerCase());
}

/**
 * Performs regular expression matching with ReDoS protection.
 *
 * @param value - Value to test
 * @param pattern - Regular expression pattern
 * @param flags - Optional regex flags (i, m, s, etc.)
 * @returns true if value matches the regex pattern
 * @throws {UnsafeRegexError} If the pattern is potentially vulnerable to ReDoS
 *
 * @example
 * matchRegex('!timer 60', '^!timer (\\d+)$', undefined) // true
 * matchRegex('HELLO', '^hello$', 'i') // true (case-insensitive)
 * matchRegex('hello', '^world$', undefined) // false
 */
function matchRegex(value: string, pattern: string, flags?: string): boolean {
  const regex = getCompiledRegex(pattern, flags);
  return regex.test(value);
}

/**
 * Matches a value against a pattern using the specified match type.
 *
 * @param value - Value to test (typically from event field)
 * @param pattern - Pattern to match against
 * @param type - Type of matching to perform
 * @param options - Additional matching options
 * @param options.caseSensitive - Case sensitivity for non-regex matches (default: true)
 * @param options.flags - Regex flags for regex type matches
 * @returns true if value matches the pattern
 * @throws {UnsafeRegexError} If regex pattern is unsafe
 * @throws {Error} If regex pattern is invalid
 *
 * @example
 * // Exact match
 * matchPattern('!fail', '!fail', 'exact') // true
 *
 * @example
 * // Case-insensitive contains
 * matchPattern('SUBSCRIBE NOW', 'subscribe', 'contains', { caseSensitive: false }) // true
 *
 * @example
 * // Regex match
 * matchPattern('!timer 60', '^!timer (\\d+)$', 'regex') // true
 */
export function matchPattern(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options: {
    caseSensitive?: boolean;
    flags?: string;
  } = {}
): boolean {
  const { caseSensitive = true, flags } = options;

  const startTime = performance.now();

  let result: boolean;

  switch (type) {
    case 'exact':
      result = matchExact(value, pattern, caseSensitive);
      break;

    case 'contains':
      result = matchContains(value, pattern, caseSensitive);
      break;

    case 'prefix':
      result = matchPrefix(value, pattern, caseSensitive);
      break;

    case 'suffix':
      result = matchSuffix(value, pattern, caseSensitive);
      break;

    case 'regex':
      result = matchRegex(value, pattern, flags);
      break;

    default:
      throw new Error(`Unknown pattern match type: ${type}`);
  }

  const latency = performance.now() - startTime;

  // Log if matching takes longer than target (<10ms)
  if (latency > 10) {
    logger.warn(
      `[pattern-matcher] Slow pattern match: ${latency.toFixed(2)}ms (type: ${type}, pattern: ${pattern})`
    );
  }

  return result;
}

/**
 * Clears the regex pattern cache.
 * Useful for testing or if cache grows too large.
 */
export function clearRegexCache(): void {
  regexCache.clear();
}

/**
 * Gets the current size of the regex cache.
 * Useful for monitoring memory usage.
 */
export function getRegexCacheSize(): number {
  return regexCache.size;
}
