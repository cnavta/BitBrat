/**
 * Tests for LokiClient
 */

import { LokiClient } from './loki-client.js';
import { LogRequest } from './types.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('LokiClient', () => {
  let client: LokiClient;

  beforeEach(() => {
    client = new LokiClient({
      url: 'http://localhost:3100',
      timeout: 5000
    });
    jest.clearAllMocks();
  });

  describe('query()', () => {
    it('should build correct LogQL query for basic request', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: []
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot',
        limit: 100
      };

      await client.query(request);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('query=%7Bservice%3D%22llm-bot%22%7D'); // {service="llm-bot"}
      expect(callUrl).toContain('limit=100');
      expect(callUrl).toContain('direction=backward');
    });

    it('should build LogQL query with correlation ID filter', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: []
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot',
        correlationId: 'abc-123'
      };

      await client.query(request);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('correlationId%3D%22abc-123%22'); // correlationId="abc-123"
    });

    it('should build LogQL query with single level filter', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: []
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot',
        level: ['error']
      };

      await client.query(request);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('level%3D%22error%22'); // level="error"
    });

    it('should build LogQL query with multiple level filters', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: []
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot',
        level: ['error', 'warn']
      };

      await client.query(request);

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('level%3D%7E%22error%7Cwarn%22'); // level=~"error|warn" (%7E = ~)
    });

    it('should parse Loki response with JSON logs', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {
                service: 'llm-bot',
                level: 'info'
              },
              values: [
                [
                  '1720000000000000000', // nanosecond timestamp
                  JSON.stringify({
                    ts: '2024-07-03T12:00:00.000Z',
                    level: 'info',
                    msg: 'Test message',
                    correlationId: 'abc-123',
                    service: 'llm-bot'
                  })
                ]
              ]
            }
          ]
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot'
      };

      const logs = await client.query(request);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        timestamp: '2024-07-03T12:00:00.000Z',
        level: 'info',
        service: 'llm-bot',
        message: 'Test message',
        correlationId: 'abc-123'
      });
    });

    it('should parse Loki response with plain text logs', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: {
                service: 'llm-bot',
                level: 'info'
              },
              values: [
                [
                  '1720000000000000000', // nanosecond timestamp
                  'Plain text log message'
                ]
              ]
            }
          ]
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot'
      };

      const logs = await client.query(request);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: 'info',
        service: 'llm-bot',
        message: 'Plain text log message'
      });
    });

    it('should handle Loki HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error'
      });

      const request: LogRequest = {
        bit: 'llm-bot'
      };

      await expect(client.query(request)).rejects.toThrow('Loki HTTP 500');
    });

    it('should handle Loki query timeout', async () => {
      // Create client with short timeout
      const shortTimeoutClient = new LokiClient({
        url: 'http://localhost:3100',
        timeout: 100
      });

      // Mock fetch to simulate abort signal triggering
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, options: any) => {
          return new Promise((_resolve, reject) => {
            // Simulate the abort controller timing out
            setTimeout(() => {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            }, 150);
          });
        }
      );

      const request: LogRequest = {
        bit: 'llm-bot'
      };

      await expect(shortTimeoutClient.query(request)).rejects.toThrow('timeout');
    });

    it('should handle Loki non-success status', async () => {
      const mockResponse = {
        status: 'error',
        data: {
          resultType: 'streams',
          result: []
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: LogRequest = {
        bit: 'llm-bot'
      };

      await expect(client.query(request)).rejects.toThrow('Loki query failed with status: error');
    });

    it('should sort logs by timestamp (newest first)', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { service: 'llm-bot' },
              values: [
                ['1720000000000000000', JSON.stringify({ ts: '2024-07-03T12:00:00.000Z', msg: 'First' })],
                ['1720000001000000000', JSON.stringify({ ts: '2024-07-03T12:00:01.000Z', msg: 'Second' })],
                ['1720000002000000000', JSON.stringify({ ts: '2024-07-03T12:00:02.000Z', msg: 'Third' })]
              ]
            }
          ]
        }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const logs = await client.query({ bit: 'llm-bot' });

      expect(logs).toHaveLength(3);
      expect(logs[0].message).toBe('Third');  // Newest first
      expect(logs[1].message).toBe('Second');
      expect(logs[2].message).toBe('First');
    });
  });

  describe('isAvailable()', () => {
    it('should return true when Loki is healthy', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true
      });

      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3100/ready',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when Loki is unreachable', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when Loki health check fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503
      });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });

    it('should timeout health check after 2 seconds', async () => {
      jest.useFakeTimers();

      const availablePromise = client.isAvailable();

      // Fast-forward 2 seconds
      jest.advanceTimersByTime(2000);

      const available = await availablePromise;

      expect(available).toBe(false);

      jest.useRealTimers();
    });
  });
});
