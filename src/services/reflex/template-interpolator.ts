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
