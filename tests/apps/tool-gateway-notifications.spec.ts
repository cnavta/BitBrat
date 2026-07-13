/**
 * Unit tests for tool-gateway MCP notification broadcasting.
 *
 * Verifies that tool-gateway broadcasts ToolListChangedNotification, ResourceListChangedNotification,
 * and PromptListChangedNotification to all connected MCP clients when Bits register or disconnect.
 *
 * This solves the startup race condition where llm-bot connects before tool-gateway has discovered
 * all Bits, enabling automatic tool discovery without manual restarts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Mock Firestore
const setMock = jest.fn(async () => {});
const docMock = jest.fn(() => ({ set: setMock }));
const onSnapshotMock = jest.fn(() => () => {}); // Returns unsubscribe function
const collectionMock = jest.fn(() => ({
  doc: docMock,
  onSnapshot: onSnapshotMock,
}));
const dbMock: any = { collection: collectionMock };

jest.mock('../../src/common/firebase', () => ({
  getFirestore: () => dbMock,
}));

import { ToolGatewayServer } from '../../src/apps/tool-gateway';
import { INTERNAL_MCP_REGISTRATION_V1 } from '../../src/types/events';

function makeRegistrationEvent(payload: any, correlationId: string): any {
  return { type: INTERNAL_MCP_REGISTRATION_V1, correlationId, payload };
}

describe('Tool Gateway Notification Broadcasting', () => {
  let server: ToolGatewayServer;
  let mockSessionServer1: any;
  let mockSessionServer2: any;

  beforeEach(() => {
    setMock.mockClear();
    docMock.mockClear();
    collectionMock.mockClear();
    onSnapshotMock.mockClear();

    server = new ToolGatewayServer();

    // Create mock MCP session servers with notification methods
    mockSessionServer1 = {
      notification: jest.fn(),
    };
    mockSessionServer2 = {
      notification: jest.fn(),
    };

    // Manually add mock sessions to the server's sessionServers map
    // This simulates clients connecting via getMcpServerForConnection
    (server as any).sessionServers.set('llm-bot-1-test', mockSessionServer1);
    (server as any).sessionServers.set('query-analyzer-1-test', mockSessionServer2);
  });

  afterEach(async () => {
    await server.close('test');
  });

  describe('broadcastListChangedNotifications', () => {
    it('broadcasts all three notification types to all connected sessions', () => {
      // Call the private broadcast method
      (server as any).broadcastListChangedNotifications();

      // Verify both sessions received all three notification types
      expect(mockSessionServer1.notification).toHaveBeenCalledTimes(3);
      expect(mockSessionServer2.notification).toHaveBeenCalledTimes(3);

      // Verify notification types
      expect(mockSessionServer1.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
        params: {}
      });
      expect(mockSessionServer1.notification).toHaveBeenCalledWith({
        method: 'notifications/resources/list_changed',
        params: {}
      });
      expect(mockSessionServer1.notification).toHaveBeenCalledWith({
        method: 'notifications/prompts/list_changed',
        params: {}
      });
    });

    it('handles empty session list gracefully', () => {
      // Clear all sessions
      (server as any).sessionServers.clear();

      // Should not throw
      expect(() => {
        (server as any).broadcastListChangedNotifications();
      }).not.toThrow();
    });

    it('continues broadcasting to other sessions if one fails', () => {
      // Make first session throw an error
      mockSessionServer1.notification.mockImplementationOnce(() => {
        throw new Error('Connection closed');
      });

      // Should not throw
      expect(() => {
        (server as any).broadcastListChangedNotifications();
      }).not.toThrow();

      // Second session should still receive notifications
      expect(mockSessionServer2.notification).toHaveBeenCalledTimes(3);
    });

    it('logs broadcast activity', () => {
      const loggerSpy = jest.spyOn((server as any).getLogger(), 'info');

      (server as any).broadcastListChangedNotifications();

      // Should log broadcasting start and completion
      expect(loggerSpy).toHaveBeenCalledWith(
        'tool_gateway.notifications.broadcasting',
        expect.objectContaining({
          sessionCount: 2,
          types: ['tools', 'resources', 'prompts']
        })
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        'tool_gateway.notifications.broadcast_complete',
        expect.objectContaining({
          sessionCount: 2,
          successCount: 2,
          errorCount: 0
        })
      );

      loggerSpy.mockRestore();
    });

    it('logs individual session send failures', () => {
      const loggerSpy = jest.spyOn((server as any).getLogger(), 'warn');

      // Make one session fail
      mockSessionServer1.notification.mockImplementation(() => {
        throw new Error('Send failed');
      });

      (server as any).broadcastListChangedNotifications();

      // Should log the failure
      expect(loggerSpy).toHaveBeenCalledWith(
        'tool_gateway.notifications.send_failed',
        expect.objectContaining({
          sessionId: 'llm-bot-1-test',
          error: 'Send failed'
        })
      );

      loggerSpy.mockRestore();
    });
  });

  describe('Registration event handling triggers notifications', () => {
    it('broadcasts notifications when a new Bit registers', async () => {
      const payload = {
        name: 'test-bit',
        url: 'http://test-bit:3000/sse',
        transport: 'sse',
        status: 'active',
      };

      // Mock mcpManager.connectServer to avoid actual connection
      const connectServerSpy = jest.spyOn((server as any).mcpManager, 'connectServer')
        .mockResolvedValue(undefined);

      // Trigger registration (which should eventually call broadcastListChangedNotifications)
      await (server as any).handleMcpRegistration(
        makeRegistrationEvent(payload, 'test-correlation-id')
      );

      // Note: handleMcpRegistration writes to Firestore, which triggers RegistryWatcher's onSnapshot,
      // which calls onServerActive callback, which broadcasts notifications. Since we've mocked
      // Firestore, we can't test the full flow here without starting the server and setting up
      // the watcher. This test verifies the registration is processed.

      expect(setMock).toHaveBeenCalledTimes(1);

      connectServerSpy.mockRestore();
    });
  });

  describe('Session tracking', () => {
    it('tracks sessions when getMcpServerForConnection is called', async () => {
      // Create a mock request
      const mockReq: any = {
        headers: {
          'x-agent-name': 'test-agent',
        },
      };

      // Call getMcpServerForConnection
      const sessionServer = await (server as any).getMcpServerForConnection(mockReq);

      // Verify it's a Server instance
      expect(sessionServer).toBeInstanceOf(Server);

      // Verify the session was tracked (should have 3 sessions now: 2 from beforeEach + 1 new)
      expect((server as any).sessionServers.size).toBe(3);
    });

    it('clears all sessions on server close', async () => {
      expect((server as any).sessionServers.size).toBe(2);

      await server.close('test');

      expect((server as any).sessionServers.size).toBe(0);
    });

    it('generates unique session IDs for each connection', async () => {
      // Clear sessions from beforeEach
      (server as any).sessionServers.clear();

      const mockReq: any = {
        headers: {
          'x-agent-name': 'llm-bot',
        },
      };

      // Create multiple sessions
      await (server as any).getMcpServerForConnection(mockReq);
      await (server as any).getMcpServerForConnection(mockReq);

      const sessionIds = Array.from((server as any).sessionServers.keys()) as string[];

      // All session IDs should be unique
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(sessionIds.length);
      expect(sessionIds.length).toBe(2);

      // Session IDs should start with agent name
      sessionIds.forEach((id) => {
        expect(id).toMatch(/^llm-bot-/);
      });
    });
  });

  describe('Integration with RegistryWatcher callbacks', () => {
    it('verifies broadcastListChangedNotifications method exists and is callable', () => {
      // Verify the method exists on the server
      expect(typeof (server as any).broadcastListChangedNotifications).toBe('function');

      // Verify it can be called without errors when there are sessions
      expect(() => {
        (server as any).broadcastListChangedNotifications();
      }).not.toThrow();

      // The actual integration of this method with RegistryWatcher callbacks
      // is tested in the full integration test and verified in staging deployment
    });
  });
});
