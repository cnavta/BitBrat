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
import { PatternMatchType, MatchResult, MatchCaptures } from '../../types/reflex.js';

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
 * Performs regular expression matching with capture group extraction.
 *
 * Uses regex.exec() to extract the full match (index 0) and capture groups (index 1+).
 *
 * @param value - Value to test
 * @param pattern - Regular expression pattern
 * @param flags - Optional regex flags (i, m, s, etc.)
 * @returns MatchResult with captures if matched
 * @throws {UnsafeRegexError} If the pattern is potentially vulnerable to ReDoS
 *
 * @example
 * // Single capture group
 * matchRegexWithCaptures('!bid 50', '^!bid (\\d+)$')
 * // Returns: { matched: true, captures: { 0: '!bid 50', 1: '50' } }
 *
 * @example
 * // Multiple capture groups
 * matchRegexWithCaptures('!timer 30 Break time', '^!timer (\\d+) (.+)$')
 * // Returns: { matched: true, captures: { 0: '!timer 30 Break time', 1: '30', 2: 'Break time' } }
 *
 * @example
 * // No match
 * matchRegexWithCaptures('hello', '^!bid (\\d+)$')
 * // Returns: { matched: false }
 */
function matchRegexWithCaptures(value: string, pattern: string, flags?: string): MatchResult {
  const regex = getCompiledRegex(pattern, flags);
  const match = regex.exec(value);

  if (!match) {
    return { matched: false };
  }

  // Build captures object: index 0 = full match, index 1+ = capture groups
  const captures: MatchCaptures = { 0: match[0] };
  for (let i = 1; i < match.length; i++) {
    captures[i] = match[i];
  }

  return { matched: true, captures };
}

/**
 * Extracts the matched portion from a non-regex match.
 *
 * For non-regex patterns (exact, contains, prefix, suffix), the captures object
 * only contains index 0 with the matched substring.
 *
 * @param value - Original value
 * @param pattern - Pattern that was matched
 * @param type - Type of match performed
 * @param caseSensitive - Whether match was case-sensitive
 * @returns MatchCaptures with index 0 = matched portion
 *
 * @example
 * // Exact match
 * extractNonRegexCaptures('!ping', '!ping', 'exact', true)
 * // Returns: { 0: '!ping' }
 *
 * @example
 * // Contains match (case-insensitive)
 * extractNonRegexCaptures('HELLO subscribe WORLD', 'subscribe', 'contains', false)
 * // Returns: { 0: 'subscribe' } (original casing from value)
 */
function extractNonRegexCaptures(
  value: string,
  pattern: string,
  type: PatternMatchType,
  caseSensitive: boolean
): MatchCaptures {
  let matchedPortion: string;

  switch (type) {
    case 'exact':
      // Exact match: the entire value is the match
      matchedPortion = value;
      break;

    case 'contains':
      // Contains: find the matched substring (preserving original casing)
      if (caseSensitive) {
        const index = value.indexOf(pattern);
        matchedPortion = value.substring(index, index + pattern.length);
      } else {
        // Case-insensitive: find position then extract with original casing
        const lowerValue = value.toLowerCase();
        const lowerPattern = pattern.toLowerCase();
        const index = lowerValue.indexOf(lowerPattern);
        matchedPortion = value.substring(index, index + pattern.length);
      }
      break;

    case 'prefix':
      // Prefix: matched portion is the prefix
      matchedPortion = value.substring(0, pattern.length);
      break;

    case 'suffix':
      // Suffix: matched portion is the suffix
      matchedPortion = value.substring(value.length - pattern.length);
      break;

    default:
      // Should never happen (regex handled separately)
      matchedPortion = value;
  }

  return { 0: matchedPortion };
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

/**
 * Matches a value against a pattern and returns detailed match results with captures.
 *
 * This is the capture-aware version of matchPattern(). It returns a MatchResult
 * containing both the match status and any captured substrings.
 *
 * For regex patterns:
 * - Index 0: Full matched string
 * - Index 1+: Capture groups from parentheses in the regex
 *
 * For non-regex patterns (exact, contains, prefix, suffix):
 * - Index 0: The matched portion of the value
 *
 * @param value - Value to test (typically from event field)
 * @param pattern - Pattern to match against
 * @param type - Type of matching to perform
 * @param options - Additional matching options
 * @param options.caseSensitive - Case sensitivity for non-regex matches (default: true)
 * @param options.flags - Regex flags for regex type matches
 * @returns MatchResult with matched status and optional captures
 * @throws {UnsafeRegexError} If regex pattern is unsafe
 * @throws {Error} If regex pattern is invalid
 *
 * @example
 * // Regex with single capture group
 * matchPatternWithCaptures('!bid 50', '^!bid (\\d+)$', 'regex')
 * // Returns: { matched: true, captures: { 0: '!bid 50', 1: '50' } }
 *
 * @example
 * // Regex with multiple capture groups
 * matchPatternWithCaptures('!timer 30 Break time', '^!timer (\\d+) (.+)$', 'regex')
 * // Returns: { matched: true, captures: { 0: '!timer 30 Break time', 1: '30', 2: 'Break time' } }
 *
 * @example
 * // Exact match
 * matchPatternWithCaptures('!ping', '!ping', 'exact')
 * // Returns: { matched: true, captures: { 0: '!ping' } }
 *
 * @example
 * // Contains match
 * matchPatternWithCaptures('subscribe now!', 'subscribe', 'contains')
 * // Returns: { matched: true, captures: { 0: 'subscribe' } }
 *
 * @example
 * // No match
 * matchPatternWithCaptures('hello', '^!bid (\\d+)$', 'regex')
 * // Returns: { matched: false }
 */
export function matchPatternWithCaptures(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options: {
    caseSensitive?: boolean;
    flags?: string;
  } = {}
): MatchResult {
  const { caseSensitive = true, flags } = options;

  const startTime = performance.now();

  let result: MatchResult;

  if (type === 'regex') {
    // Regex: Use exec() to extract captures
    result = matchRegexWithCaptures(value, pattern, flags);
  } else {
    // Non-regex: First check if it matches, then extract capture
    const matched = matchPattern(value, pattern, type, { caseSensitive, flags });

    if (matched) {
      const captures = extractNonRegexCaptures(value, pattern, type, caseSensitive);
      result = { matched: true, captures };
    } else {
      result = { matched: false };
    }
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
