import { ProxyInvoker } from '../../../src/common/mcp/proxy-invoker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('ProxyInvoker', () => {
  let mockClient: jest.Mocked<Client>;
  let invoker: ProxyInvoker;

  beforeEach(() => {
    mockClient = {
      callTool: jest.fn(),
    } as any;
    invoker = new ProxyInvoker({
      timeoutMs: 100,
      failureThreshold: 2,
      resetTimeoutMs: 500,
    });
  });

  it('should successfully invoke a tool', async () => {
    mockClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'success' }],
      isError: false,
    });

    const result = await invoker.invoke('test-server', 'test-tool', {}, mockClient);
    expect(result.content[0]).toEqual({ type: 'text', text: 'success' });
    expect(invoker.getCircuitState('test-server').state).toBe('CLOSED');
  });

  it('should time out if tool invocation takes too long', async () => {
    mockClient.callTool.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ content: [], isError: false } as any), 200)));

    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient))
      .rejects.toThrow(/Timeout/);
    
    expect(invoker.getCircuitState('test-server').consecutiveFailures).toBe(1);
  });

  it('should open circuit after multiple failures', async () => {
    mockClient.callTool.mockRejectedValue(new Error('Network error'));

    // 1st failure
    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient)).rejects.toThrow('Network error');
    expect(invoker.getCircuitState('test-server').state).toBe('CLOSED');

    // 2nd failure -> OPEN
    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient)).rejects.toThrow('Network error');
    expect(invoker.getCircuitState('test-server').state).toBe('OPEN');

    // 3rd attempt should fail immediately due to OPEN circuit
    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient))
      .rejects.toThrow(/Circuit breaker is OPEN/);
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    mockClient.callTool.mockRejectedValue(new Error('error'));
    
    // Fail twice to open
    await expect(invoker.invoke('test-server', 'tool', {}, mockClient)).rejects.toThrow();
    await expect(invoker.invoke('test-server', 'tool', {}, mockClient)).rejects.toThrow();
    expect(invoker.getCircuitState('test-server').state).toBe('OPEN');

    // Wait for reset timeout
    await new Promise(r => setTimeout(r, 600));

    // Next call should be allowed (HALF_OPEN attempt)
    mockClient.callTool.mockResolvedValue({ content: [], isError: false });
    await invoker.invoke('test-server', 'tool', {}, mockClient);
    
    expect(invoker.getCircuitState('test-server').state).toBe('CLOSED');
  });

  it('should count tool-reported errors as failures', async () => {
      mockClient.callTool.mockResolvedValue({ isError: true, content: [] });
      await invoker.invoke('test-server', 'tool', {}, mockClient);
      expect(invoker.getCircuitState('test-server').consecutiveFailures).toBe(1);
  });
});
