/**
 * Business Logic: Sensitive Value Redaction
 * Sprint 360: Extracted from context/show.ts and config/show.ts
 *
 * Provides reusable redaction logic for sensitive configuration values
 * (passwords, tokens, secrets, API keys, etc.).
 *
 * Used by:
 * - context show command
 * - config show command
 * - Any other commands that display sensitive configuration
 */

/**
 * Sensitive field name patterns
 * These patterns match field names that typically contain sensitive data
 */
export const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /apikey/i,
  /api_key/i,
  /auth/i,
  /credential/i,
] as const;

/**
 * Redaction options
 */
export interface RedactionOptions {
  /**
   * Custom patterns to match sensitive field names (in addition to defaults)
   */
  additionalPatterns?: RegExp[];

  /**
   * Number of characters to show before redacting (default: 2)
   */
  prefixLength?: number;

  /**
   * Number of asterisks to use for redaction (default: 8)
   */
  redactionLength?: number;

  /**
   * Handle circular references
   * - 'throw': Throw an error (default)
   * - 'marker': Replace with '[Circular]' string
   * - 'ignore': Skip circular references
   */
  circularRefHandler?: 'throw' | 'marker' | 'ignore';
}

/**
 * Redaction result metadata
 */
export interface RedactionResult<T = any> {
  /**
   * Redacted object
   */
  value: T;

  /**
   * Number of values redacted
   */
  redactedCount: number;

  /**
   * Paths to redacted fields (e.g., ['runtime.gateway.authToken', 'secrets.apiKey'])
   */
  redactedPaths: string[];
}

/**
 * Check if a field name is sensitive based on patterns
 *
 * @param fieldName - Field name to check
 * @param additionalPatterns - Optional additional patterns to check
 * @returns true if field name matches sensitive pattern
 */
export function isSensitiveField(
  fieldName: string,
  additionalPatterns: RegExp[] = []
): boolean {
  const allPatterns = [...SENSITIVE_PATTERNS, ...additionalPatterns];
  return allPatterns.some(pattern => pattern.test(fieldName));
}

/**
 * Redact a single sensitive string value
 *
 * Redaction rules:
 * 1. Empty strings → return empty string
 * 2. Environment variables (${VAR}) → '${********}'
 * 3. Short values (≤4 chars) → all asterisks
 * 4. Long values → show prefix + asterisks
 *
 * @param value - String value to redact
 * @param options - Redaction options
 * @returns Redacted string
 */
export function redactString(
  value: string,
  options: RedactionOptions = {}
): string {
  const prefixLength = options.prefixLength ?? 2;
  const redactionLength = options.redactionLength ?? 8;

  // Empty string - return as is
  if (value.length === 0) {
    return '';
  }

  // Environment variable interpolation - redact the var name but show it's interpolated
  if (value.startsWith('${') && value.endsWith('}')) {
    return '${' + '*'.repeat(redactionLength) + '}';
  }

  // Short values - all asterisks
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  // Long values - show prefix + asterisks
  return value.substring(0, prefixLength) + '*'.repeat(redactionLength);
}

/**
 * Recursively redact sensitive values in an object
 *
 * Features:
 * - Handles nested objects and arrays
 * - Detects and handles circular references
 * - Preserves non-sensitive values
 * - Tracks redaction metadata (count, paths)
 *
 * @param obj - Object to redact
 * @param options - Redaction options
 * @param currentPath - Current path (for internal recursion tracking)
 * @param visited - Visited objects (for circular reference detection)
 * @returns Redacted object with metadata
 */
export function redactSensitiveValues<T = any>(
  obj: T,
  options: RedactionOptions = {},
  currentPath: string = '',
  visited: WeakSet<object> = new WeakSet()
): RedactionResult<T> {
  const redactedPaths: string[] = [];
  let redactedCount = 0;

  function redact(value: any, path: string): any {
    // Handle primitives
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    // Detect circular references
    if (visited.has(value)) {
      const handler = options.circularRefHandler ?? 'marker';
      if (handler === 'throw') {
        throw new Error(`Circular reference detected at path: ${path}`);
      } else if (handler === 'marker') {
        return '[Circular Reference]';
      } else {
        // 'ignore'
        return undefined;
      }
    }

    visited.add(value);

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item, index) => redact(item, `${path}[${index}]`));
    }

    // Handle objects
    const redacted: any = {};
    for (const [key, val] of Object.entries(value)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const isSensitive = isSensitiveField(key, options.additionalPatterns);

      if (isSensitive && typeof val === 'string') {
        // Redact sensitive string value
        redacted[key] = redactString(val, options);
        redactedPaths.push(fieldPath);
        redactedCount++;
      } else if (typeof val === 'object' && val !== null) {
        // Recursively redact nested objects
        redacted[key] = redact(val, fieldPath);
      } else {
        // Non-sensitive value, keep as is
        redacted[key] = val;
      }
    }

    return redacted;
  }

  const redactedValue = redact(obj, currentPath);

  return {
    value: redactedValue as T,
    redactedCount,
    redactedPaths,
  };
}

/**
 * Convenience function: redact and return only the value
 *
 * @param obj - Object to redact
 * @param options - Redaction options
 * @returns Redacted object (without metadata)
 */
export function redact<T = any>(obj: T, options?: RedactionOptions): T {
  return redactSensitiveValues(obj, options).value;
}
