/**
 * Template Interpolator for Reflex Bit
 *
 * Provides template string interpolation using {{field.path}} syntax.
 * Supports nested field access, escaped braces, and automatic stringification.
 *
 * Examples:
 * - "Hello {{identity.user.displayName}}" → "Hello JohnDoe"
 * - "Count: {{result.count}}" → "Count: 42"
 * - "Use \\{{this}} for literal braces" → "Use {{this}} for literal braces"
 */

import { getFieldValue } from './field-accessor.js';
import { logger } from '../../common/logging';
import { MatchCaptures } from '../../types/reflex.js';

/**
 * Regular expression to match {{field.path}} placeholders.
 *
 * Captures the field path between {{ and }}.
 * Does not match escaped braces (\{{).
 */
const TEMPLATE_REGEX = /(?<!\\)\{\{([^}]+)\}\}/g;

/**
 * Regular expression to match escaped braces that should become literal.
 *
 * Matches \{{ and converts to {{
 */
const ESCAPED_BRACE_REGEX = /\\(\{\{|\}\})/g;

/**
 * Interpolates a template string by replacing {{field.path}} placeholders.
 *
 * Process:
 * 1. Find all {{field.path}} placeholders
 * 2. Extract value from source object for each placeholder
 * 3. Replace placeholder with stringified value
 * 4. Handle escaped braces (\{{ → {{)
 * 5. Warn on missing fields but continue (replace with empty string)
 *
 * @param template - Template string with {{field.path}} placeholders
 * @param source - Object to extract field values from
 * @param options - Interpolation options
 * @param options.missingFieldValue - Value to use for missing fields (default: '')
 * @param options.logMissingFields - Whether to log warnings for missing fields (default: true)
 * @returns Interpolated string
 *
 * @example
 * const event = {
 *   identity: { user: { displayName: 'JohnDoe' } },
 *   message: { text: 'hello' }
 * };
 *
 * interpolateTemplate('Hi {{identity.user.displayName}}!', event)
 * // 'Hi JohnDoe!'
 *
 * @example
 * // Missing field handling
 * interpolateTemplate('Value: {{missing.field}}', {})
 * // 'Value: ' (empty string, with warning logged)
 *
 * @example
 * // Escaped braces
 * interpolateTemplate('Use \\{{this}} as literal', {})
 * // 'Use {{this}} as literal'
 */
export function interpolateTemplate(
  template: string,
  source: any,
  options: {
    missingFieldValue?: string;
    logMissingFields?: boolean;
  } = {}
): string {
  const { missingFieldValue = '', logMissingFields = true } = options;

  // Step 1: Replace all {{field.path}} placeholders
  let result = template.replace(TEMPLATE_REGEX, (match, fieldPath) => {
    // Trim whitespace from field path
    const trimmedPath = fieldPath.trim();

    // Extract value from source object
    const value = getFieldValue(source, trimmedPath);

    // Handle missing fields
    if (value === undefined || value === null) {
      if (logMissingFields) {
        logger.warn(
          `[template-interpolator] Missing field in template: ${trimmedPath} (replaced with empty string)`
        );
      }
      return missingFieldValue;
    }

    // Stringify non-string values
    return stringifyValue(value);
  });

  // Step 2: Handle escaped braces (\{{ → {{, \}} → }})
  result = result.replace(ESCAPED_BRACE_REGEX, '$1');

  return result;
}

/**
 * Converts a value to a string for template interpolation.
 *
 * Handles different value types appropriately:
 * - String: Return as-is
 * - Number/Boolean: Convert to string
 * - Object/Array: JSON stringify
 * - null/undefined: Return empty string (shouldn't happen due to earlier checks)
 *
 * @param value - Value to stringify
 * @returns String representation
 */
function stringifyValue(value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      logger.warn('template.interpolator.stringify_error', { error: error instanceof Error ? error.message : String(error) });
      return '[object]';
    }
  }

  return '';
}

/**
 * Extracts all field paths referenced in a template.
 *
 * Useful for analyzing template dependencies or pre-validating that
 * required fields exist.
 *
 * @param template - Template string
 * @returns Array of field paths referenced in template
 *
 * @example
 * extractTemplatePaths('{{user.name}} said {{message.text}}')
 * // ['user.name', 'message.text']
 */
export function extractTemplatePaths(template: string): string[] {
  const paths: string[] = [];
  const regex = new RegExp(TEMPLATE_REGEX);
  let match;

  while ((match = regex.exec(template)) !== null) {
    paths.push(match[1].trim());
  }

  return paths;
}

