/**
 * Field Accessor for Reflex Bit
 *
 * Provides JSONPath-like field access for extracting values from event objects.
 * Supports nested object traversal using dot notation.
 *
 * Examples:
 * - 'message.text' → event.message?.text
 * - 'identity.user.displayName' → event.identity?.user?.displayName
 * - 'metadata.custom.field' → event.metadata?.custom?.field
 */

/**
 * Extracts a value from an object using a dot-notation path.
 *
 * Supports nested object traversal with graceful handling of undefined/null values.
 * Returns undefined if any part of the path doesn't exist.
 *
 * @param obj - Object to extract value from (typically an event)
 * @param path - Dot-notation path to the field (e.g., 'message.text', 'identity.user.id')
 * @returns The value at the specified path, or undefined if path doesn't exist
 *
 * @example
 * const event = {
 *   message: { text: 'hello world' },
 *   identity: { user: { id: '123', displayName: 'JohnDoe' } }
 * };
 *
 * getFieldValue(event, 'message.text') // 'hello world'
 * getFieldValue(event, 'identity.user.displayName') // 'JohnDoe'
 * getFieldValue(event, 'nonexistent.field') // undefined
 * getFieldValue(event, 'message.nonexistent') // undefined
 */
export function getFieldValue(obj: any, path: string): any {
  // Handle empty or invalid paths
  if (!path || typeof path !== 'string') {
    return undefined;
  }

  // Handle root-level access (no dots)
  if (!path.includes('.')) {
    return obj?.[path];
  }

  // Split path into segments and traverse
  const segments = path.split('.');
  let current = obj;

  for (const segment of segments) {
    // Return undefined if we hit null/undefined or if property doesn't exist
    if (current == null || typeof current !== 'object') {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

/**
 * Checks if a field path exists in an object (i.e., doesn't return undefined).
 *
 * @param obj - Object to check
 * @param path - Dot-notation path to check
 * @returns true if the path exists and has a defined value
 *
 * @example
 * const event = { message: { text: 'hello' } };
 *
 * hasField(event, 'message.text') // true
 * hasField(event, 'message.nonexistent') // false
 * hasField(event, 'message') // true
 */
export function hasField(obj: any, path: string): boolean {
  return getFieldValue(obj, path) !== undefined;
}

/**
 * Extracts multiple field values from an object.
 *
 * Useful for extracting several fields at once for template interpolation.
 *
 * @param obj - Object to extract values from
 * @param paths - Array of dot-notation paths
 * @returns Object mapping paths to their values (undefined if path doesn't exist)
 *
 * @example
 * const event = {
 *   message: { text: 'hello' },
 *   identity: { user: { displayName: 'John' } }
 * };
 *
 * getMultipleFields(event, ['message.text', 'identity.user.displayName'])
 * // { 'message.text': 'hello', 'identity.user.displayName': 'John' }
 */
export function getMultipleFields(obj: any, paths: string[]): Record<string, any> {
  const result: Record<string, any> = {};

  for (const path of paths) {
    result[path] = getFieldValue(obj, path);
  }

  return result;
}

/**
 * Sets a value in an object using a dot-notation path.
 *
 * Creates intermediate objects as needed.
 * Note: This mutates the original object.
 *
 * @param obj - Object to set value in
 * @param path - Dot-notation path
 * @param value - Value to set
 *
 * @example
 * const obj = {};
 * setFieldValue(obj, 'message.text', 'hello');
 * // obj = { message: { text: 'hello' } }
 */
export function setFieldValue(obj: any, path: string, value: any): void {
  if (!path || typeof path !== 'string') {
    return;
  }

  // Handle root-level setting
  if (!path.includes('.')) {
    obj[path] = value;
    return;
  }

  const segments = path.split('.');
  const lastSegment = segments.pop()!;
  let current = obj;

  // Create intermediate objects
  for (const segment of segments) {
    if (current[segment] == null || typeof current[segment] !== 'object') {
      current[segment] = {};
    }
    current = current[segment];
  }

  current[lastSegment] = value;
}
