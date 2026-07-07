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

import { interpolateTemplate } from './template-interpolator.js';
import { InternalEventV2 } from '../../types/events.js';

/**
 * Builds final tool parameters from a parameter template and event data.
 *
 * Process:
 * 1. Iterate over all keys in the parameter template
 * 2. For string values: Apply template interpolation
 * 3. For non-string values: Preserve as-is (numbers, booleans, objects, arrays)
 * 4. For nested objects: Recursively apply interpolation
 *
 * @param parameterTemplate - Template object with potential {{field.path}} placeholders
 * @param event - Event to extract field values from
 * @returns Fully interpolated parameter object ready for MCP tool invocation
 *
 * @example
 * const template = {
 *   sourceName: "FailOverlay",
 *   visible: true,
 *   sceneName: "{{scene}}",
 *   metadata: {
 *     user: "{{identity.user.displayName}}",
 *     timestamp: "{{ingress.ingressAt}}"
 *   }
 * };
 *
 * buildParameters(template, event)
 * // {
 * //   sourceName: "FailOverlay",
 * //   visible: true,
 * //   sceneName: "MainScene",
 * //   metadata: {
 * //     user: "JohnDoe",
 * //     timestamp: "2026-07-04T12:00:00Z"
 * //   }
 * // }
 */
export function buildParameters(
  parameterTemplate: Record<string, any>,
  event: InternalEventV2
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(parameterTemplate)) {
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
