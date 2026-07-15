import { unwrapMcpErrorMessage, normalizeError } from '../error-utils';

describe('unwrapMcpErrorMessage', () => {
  it('should return original message if no MCP error prefix', () => {
    expect(unwrapMcpErrorMessage('Regular error message')).toBe('Regular error message');
    expect(unwrapMcpErrorMessage('Timeout occurred')).toBe('Timeout occurred');
    expect(unwrapMcpErrorMessage('')).toBe('');
  });

  it('should preserve single MCP error prefix', () => {
    expect(unwrapMcpErrorMessage('MCP error -32603: Internal error')).toBe('MCP error -32603: Internal error');
    expect(unwrapMcpErrorMessage('MCP error -32001: Request timeout')).toBe('MCP error -32001: Request timeout');
    expect(unwrapMcpErrorMessage('MCP error 0: Success')).toBe('MCP error 0: Success');
  });

  it('should unwrap double-nested MCP error prefix', () => {
    expect(unwrapMcpErrorMessage('MCP error -32603: MCP error -32603: Internal error'))
      .toBe('MCP error -32603: Internal error');

    expect(unwrapMcpErrorMessage('MCP error -32001: MCP error -32603: Timeout'))
      .toBe('MCP error -32001: Timeout');
  });

  it('should unwrap deeply nested MCP error prefixes', () => {
    const nested = 'MCP error -32603: '.repeat(100) + 'Original error';
    const unwrapped = unwrapMcpErrorMessage(nested);

    // Should have exactly one prefix
    expect(unwrapped).toBe('MCP error -32603: Original error');
    expect(unwrapped.match(/MCP error -32603:/g)?.length).toBe(1);
  });

  it('should handle mixed error codes in nested messages', () => {
    const nested = 'MCP error -32001: MCP error -32603: MCP error -32002: Core error';
    expect(unwrapMcpErrorMessage(nested)).toBe('MCP error -32001: Core error');
  });

  it('should handle non-string inputs gracefully', () => {
    expect(unwrapMcpErrorMessage(null as any)).toBe(null);
    expect(unwrapMcpErrorMessage(undefined as any)).toBe(undefined);
    expect(unwrapMcpErrorMessage(123 as any)).toBe(123);
  });

  it('should preserve message after MCP error prefix', () => {
    const message = 'MCP error -32603: MCP error -32603: Tool failed: Connection refused';
    expect(unwrapMcpErrorMessage(message)).toBe('MCP error -32603: Tool failed: Connection refused');
  });

  it('should handle MCP error prefix with additional text', () => {
    const message = 'MCP error -32603: MCP error -32603: The server at example.com returned MCP error -500';
    expect(unwrapMcpErrorMessage(message)).toBe('MCP error -32603: The server at example.com returned MCP error -500');
  });
});

describe('normalizeError', () => {
  it('should return Error as-is if message unchanged', () => {
    const error = new Error('Regular error');
    const normalized = normalizeError(error);

    expect(normalized).toBe(error);
    expect(normalized.message).toBe('Regular error');
  });

  it('should unwrap nested MCP error in Error object', () => {
    const error = new Error('MCP error -32603: MCP error -32603: Internal error');
    const normalized = normalizeError(error);

    expect(normalized).not.toBe(error); // New object created
    expect(normalized.message).toBe('MCP error -32603: Internal error');
    expect(normalized.name).toBe('Error');
  });

  it('should preserve error name and stack', () => {
    const error = new TypeError('MCP error -32603: MCP error -32603: Type mismatch');
    const stack = error.stack;
    const normalized = normalizeError(error);

    expect(normalized.name).toBe('TypeError');
    expect(normalized.stack).toBe(stack);
  });

  it('should preserve MCP error code and data', () => {
    const mcpError: any = new Error('MCP error -32603: MCP error -32603: Failed');
    mcpError.code = -32603;
    mcpError.data = { details: 'Connection lost' };

    const normalized: any = normalizeError(mcpError);

    expect(normalized.message).toBe('MCP error -32603: Failed');
    expect(normalized.code).toBe(-32603);
    expect(normalized.data).toEqual({ details: 'Connection lost' });
  });

  it('should wrap non-Error values in Error', () => {
    const normalized1 = normalizeError('string error');
    expect(normalized1).toBeInstanceOf(Error);
    expect(normalized1.message).toBe('string error');

    const normalized2 = normalizeError(42);
    expect(normalized2).toBeInstanceOf(Error);
    expect(normalized2.message).toBe('42');
  });

  it('should handle Error subclasses correctly', () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const error = new CustomError('MCP error -32603: MCP error -32603: Custom failure');
    const normalized = normalizeError(error);

    expect(normalized.name).toBe('CustomError');
    expect(normalized.message).toBe('MCP error -32603: Custom failure');
    expect(Object.getPrototypeOf(normalized)).toBe(CustomError.prototype);
  });

  it('should handle errors with 100+ nested prefixes efficiently', () => {
    const deeplyNested = 'MCP error -32603: '.repeat(150) + 'Core error';
    const error = new Error(deeplyNested);

    const normalized = normalizeError(error);

    expect(normalized.message).toBe('MCP error -32603: Core error');
    expect(normalized.message.length).toBeLessThan(100); // Should be much shorter than original
  });
});
