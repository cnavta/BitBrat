/**
 * Tests for fleet management tools
 */

import { fleetListTool, fleetInfoTool, fleetLogsTool, fleetTraceTool } from '../../tools/fleet';
import { TargetConnection } from '../../types';

// Mock dependencies
jest.mock('../../../fleet/fleet-client');
jest.mock('../../../fleet/transports/gateway-transport');
jest.mock('../../../fleet/firestore-registry');
jest.mock('../../log-retriever');

import { FleetClient } from '../../../fleet/fleet-client';
import { GatewayTransport } from '../../../fleet/transports/gateway-transport';
import { FirestoreRegistryReader } from '../../../fleet/firestore-registry';
import { LogRetriever } from '../../log-retriever';

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

  describe('fleet.logs', () => {
    it('should retrieve logs from a single Bit', async () => {
      // Mock LogRetriever
      const mockLogs = [
        { timestamp: '2026-07-10T12:00:00Z', level: 'info' as const, service: 'llm-bot', message: 'Test log 1' },
        { timestamp: '2026-07-10T12:00:01Z', level: 'error' as const, service: 'llm-bot', message: 'Test error' }
      ];

      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 2,
        logs: mockLogs,
        deploymentType: 'cloud-run'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      // Call the tool
      const result = await fleetLogsTool.handler({ bit: 'llm-bot', limit: 100, format: 'text' }, mockConnection);

      // Verify results
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text content');
      expect(c0.text).toContain('Retrieved 2 log entries');
      expect(c0.text).toContain('llm-bot');
      expect(c0.text).toContain('cloud-run');

      // Verify LogRetriever was called correctly
      expect(mockGetLogs).toHaveBeenCalledWith({
        bit: 'llm-bot',
        level: undefined,
        since: undefined,
        until: undefined,
        limit: 100,
        correlationId: undefined
      });
    });

    it('should handle log retrieval errors', async () => {
      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 0,
        logs: [],
        error: 'Bit not found in registry'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetLogsTool.handler({ bit: 'llm-bot' }, mockConnection);

      expect(result.isError).toBe(true);
      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.error).toBe('Log retrieval failed');
      expect(parsedResult.message).toContain('Bit not found in registry');
    });

    it('should retrieve logs from all Bits in fleet', async () => {
      // Mock FleetClient to return list of Bits
      const mockBits = [
        { name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' },
        { name: 'event-router', profile: 'core', exposure: 'platform-only' }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // Mock LogRetriever
      const mockGetLogs = jest.fn()
        .mockResolvedValueOnce({
          bit: 'llm-bot',
          target: 'test',
          count: 1,
          logs: [{ timestamp: '2026-07-10T12:00:00Z', level: 'info' as const, service: 'llm-bot', message: 'Log from llm-bot' }],
          deploymentType: 'cloud-run'
        })
        .mockResolvedValueOnce({
          bit: 'event-router',
          target: 'test',
          count: 1,
          logs: [{ timestamp: '2026-07-10T12:00:01Z', level: 'info' as const, service: 'event-router', message: 'Log from event-router' }],
          deploymentType: 'docker'
        });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      // Call the tool without specifying a bit (--all mode)
      const result = await fleetLogsTool.handler({ format: 'text' }, mockConnection);

      // Verify results
      expect(result.content).toHaveLength(1);
      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      expect(c0.text).toContain('Fleet-wide log query (2 Bits)');
      expect(c0.text).toContain('Successful: 2, Failed: 0');
      expect(c0.text).toContain('llm-bot');
      expect(c0.text).toContain('event-router');
      expect(c0.text).toContain('Log from llm-bot');
      expect(c0.text).toContain('Log from event-router');

      // Verify transport was closed
      expect(mockTransportClose).toHaveBeenCalled();
    });

    it('should handle partial failures in fleet-wide query', async () => {
      // Mock FleetClient
      const mockBits = [
        { name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' },
        { name: 'down-service', profile: 'core', exposure: 'platform-only' }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // Mock LogRetriever with one success and one failure
      const mockGetLogs = jest.fn()
        .mockResolvedValueOnce({
          bit: 'llm-bot',
          target: 'test',
          count: 1,
          logs: [{ timestamp: '2026-07-10T12:00:00Z', level: 'info' as const, service: 'llm-bot', message: 'Success' }],
          deploymentType: 'cloud-run'
        })
        .mockResolvedValueOnce({
          bit: 'down-service',
          target: 'test',
          count: 0,
          logs: [],
          error: 'Connection timeout'
        });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetLogsTool.handler({}, mockConnection);

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      expect(c0.text).toContain('Successful: 1, Failed: 1');
      expect(c0.text).toContain('=== llm-bot');
      expect(c0.text).toContain('=== Failures ===');
      expect(c0.text).toContain('down-service: Connection timeout');
    });

    it('should support level filtering', async () => {
      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 1,
        logs: [{ timestamp: '2026-07-10T12:00:00Z', level: 'error' as const, service: 'llm-bot', message: 'Error only' }],
        deploymentType: 'cloud-run'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      await fleetLogsTool.handler({ bit: 'llm-bot', level: ['error', 'warn'] }, mockConnection);

      expect(mockGetLogs).toHaveBeenCalledWith({
        bit: 'llm-bot',
        level: ['error', 'warn'],
        since: undefined,
        until: undefined,
        limit: 100,
        correlationId: undefined
      });
    });

    it('should support time range filtering', async () => {
      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 0,
        logs: [],
        deploymentType: 'cloud-run'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      await fleetLogsTool.handler({
        bit: 'llm-bot',
        since: '1h',
        until: '2026-07-10T12:00:00Z'
      }, mockConnection);

      expect(mockGetLogs).toHaveBeenCalledWith({
        bit: 'llm-bot',
        level: undefined,
        since: '1h',
        until: '2026-07-10T12:00:00Z',
        limit: 100,
        correlationId: undefined
      });
    });

    it('should support correlation ID filtering', async () => {
      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 1,
        logs: [{
          timestamp: '2026-07-10T12:00:00Z',
          level: 'info' as const,
          service: 'llm-bot',
          message: 'Correlated log',
          correlationId: 'evt-123'
        }],
        deploymentType: 'cloud-run'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      await fleetLogsTool.handler({ bit: 'llm-bot', correlationId: 'evt-123' }, mockConnection);

      expect(mockGetLogs).toHaveBeenCalledWith({
        bit: 'llm-bot',
        level: undefined,
        since: undefined,
        until: undefined,
        limit: 100,
        correlationId: 'evt-123'
      });
    });

    it('should support json output format', async () => {
      const mockLogs = [
        { timestamp: '2026-07-10T12:00:00Z', level: 'info' as const, service: 'llm-bot', message: 'Test' }
      ];

      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 1,
        logs: mockLogs,
        deploymentType: 'cloud-run'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetLogsTool.handler({ bit: 'llm-bot', format: 'json' }, mockConnection);

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');

      // Should contain formatted JSON
      expect(c0.text).toContain('Retrieved 1 log entries');
      expect(c0.text).toContain('"timestamp": "2026-07-10T12:00:00Z"');
      expect(c0.text).toContain('"level": "info"');
    });

    it('should handle Zod validation errors', async () => {
      const result = await fleetLogsTool.handler({ level: 'invalid-level' }, mockConnection);

      expect(result.isError).toBe(true);
      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      const parsedResult = JSON.parse(c0.text);
      expect(parsedResult.error).toBe('Fleet logs query failed');
      expect(parsedResult.message).toContain('');  // Zod error message
    });
  });

  describe('fleet.trace', () => {
    it('should reconstruct trace from single service', async () => {
      // Mock FleetClient to return one Bit
      const mockBits = [
        { name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // Mock LogRetriever with sequential logs
      const mockLogs = [
        { timestamp: '2026-07-10T12:00:00.000Z', level: 'info' as const, service: 'llm-bot', message: 'Request started' },
        { timestamp: '2026-07-10T12:00:00.100Z', level: 'debug' as const, service: 'llm-bot', message: 'Processing' },
        { timestamp: '2026-07-10T12:00:00.250Z', level: 'info' as const, service: 'llm-bot', message: 'Request completed' }
      ];

      const mockGetLogs = jest.fn().mockResolvedValue({
        bit: 'llm-bot',
        target: 'test',
        count: 3,
        logs: mockLogs,
        deploymentType: 'cloud-run'
      });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      // Call the tool
      const result = await fleetTraceTool.handler({ correlationId: 'evt-123', format: 'timeline' }, mockConnection);

      // Verify results
      expect(result.content).toHaveLength(1);
      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');

      expect(c0.text).toContain('Correlation ID: evt-123');
      expect(c0.text).toContain('Duration: 250ms');
      expect(c0.text).toContain('Services: 1 (llm-bot)');
      expect(c0.text).toContain('00:00:00.000');
      expect(c0.text).toContain('00:00:00.100');
      expect(c0.text).toContain('00:00:00.250');
      expect(c0.text).toContain('Request started');

      // Verify transport was closed
      expect(mockTransportClose).toHaveBeenCalled();
    });

    it('should reconstruct trace from multiple services', async () => {
      // Mock FleetClient with multiple Bits
      const mockBits = [
        { name: 'ingress-egress', profile: 'gateway', exposure: 'platform+domain' },
        { name: 'event-router', profile: 'core', exposure: 'platform-only' },
        { name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // Mock LogRetriever with logs from different services
      const mockGetLogs = jest.fn()
        .mockResolvedValueOnce({
          logs: [
            { timestamp: '2026-07-10T12:00:00.000Z', level: 'info' as const, service: 'ingress-egress', message: 'Event received' }
          ]
        })
        .mockResolvedValueOnce({
          logs: [
            { timestamp: '2026-07-10T12:00:00.012Z', level: 'info' as const, service: 'event-router', message: 'Routing event' },
            { timestamp: '2026-07-10T12:00:00.015Z', level: 'debug' as const, service: 'event-router', message: 'Attached slip' }
          ]
        })
        .mockResolvedValueOnce({
          logs: [
            { timestamp: '2026-07-10T12:00:00.234Z', level: 'info' as const, service: 'llm-bot', message: 'Completed' }
          ]
        });

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetTraceTool.handler({ correlationId: 'evt-456' }, mockConnection);

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');

      expect(c0.text).toContain('Correlation ID: evt-456');
      expect(c0.text).toContain('Duration: 234ms');
      expect(c0.text).toContain('Services: 3 (ingress-egress, event-router, llm-bot)');
      expect(c0.text).toContain('Event received');
      expect(c0.text).toContain('Routing event');
      expect(c0.text).toContain('Attached slip');
      expect(c0.text).toContain('Completed');
    });

    it('should support JSON output format', async () => {
      const mockBits = [{ name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' }];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      const mockLogs = [
        { timestamp: '2026-07-10T12:00:00.000Z', level: 'info' as const, service: 'llm-bot', message: 'Test' }
      ];

      const mockGetLogs = jest.fn().mockResolvedValue({ logs: mockLogs });
      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetTraceTool.handler({ correlationId: 'evt-789', format: 'json' }, mockConnection);

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');

      const parsed = JSON.parse(c0.text);
      expect(parsed.correlationId).toBe('evt-789');
      expect(parsed.duration).toBe(0);
      expect(parsed.services).toEqual(['llm-bot']);
      expect(parsed.timeline).toHaveLength(1);
      expect(parsed.timeline[0].relativeMs).toBe(0);
      expect(parsed.timeline[0].service).toBe('llm-bot');
    });

    it('should handle no logs found', async () => {
      const mockBits = [{ name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' }];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // No logs returned
      const mockGetLogs = jest.fn().mockResolvedValue({ logs: [] });
      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetTraceTool.handler({ correlationId: 'evt-notfound' }, mockConnection);

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      const parsed = JSON.parse(c0.text);
      expect(parsed.error).toBe('No logs found');
      expect(parsed.correlationId).toBe('evt-notfound');
    });

    it('should handle partial failures gracefully', async () => {
      const mockBits = [
        { name: 'llm-bot', profile: 'llm', exposure: 'platform+domain' },
        { name: 'down-service', profile: 'core', exposure: 'platform-only' }
      ];

      const mockTransportClose = jest.fn();
      (GatewayTransport as jest.Mock).mockImplementation(() => ({
        close: mockTransportClose
      }));

      const mockList = jest.fn().mockResolvedValue(mockBits);
      (FleetClient as jest.Mock).mockImplementation(() => ({
        list: mockList
      }));

      // One success, one failure
      const mockGetLogs = jest.fn()
        .mockResolvedValueOnce({
          logs: [
            { timestamp: '2026-07-10T12:00:00.000Z', level: 'info' as const, service: 'llm-bot', message: 'Success' }
          ]
        })
        .mockRejectedValueOnce(new Error('Service unavailable'));

      (LogRetriever as jest.Mock).mockImplementation(() => ({
        getLogs: mockGetLogs
      }));

      const result = await fleetTraceTool.handler({ correlationId: 'evt-partial' }, mockConnection);

      // Should still succeed with logs from available service
      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      expect(c0.text).toContain('Correlation ID: evt-partial');
      expect(c0.text).toContain('Success');
    });

    it('should handle missing correlation ID parameter', async () => {
      const result = await fleetTraceTool.handler({}, mockConnection);

      expect(result.isError).toBe(true);
      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      const parsed = JSON.parse(c0.text);
      expect(parsed.error).toBe('Fleet trace query failed');
      // Zod will complain about missing required field
    });

    it('should handle no gateway configured', async () => {
      const noGatewayConnection = {
        ...mockConnection,
        gateway: undefined
      };

      const result = await fleetTraceTool.handler({ correlationId: 'evt-123' }, noGatewayConnection);

      const c0 = result.content[0];
      if (c0.type !== 'text') throw new Error('Expected text');
      const parsed = JSON.parse(c0.text);
      expect(parsed.error).toBe('No gateway configured');
    });
  });
});
