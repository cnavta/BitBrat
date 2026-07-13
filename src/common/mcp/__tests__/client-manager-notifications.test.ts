/**
 * Unit tests for McpClientManager notification handling.
 *
 * Verifies that McpClientManager correctly sets up notification handlers, receives
 * notifications from tool-gateway, debounces rapid notifications, and re-discovers
 * tools/resources/prompts when notified.
 *
 * This solves the startup race condition where llm-bot connects before tool-gateway
 * has discovered all Bits.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js';
import { McpClientManager } from '../client-manager';
import { ToolRegistry } from '../../../services/llm-bot/tools/registry';

// Create a consistent logger instance
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// Mock the Bit class
const mockBit: any = {
  getLogger: () => mockLogger,
  getConfig: jest.fn(),
};

describe('McpClientManager Notification Handling', () => {
  let manager: McpClientManager;
  let registry: ToolRegistry;
  let mockClient: any;

  beforeEach(() => {
    // Clear mock logger calls
    jest.clearAllMocks();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();

    registry = new ToolRegistry();
    manager = new McpClientManager(mockBit, registry);

    // Create a mock MCP client
    mockClient = {
      connect: jest.fn(),
      close: jest.fn(),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      listResources: jest.fn().mockResolvedValue({ resources: [] }),
      listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
      setNotificationHandler: jest.fn(),
      getServerCapabilities: jest.fn().mockReturnValue({}),
    };

    // Clear any environment variables that might affect tests
    delete process.env.MCP_NOTIFICATION_DEBOUNCE_MS;
  });

  afterEach(async () => {
    await manager.shutdown();
    jest.clearAllTimers();
  });

  describe('setupNotificationHandlers', () => {
    it('registers handlers for all three notification types', async () => {
      // Create a mock config
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      // Inject the mock client into the manager
      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });

      // Call setupNotificationHandlers
      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      // Verify handlers were registered
      expect(mockClient.setNotificationHandler).toHaveBeenCalledTimes(3);
      expect(mockClient.setNotificationHandler).toHaveBeenCalledWith(
        ToolListChangedNotificationSchema,
        expect.any(Function)
      );
      expect(mockClient.setNotificationHandler).toHaveBeenCalledWith(
        ResourceListChangedNotificationSchema,
        expect.any(Function)
      );
      expect(mockClient.setNotificationHandler).toHaveBeenCalledWith(
        PromptListChangedNotificationSchema,
        expect.any(Function)
      );
    });

    it('logs when handlers are successfully registered', () => {
      (manager as any).clients.set('test-server', mockClient);
      (manager as any).bridges.set('test-server', {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
      });

      (manager as any).setupNotificationHandlers(mockClient, 'test-server', []);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'mcp.client_manager.notification_handlers_registered',
        expect.objectContaining({
          server: 'test-server',
          types: ['tools', 'resources', 'prompts']
        })
      );
    });

    it('handles errors during handler registration gracefully', () => {
      // Make setNotificationHandler throw an error
      mockClient.setNotificationHandler.mockImplementationOnce(() => {
        throw new Error('Handler registration failed');
      });

      (manager as any).clients.set('test-server', mockClient);
      (manager as any).bridges.set('test-server', {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
      });

      // Should not throw
      expect(() => {
        (manager as any).setupNotificationHandlers(mockClient, 'test-server', []);
      }).not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'mcp.client_manager.notification_handlers_failed',
        expect.objectContaining({
          server: 'test-server',
          error: 'Handler registration failed'
        })
      );
    });
  });

  describe('Notification-triggered re-discovery', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('schedules re-discovery when ToolListChangedNotification is received', async () => {
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });

      // Set up handlers
      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      // Get the handler that was registered
      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      // Spy on discoverTools
      const discoverToolsSpy = jest.spyOn(manager as any, 'discoverTools');

      // Trigger the handler
      toolsHandler();

      // Should not call discoverTools immediately (debounced)
      expect(discoverToolsSpy).not.toHaveBeenCalled();

      // Fast-forward past debounce delay (default 500ms)
      jest.advanceTimersByTime(500);

      // Flush all pending promises
      await Promise.resolve();

      // Now it should have called discoverTools (with empty array since that's what setupNotificationHandlers passes)
      expect(discoverToolsSpy).toHaveBeenCalledWith(config.name, []);

      discoverToolsSpy.mockRestore();
    });

    it('debounces rapid successive notifications', async () => {
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });

      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      const discoverToolsSpy = jest.spyOn(manager as any, 'discoverTools').mockResolvedValue(undefined);

      // Trigger handler multiple times rapidly
      await toolsHandler();
      jest.advanceTimersByTime(100);
      await toolsHandler();
      jest.advanceTimersByTime(100);
      await toolsHandler();

      // Fast-forward past final debounce delay
      jest.advanceTimersByTime(500);
      await Promise.resolve();

      // Should only call discoverTools ONCE despite 3 notifications
      expect(discoverToolsSpy).toHaveBeenCalledTimes(1);

      discoverToolsSpy.mockRestore();
    });

    it('respects MCP_NOTIFICATION_DEBOUNCE_MS environment variable', async () => {
      process.env.MCP_NOTIFICATION_DEBOUNCE_MS = '1000';

      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });

      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      const discoverToolsSpy = jest.spyOn(manager as any, 'discoverTools').mockResolvedValue(undefined);

      await toolsHandler();

      // 500ms should not be enough
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      expect(discoverToolsSpy).not.toHaveBeenCalled();

      // 1000ms should trigger it
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      expect(discoverToolsSpy).toHaveBeenCalled();

      discoverToolsSpy.mockRestore();
      delete process.env.MCP_NOTIFICATION_DEBOUNCE_MS;
    });

    it('re-discovers all types (tools, resources, prompts) on any notification', async () => {
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });

      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      const discoverToolsSpy = jest.spyOn(manager as any, 'discoverTools').mockResolvedValue(undefined);
      const discoverResourcesSpy = jest.spyOn(manager as any, 'discoverResources').mockResolvedValue(undefined);
      const discoverPromptsSpy = jest.spyOn(manager as any, 'discoverPrompts').mockResolvedValue(undefined);

      toolsHandler();

      // Advance timers
      jest.advanceTimersByTime(500);

      // Flush all pending promises to ensure async callbacks complete
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // All three should be called
      expect(discoverToolsSpy).toHaveBeenCalled();
      expect(discoverResourcesSpy).toHaveBeenCalled();
      expect(discoverPromptsSpy).toHaveBeenCalled();

      discoverToolsSpy.mockRestore();
      discoverResourcesSpy.mockRestore();
      discoverPromptsSpy.mockRestore();
    });

    it('logs notification receipt and refresh actions', async () => {
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });
      (manager as any).serverTools.set(config.name, ['tool1', 'tool2']);
      (manager as any).serverResources.set(config.name, ['res1']);
      (manager as any).serverPrompts.set(config.name, []);

      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      jest.spyOn(manager as any, 'discoverTools').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'discoverResources').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'discoverPrompts').mockResolvedValue(undefined);

      toolsHandler();

      // Should log receipt
      expect(mockLogger.info).toHaveBeenCalledWith(
        'mcp.client_manager.notification_received',
        expect.objectContaining({
          server: 'tool-gateway',
          type: 'tools',
          debounceMs: 500
        })
      );

      jest.advanceTimersByTime(500);

      // Flush all pending promises to ensure async operations complete
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Should log refresh start
      expect(mockLogger.info).toHaveBeenCalledWith(
        'mcp.client_manager.notification_refresh',
        expect.objectContaining({
          server: 'tool-gateway',
          type: 'tools'
        })
      );

      // Should log refresh complete with counts
      expect(mockLogger.info).toHaveBeenCalledWith(
        'mcp.client_manager.notification_refresh_complete',
        expect.objectContaining({
          server: 'tool-gateway',
          toolCount: 2,
          resourceCount: 1,
          promptCount: 0
        })
      );
    });

    it('logs errors during re-discovery without throwing', async () => {
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
      });

      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      // Make discoverTools throw an error
      jest.spyOn(manager as any, 'discoverTools').mockRejectedValue(new Error('Discovery failed'));

      toolsHandler();
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();

      // Should log error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'mcp.client_manager.notification_refresh_error',
        expect.objectContaining({
          server: 'tool-gateway',
          error: 'Discovery failed'
        })
      );
    });
  });

  describe('Cleanup on shutdown', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('clears pending notification debounce timers', async () => {
      const config = {
        name: 'tool-gateway',
        transport: 'sse' as const,
        url: 'http://tool-gateway:3000/sse',
      };

      (manager as any).clients.set(config.name, mockClient);
      (manager as any).bridges.set(config.name, {
        translateTool: jest.fn((t) => ({ ...t, id: t.name })),
        translateResource: jest.fn((r) => r),
        translatePrompt: jest.fn((p) => ({ ...p, id: p.name })),
      });

      (manager as any).setupNotificationHandlers(mockClient, config.name, []);

      const toolsHandler = mockClient.setNotificationHandler.mock.calls.find(
        (call: any) => call[0] === ToolListChangedNotificationSchema
      )[1];

      const discoverToolsSpy = jest.spyOn(manager as any, 'discoverTools').mockResolvedValue(undefined);

      // Trigger notification (starts debounce timer)
      await toolsHandler();

      // Shutdown before timer expires
      await manager.shutdown();

      // Fast-forward time
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // discoverTools should NOT have been called (timer was cleared)
      expect(discoverToolsSpy).not.toHaveBeenCalled();

      discoverToolsSpy.mockRestore();
    });
  });
});
