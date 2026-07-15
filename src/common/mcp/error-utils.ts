/**
 * Utility functions for handling MCP errors
 *
 * Addresses issue where MCP SDK recursively wraps error messages with "MCP error -32603:" prefix
 * when errors propagate through multiple layers (e.g., stdio transport).
 *
 * @see https://github.com/modelcontextprotocol/sdk/issues/XXX (if reported upstream)
 */

/**
 * Pattern to match MCP error prefix: "MCP error -32603: " (or other error codes)
 */
const MCP_ERROR_PREFIX_PATTERN = /^MCP error -?\d+: /;

/**
 * Unwraps recursively nested MCP error messages.
 *
 * When errors propagate through multiple MCP layers (especially stdio transport),
 * the SDK's McpError constructor wraps each message with "MCP error {code}: {message}".
 * If {message} already contains this prefix, we get recursive nesting like:
 * "MCP error -32603: MCP error -32603: MCP error -32603: original message"
 *
 * This function strips all but the OUTERMOST prefix, preserving the error code
 * from the most recent layer while avoiding message bloat.
 *
 * @param message - The potentially nested error message
 * @returns Unwrapped message with only one MCP error prefix (if any)
 *
 * @example
 * unwrapMcpErrorMessage("MCP error -32603: MCP error -32603: Timeout")
 * // Returns: "MCP error -32603: Timeout"
 *
 * unwrapMcpErrorMessage("MCP error -32001: MCP error -32603: Failed")
 * // Returns: "MCP error -32001: Failed"
 *
 * unwrapMcpErrorMessage("Regular error message")
 * // Returns: "Regular error message"
 */
export function unwrapMcpErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return message;
  }

  // Extract the outermost MCP error prefix (if present)
  const match = message.match(MCP_ERROR_PREFIX_PATTERN);
  if (!match) {
    // No MCP error prefix, return as-is
    return message;
  }

  const outerPrefix = match[0]; // e.g., "MCP error -32603: "
  let remaining = message.substring(outerPrefix.length); // Everything after first prefix

  // Recursively strip any additional MCP error prefixes from the remaining message
  while (MCP_ERROR_PREFIX_PATTERN.test(remaining)) {
    const innerMatch = remaining.match(MCP_ERROR_PREFIX_PATTERN);
    if (!innerMatch) break;
    remaining = remaining.substring(innerMatch[0].length);
  }

  // Reconstruct with only the outermost prefix + unwrapped core message
  return outerPrefix + remaining;
}

/**
 * Normalizes an error object by unwrapping nested MCP error messages.
 *
 * Creates a new Error instance with the unwrapped message, preserving:
 * - Original error type (if it extends Error)
 * - Error code (if present on McpError)
 * - Stack trace
 *
 * @param error - The error to normalize
 * @returns Normalized error with unwrapped message
 *
 * @example
 * try {
 *   await mcpClient.callTool(...);
 * } catch (error) {
 *   const normalized = normalizeError(error);
 *   logger.error('Tool call failed', { error: normalized.message });
 * }
 */
export function normalizeError(error: any): Error {
  if (!(error instanceof Error)) {
    // Not an Error object, return as-is or wrap in Error
    return error instanceof Error ? error : new Error(String(error));
  }

  const unwrapped = unwrapMcpErrorMessage(error.message);

  // If message unchanged, return original error
  if (unwrapped === error.message) {
    return error;
  }

  // Create new error with unwrapped message, preserving type if possible
  const normalized = Object.create(Object.getPrototypeOf(error));
  normalized.message = unwrapped;
  normalized.name = error.name;
  normalized.stack = error.stack;

  // Preserve McpError-specific properties
  if ('code' in error) {
    (normalized as any).code = (error as any).code;
  }
  if ('data' in error) {
    (normalized as any).data = (error as any).data;
  }

  return normalized;
}
