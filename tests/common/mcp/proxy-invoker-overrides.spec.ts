import { ProxyInvoker } from '../../../src/common/mcp/proxy-invoker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('ProxyInvoker Overrides', () => {
  let mockClient: jest.Mocked<Client>;
  let invoker: ProxyInvoker;

  beforeEach(() => {
    mockClient = {
      callTool: jest.fn(),
      readResource: jest.fn(),
      getPrompt: jest.fn(),
    } as any;
    // Default settings
    invoker = new ProxyInvoker({
      timeoutMs: 1000,
      failureThreshold: 5,
      resetTimeoutMs: 5000,
    });
  });

  it('should use override timeout', async () => {
    // Mock tool that takes 200ms
    mockClient.callTool.mockImplementation(() => new Promise((resolve) => 
      setTimeout(() => resolve({ content: [], isError: false } as any), 200)
    ));

    // Call with 100ms override timeout - should fail
    await expect(invoker.invoke('test-server', 'test-tool', {}, mockClient, undefined, { timeoutMs: 100 }))
      .rejects.toThrow(/after 100ms/);
    
    // Call with 500ms override timeout - should succeed
    mockClient.callTool.mockClear();
    mockClient.callTool.mockImplementation(() => new Promise((resolve) => 
      setTimeout(() => resolve({ content: [{ type: 'text', text: 'ok' }], isError: false } as any), 200)
    ));
    const result = await invoker.invoke('test-server', 'test-tool', {}, mockClient, undefined, { timeoutMs: 500 });
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' });
  });

  it('should use override failureThreshold', async () => {
    mockClient.callTool.mockRejectedValue(new Error('fail'));

    // Override failureThreshold to 2
    const opts = { failureThreshold: 2 };

    await expect(invoker.invoke('server-2', 'tool', {}, mockClient, undefined, opts)).rejects.toThrow();
    expect(invoker.getCircuitState('server-2').state).toBe('CLOSED');

    await expect(invoker.invoke('server-2', 'tool', {}, mockClient, undefined, opts)).rejects.toThrow();
    expect(invoker.getCircuitState('server-2').state).toBe('OPEN');
  });

  it('should use override resetTimeoutMs', async () => {
    mockClient.callTool.mockRejectedValue(new Error('fail'));
    
    // Open the circuit
    const opts = { failureThreshold: 1, resetTimeoutMs: 200 };
    await expect(invoker.invoke('server-3', 'tool', {}, mockClient, undefined, opts)).rejects.toThrow();
    expect(invoker.getCircuitState('server-3').state).toBe('OPEN');

    // Wait 100ms - should still be OPEN (less than 200ms)
    await new Promise(r => setTimeout(r, 100));
    await expect(invoker.invoke('server-3', 'tool', {}, mockClient, undefined, opts)).rejects.toThrow(/OPEN/);

    // Wait another 150ms (total 250ms) - should be HALF_OPEN
    await new Promise(r => setTimeout(r, 150));
    mockClient.callTool.mockResolvedValue({ content: [], isError: false });
    await invoker.invoke('server-3', 'tool', {}, mockClient, undefined, opts);
    expect(invoker.getCircuitState('server-3').state).toBe('CLOSED');
  });

  it('should support overrides for invokeResource and invokePrompt', async () => {
    mockClient.readResource.mockImplementation(() => new Promise((resolve) => 
      setTimeout(() => resolve({ contents: [] } as any), 200)
    ));
    await expect(invoker.invokeResource('s-res', 'uri', mockClient, undefined, { timeoutMs: 100 }))
      .rejects.toThrow(/after 100ms/);

    mockClient.getPrompt.mockImplementation(() => new Promise((resolve) => 
      setTimeout(() => resolve({ messages: [] } as any), 200)
    ));
    await expect(invoker.invokePrompt('s-prompt', 'p', {}, mockClient, undefined, { timeoutMs: 100 }))
      .rejects.toThrow(/after 100ms/);
  });
});
