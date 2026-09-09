/**
 * Parameter Builder for Reflex Bit
 *
 * Builds MCP tool parameters by interpolating template strings with event data.
 * Handles both string interpolation and preservation of non-string values.
 *
 * Example:
 * Template: { sourceName: "FailOverlay", visible: true, scene: "{{scene}}" }
 * Event: { scene: "MainScene" }
 * Result: { sourceName: "FailOverlay", visible: true, scene: "MainScene" }
 */

import { interpolateTemplate, interpolateCapturesInParameters } from './template-interpolator.js';
import { InternalEventV2 } from '../../types/events.js';
import { MatchCaptures } from '../../types/reflex.js';

/**
 * Builds final tool parameters from a parameter template and event data.
 *
 * Process:
 * 1. Apply capture interpolation first (${N} placeholders) if captures provided
 * 2. For string values: Apply event template interpolation ({{field.path}})
 * 3. For non-string values: Preserve as-is (numbers, booleans, objects, arrays)
 * 4. For nested objects: Recursively apply interpolation
 *
 * @param parameterTemplate - Template object with potential {{field.path}} and ${N} placeholders
 * @param event - Event to extract field values from
 * @param captures - Optional captured substrings from pattern matching
 * @returns Fully interpolated parameter object ready for MCP tool invocation
 *
 * @example
 * // Without captures
 * const template = {
 *   sourceName: "FailOverlay",
 *   visible: true,
 *   sceneName: "{{scene}}"
 * };
 * buildParameters(template, event)
 * // { sourceName: "FailOverlay", visible: true, sceneName: "MainScene" }
 *
 * @example
 * // With captures (Sprint 34)
 * const template = {
 *   amount: "${1}",  // Will be coerced to number if pure placeholder
 *   message: "Bid of ${1} placed"  // Will stay string
 * };
 * buildParameters(template, event, { 0: "!bid 50", 1: "50" })
 * // { amount: 50, message: "Bid of 50 placed" }
 */
export function buildParameters(
  parameterTemplate: Record<string, any>,
  event: InternalEventV2,
  captures?: MatchCaptures
): Record<string, any> {
  // Step 1: Apply capture interpolation first (if captures provided)
  let workingTemplate = parameterTemplate;
  if (captures) {
    workingTemplate = interpolateCapturesInParameters(parameterTemplate, captures);
  }

  // Step 2: Apply event field interpolation
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(workingTemplate)) {
    result[key] = interpolateValue(value, event);
  }

  return result;
}

/**
 * Interpolates a single value based on its type.
 *
 * @param value - Value to interpolate (may be string, number, boolean, object, array)
 * @param event - Event to extract field values from
 * @returns Interpolated value
 */
function interpolateValue(value: any, event: InternalEventV2): any {
  // String: Apply template interpolation
  if (typeof value === 'string') {
    return interpolateTemplate(value, event);
  }

  // Array: Recursively interpolate each element
  if (Array.isArray(value)) {
    return value.map(item => interpolateValue(item, event));
  }

  // Object: Recursively interpolate all values
  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateValue(val, event);
    }
    return result;
  }

  // Primitive (number, boolean, null, undefined): Preserve as-is
  return value;
}

/**
 * Validates that a parameter template is well-formed.
 *
 * Checks:
 * - Template is an object
 * - All string values have valid template syntax
 *
 * @param parameterTemplate - Template to validate
 * @returns Validation result with isValid flag and optional errors
 *
 * @example
 * validateParameterTemplate({ name: "{{user.name}}" })
 * // { isValid: true }
 *
 * validateParameterTemplate({ name: "{{invalid" })
 * // { isValid: false, errors: ['...'] }
 */
export function validateParameterTemplate(parameterTemplate: any): {
  isValid: boolean;
  errors?: string[];
} {
  if (parameterTemplate === null || typeof parameterTemplate !== 'object' || Array.isArray(parameterTemplate)) {
    return {
      isValid: false,
      errors: ['Parameter template must be an object'],
    };
  }

  const errors: string[] = [];

  // Recursively check all string values
  const checkValue = (value: any, path: string) => {
    if (typeof value === 'string') {
      // Basic validation: Check for unmatched braces
      const openCount = (value.match(/(?<!\\)\{\{/g) || []).length;
      const closeCount = (value.match(/(?<!\\)\}\}/g) || []).length;

      if (openCount !== closeCount) {
        errors.push(`${path}: Unmatched braces in template "${value}"`);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        checkValue(val, `${path}.${key}`);
      }
    }
  };

  for (const [key, value] of Object.entries(parameterTemplate)) {
    checkValue(value, key);
  }

  return {
    isValid: errors.length === 0,
    ...(errors.length > 0 && { errors }),
  };
}