/**
 * Checks if a template contains any placeholders.
 *
 * @param template - Template string to check
 * @returns true if template contains {{...}} placeholders
 *
 * @example
 * hasPlaceholders('Hello {{name}}') // true
 * hasPlaceholders('Hello world') // false
 * hasPlaceholders('Use \\{{this}}') // false (escaped)
 */
export function hasPlaceholders(template: string): boolean {
  return TEMPLATE_REGEX.test(template);
}

/**
 * Validates a template string for syntax errors.
 *
 * Checks for:
 * - Unmatched braces
 * - Empty placeholders
 *
 * @param template - Template string to validate
 * @returns Object with isValid flag and optional error message
 *
 * @example
 * validateTemplate('Hello {{name}}') // { isValid: true }
 * validateTemplate('Hello {{}}') // { isValid: false, error: 'Empty placeholder' }
 * validateTemplate('Hello {{name') // { isValid: false, error: 'Unmatched braces' }
 */
export function validateTemplate(template: string): {
  isValid: boolean;
  error?: string;
} {
  // Check for unmatched braces
  const openCount = (template.match(/(?<!\\)\{\{/g) || []).length;
  const closeCount = (template.match(/(?<!\\)\}\}/g) || []).length;

  if (openCount !== closeCount) {
    return {
      isValid: false,
      error: `Unmatched braces (${openCount} opening, ${closeCount} closing)`,
    };
  }

  // Check for empty placeholders
  if (/(?<!\\)\{\{\s*\}\}/.test(template)) {
    return {
      isValid: false,
      error: 'Empty placeholder {{}} found',
    };
  }

  return { isValid: true };
}

// ============================================================================
// CAPTURE-BASED INTERPOLATION (Sprint 34)
// ============================================================================

/**
 * Attempts to coerce a string value to a more specific type.
 *
 * Coercion rules:
 * - "true"/"false" (case-insensitive) → boolean
 * - Numeric strings (integer, float, hex, scientific) → number
 * - Everything else → string (unchanged)
 *
 * @param value - String value to coerce
 * @returns Coerced value (number, boolean, or original string)
 *
 * @example
 * coerceType('50') // 50 (number)
 * coerceType('3.14') // 3.14 (number)
 * coerceType('true') // true (boolean)
 * coerceType('FALSE') // false (boolean)
 * coerceType('0x10') // 16 (number)
 * coerceType('1e3') // 1000 (number)
 * coerceType('hello') // 'hello' (string)
 * coerceType('50px') // '50px' (string, mixed content)
 */
export function coerceType(value: string): string | number | boolean {
  // Boolean coercion (case-insensitive)
  const lowerValue = value.toLowerCase();
  if (lowerValue === 'true') return true;
  if (lowerValue === 'false') return false;

  // Special number values
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;

  // Number coercion
  // Check if it looks like a number (handles integer, float, hex, scientific notation)
  const numericPattern = /^-?(?:0x[\da-f]+|\d+\.?\d*(?:e[+-]?\d+)?)$/i;
  if (numericPattern.test(value)) {
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Default: keep as string
  return value;
}

/**
 * Interpolates capture placeholders (${N} or $N) in a template string.
 *
 * Replaces ${0}, ${1}, ${N} and $0, $1, $N with captured values.
 * Missing captures are left as placeholders (graceful degradation).
 *
 * @param template - Template string with ${N} or $N placeholders
 * @param captures - Captured substrings from pattern matching
 * @returns Interpolated string
 *
 * @example
 * // Single capture
 * interpolateCapturesInTemplate('Bid placed: ${1}', { 0: '!bid 50', 1: '50' })
 * // Returns: 'Bid placed: 50'
 *
 * @example
 * // Multiple captures
 * interpolateCapturesInTemplate('Timer: ${1}s - ${2}', { 0: 'full', 1: '30', 2: 'Break time' })
 * // Returns: 'Timer: 30s - Break time'
 *
 * @example
 * // Shell syntax
 * interpolateCapturesInTemplate('Value: $1', { 0: '!cmd 100', 1: '100' })
 * // Returns: 'Value: 100'
 *
 * @example
 * // Missing capture (graceful degradation)
 * interpolateCapturesInTemplate('Missing: ${10}', { 0: 'full' })
 * // Returns: 'Missing: ${10}'
 */
export function interpolateCapturesInTemplate(template: string, captures?: MatchCaptures): string {
  if (!captures) {
    return template;
  }

  let result = template;

  // Replace ${N} syntax (brace syntax)
  result = result.replace(/\$\{(\d+)\}/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10);
    const capturedValue = captures[index];
    return capturedValue !== undefined ? stringifyValue(capturedValue) : match;
  });

  // Replace $N syntax (shell syntax)
  // Use negative lookbehind to avoid matching ${N}
  result = result.replace(/(?<!\{)\$(\d+)(?!\})/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10);
    const capturedValue = captures[index];
    return capturedValue !== undefined ? stringifyValue(capturedValue) : match;
  });

  return result;
}

