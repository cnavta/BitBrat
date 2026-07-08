/**
 * Tests for fleet management tools
 */

import { fleetListTool, fleetInfoTool } from '../../tools/fleet';
import { TargetConnection } from '../../types';

// Mock dependencies
jest.mock('../../../fleet/fleet-client');
jest.mock('../../../fleet/transports/gateway-transport');
jest.mock('../../../fleet/firestore-registry');

import { FleetClient } from '../../../fleet/fleet-client';
import { GatewayTransport } from '../../../fleet/transports/gateway-transport';
import { FirestoreRegistryReader } from '../../../fleet/firestore-registry';

describe('Fleet Tools', () => {
  let mockConnection: TargetConnection;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock connection
    mockConnection = {
      name: 'test',
      type: 'local',
      firestore: {
        db: {} as any,
        projectId: 'test-project',
        databaseId: '(default)'
      },
      gateway: {
        url: 'http://localhost:3000',
        authToken: 'test-token'
      },
      cleanup: jest.fn()
    };
  });

  describe('fleet.list', () => {
    it('should enumerate all Bits in the fleet', async () => {
      // Mock fleet client responses
      const mockBits = [
        { name: 'auth', profile: 'core', exposure: 'platform-only', platformOnly: true },
        { name: 'llm-bot', profile: 'llm', exposure: 'platform+domain', platformOnly: false }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // Call the tool
      const result = await fleetListTool.handler({}, mockConnection);

      // Verify results
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const content = result.content[0];
      if (content.type !== 'text') throw new Error('Expected text content');
      const parsedResult = JSON.parse(content.text);
      expect(parsedResult.target).toBe('test');
      expect(parsedResult.count).toBe(2);
      expect(parsedResult.bits).toHaveLength(2);
      expect(parsedResult.bits[0].name).toBe('auth');
      expect(parsedResult.bits[1].name).toBe('llm-bot');

      // Verify cleanup
      expect(mockTransportClose).toHaveBeenCalled();
    });

    it('should return error when no gateway is configured', async () => {
      const noGatewayConnection = {
        ...mockConnection,
        gateway: undefined
      };

      const result = await fleetListTool.handler({}, noGatewayConnection);

      expect(result.content[0].type).toBe('text');
      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.error).toBe('No gateway configured');
    });

    it('should handle fleet discovery errors gracefully', async () => {
      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockRejectedValue(new Error('Gateway unreachable'));
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      const result = await fleetListTool.handler({}, mockConnection);

      expect(result.isError).toBe(true);
      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.error).toBe('Fleet discovery failed');
      expect(parsedResult.message).toContain('Gateway unreachable');
    });
  });

  describe('fleet.info', () => {
    it('should get info for a specific Bit', async () => {
      const mockInfo = {
        name: 'auth',
        version: '1.0.0',
        uptime: 3600,
        profile: 'core'
      };

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockCall = jest.fn().mockResolvedValue(mockInfo);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        call: mockCall
      }));

      const result = await fleetInfoTool.handler({ bit: 'auth' }, mockConnection);

      expect(result.content).toHaveLength(1);
      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.bit).toBe('auth');
      expect(parsedResult.info).toEqual(mockInfo);

      // Verify bit.info was called correctly
      expect(mockCall).toHaveBeenCalledWith('auth', 'bit.info', {});
    });

    it('should get info for all Bits when no bit specified', async () => {
      const mockResults = [
        { bit: 'auth', ok: true, result: { name: 'auth', version: '1.0.0' } },
        { bit: 'llm-bot', ok: true, result: { name: 'llm-bot', version: '2.0.0' } }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockCallAll = jest.fn().mockResolvedValue(mockResults);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        callAll: mockCallAll
      }));

      const result = await fleetInfoTool.handler({}, mockConnection);

      expect(result.content).toHaveLength(1);
      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.count).toBe(2);
      expect(parsedResult.bits).toHaveLength(2);
      expect(parsedResult.bits[0].bit).toBe('auth');
      expect(parsedResult.bits[1].bit).toBe('llm-bot');

      // Verify bit.info was called for all Bits
      expect(mockCallAll).toHaveBeenCalledWith('bit.info', {});
    });

    it('should handle partial failures in --all mode', async () => {
      const mockResults = [
        { bit: 'auth', ok: true, result: { name: 'auth', version: '1.0.0' } },
        { bit: 'down-service', ok: false, error: 'connect ECONNREFUSED', status: 'unreachable' }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockCallAll = jest.fn().mockResolvedValue(mockResults);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        callAll: mockCallAll
      }));

      const result = await fleetInfoTool.handler({}, mockConnection);

      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.bits[0].ok).toBe(true);
      expect(parsedResult.bits[1].ok).toBe(false);
      expect(parsedResult.bits[1].status).toBe('unreachable');
    });

    it('should handle single Bit call failures', async () => {
      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockCall = jest.fn().mockRejectedValue(new Error('Tool not found'));
      (FleetClient as jest.Mock).mockImplementation(() => ({
        call: mockCall
      }));

      const result = await fleetInfoTool.handler({ bit: 'missing' }, mockConnection);

      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.bit).toBe('missing');
      expect(parsedResult.error).toContain('Tool not found');
      expect(parsedResult.status).toBe('failed');
    });

    it('should return error when no gateway is configured', async () => {
      const noGatewayConnection = {
        ...mockConnection,
        gateway: undefined
      };

      const result = await fleetInfoTool.handler({ bit: 'auth' }, noGatewayConnection);

      const c0 = result.content[0]; if (c0.type !== "text") throw new Error("Expected text"); const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.error).toBe('No gateway configured');
    });
  });
});