/**
 * Interpolates a single parameter value with captures and type coercion.
 *
 * Handles three scenarios:
 * 1. Pure ${N} placeholder: Replaces with coerced value (number/boolean if possible)
 * 2. Mixed string with ${N}: Replaces placeholder but keeps as string
 * 3. No placeholders: Returns value as-is
 *
 * Supports both ${N} and $N syntax.
 *
 * @param value - Parameter value template (can be string, number, boolean, object, etc.)
 * @param captures - Captured substrings from pattern matching
 * @returns Interpolated and potentially coerced value
 *
 * @example
 * // Pure placeholder with coercion
 * interpolateCapturesInParameter('${1}', { 0: '!bid 50', 1: '50' })
 * // Returns: 50 (number, not string)
 *
 * @example
 * // Mixed string (no coercion)
 * interpolateCapturesInParameter('Amount: ${1}', { 0: '!bid 50', 1: '50' })
 * // Returns: 'Amount: 50' (string)
 *
 * @example
 * // Shell syntax
 * interpolateCapturesInParameter('$1', { 0: '!bid 50', 1: '50' })
 * // Returns: 50 (number)
 *
 * @example
 * // Non-string value (passed through)
 * interpolateCapturesInParameter(42, { 0: 'ignored' })
 * // Returns: 42 (unchanged)
 */
export function interpolateCapturesInParameter(value: any, captures?: MatchCaptures): any {
  // If value is not a string, no interpolation needed
  if (typeof value !== 'string') {
    return value;
  }

  // If no captures provided, return as-is
  if (!captures) {
    return value;
  }

  // Check if value is a pure placeholder (for type coercion)
  // Matches: ${N} or $N where N is a digit
  const pureCaptureBrace = /^\$\{(\d+)\}$/;
  const pureCaptureShell = /^\$(\d+)$/;

  const braceMatch = value.match(pureCaptureBrace);
  const shellMatch = value.match(pureCaptureShell);

  // Pure ${N} or $N: Replace and coerce
  if (braceMatch || shellMatch) {
    const index = parseInt((braceMatch || shellMatch)![1], 10);
    const capturedValue = captures[index];

    if (capturedValue !== undefined) {
      // Coerce the captured string to appropriate type
      return coerceType(capturedValue);
    } else {
      // Missing capture: keep placeholder
      return value;
    }
  }

  // Mixed string: Replace all placeholders but keep as string
  return interpolateCapturesInTemplate(value, captures);
}

/**
 * Interpolates all parameter values in a parameter object with captures.
 *
 * Recursively processes all string values in the parameter object,
 * interpolating captures and applying type coercion where appropriate.
 *
 * @param parameters - Parameter template object
 * @param captures - Captured substrings from pattern matching
 * @returns Interpolated parameter object with coerced types
 *
 * @example
 * // Simple parameter with coercion
 * interpolateCapturesInParameters({ amount: '${1}' }, { 0: '!bid 50', 1: '50' })
 * // Returns: { amount: 50 } (number, not string)
 *
 * @example
 * // Mixed parameters
 * interpolateCapturesInParameters(
 *   { duration: '${1}', message: 'Timer: ${1}s' },
 *   { 0: '!timer 30', 1: '30' }
 * )
 * // Returns: { duration: 30, message: 'Timer: 30s' }
 *
 * @example
 * // Nested object
 * interpolateCapturesInParameters(
 *   { config: { value: '${1}', label: 'Value: ${1}' } },
 *   { 0: 'full', 1: '100' }
 * )
 * // Returns: { config: { value: 100, label: 'Value: 100' } }
 */
export function interpolateCapturesInParameters(
  parameters: Record<string, any>,
  captures?: MatchCaptures
): Record<string, any> {
  if (!captures) {
    return parameters;
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string') {
      // String value: interpolate with potential coercion
      result[key] = interpolateCapturesInParameter(value, captures);
    } else if (Array.isArray(value)) {
      // Array: recursively interpolate each element
      result[key] = value.map((item) =>
        typeof item === 'string' ? interpolateCapturesInParameter(item, captures) : item
      );
    } else if (value !== null && typeof value === 'object') {
      // Nested object: recursively interpolate
      result[key] = interpolateCapturesInParameters(value, captures);
    } else {
      // Primitive non-string (number, boolean, null): pass through
      result[key] = value;
    }
  }

  return result;
}
