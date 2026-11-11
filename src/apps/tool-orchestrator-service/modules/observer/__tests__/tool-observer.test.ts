/**
 * ToolObserver Unit Tests
 *
 * Tests for ToolObserver module using mocked Loki client.
 * Verifies metric aggregation, health derivation, and fail-open behavior.
 *
 * @module tool-orchestrator-service/modules/observer/__tests__
 * @see planning/sprint-59-ig0sr1/execution-plan.md - Task 2.8
 */

import pino from 'pino';
import { ToolObserver } from '../tool-observer';
import { LokiClient } from '../loki-client';
import { ToolHealthStatus } from '../../../types/tool-metrics';

// Mock Loki client
jest.mock('../loki-client');

const MockedLokiClient = LokiClient as jest.MockedClass<typeof LokiClient>;

describe('ToolObserver', () => {
  let observer: ToolObserver;
  let mockClient: jest.Mocked<LokiClient>;
  let logger: pino.Logger;

  beforeEach(() => {
    logger = pino({ level: 'silent' }); // Suppress logs in tests

    // Create mock client instance
    mockClient = {
      queryRange: jest.fn(),
      query: jest.fn(),
      getLabels: jest.fn(),
      getLabelValues: jest.fn(),
      isReady: jest.fn(),
    } as any;

    // Mock the constructor to return our mock instance
    MockedLokiClient.mockImplementation(() => mockClient);

    observer = new ToolObserver(
      {
        url: 'http://localhost:3100',
        timeoutMs: 5000,
        healthyErrorThreshold: 0.05,
        degradedErrorThreshold: 0.20,
      },
      logger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('queryToolMetrics', () => {
    it('should aggregate tool metrics from Loki', async () => {
      // Mock Loki responses
      mockClient.queryRange
        .mockResolvedValueOnce({
          // Total invocations
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '100'] }],
          },
        })
        .mockResolvedValueOnce({
          // Error count
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '5'] }],
          },
        })
        .mockResolvedValueOnce({
          // Denied count
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '2'] }],
          },
        })
        .mockResolvedValueOnce({
          // Latency data
          status: 'success',
          data: {
            resultType: 'streams',
            result: [
              {
                stream: { toolId: 'get_weather' },
                values: [
                  ['1699900000000000', JSON.stringify({ durationMs: 100 })],
                  ['1699900001000000', JSON.stringify({ durationMs: 200 })],
                  ['1699900002000000', JSON.stringify({ durationMs: 150 })],
                  ['1699900003000000', JSON.stringify({ durationMs: 300 })],
                  ['1699900004000000', JSON.stringify({ durationMs: 120 })],
                ],
              },
            ],
          },
        });

      const metrics = await observer.queryToolMetrics('get_weather', {
        start: '2026-11-10T00:00:00Z',
        end: '2026-11-10T01:00:00Z',
      });

      expect(metrics.toolId).toBe('get_weather');
      expect(metrics.totalInvocations).toBe(100);
      expect(metrics.errorCount).toBe(5);
      expect(metrics.deniedCount).toBe(2);
      expect(metrics.successCount).toBe(93);
      expect(metrics.errorRate).toBe(0.05);
      expect(metrics.latency.avg).toBeGreaterThan(0);
    });

    it('should return empty metrics on Loki error (fail-open)', async () => {
      mockClient.queryRange.mockResolvedValue({
        status: 'error',
        data: { resultType: 'streams', result: [] },
        error: 'Loki unavailable',
      });

      const metrics = await observer.queryToolMetrics('get_weather', {
        start: '2026-11-10T00:00:00Z',
        end: '2026-11-10T01:00:00Z',
      });

      expect(metrics.totalInvocations).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('should handle missing data gracefully', async () => {
      mockClient.queryRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'vector', result: [] },
      });

      const metrics = await observer.queryToolMetrics('get_weather', {
        start: '2026-11-10T00:00:00Z',
        end: '2026-11-10T01:00:00Z',
      });

      expect(metrics.totalInvocations).toBe(0);
      expect(metrics.latency.p95).toBe(0);
    });
  });

  describe('queryModelMetrics', () => {
    it('should aggregate model metrics from Loki', async () => {
      mockClient.queryRange
        .mockResolvedValueOnce({
          // Total invocations
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '250'] }],
          },
        })
        .mockResolvedValueOnce({
          // Error count
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '10'] }],
          },
        })
        .mockResolvedValueOnce({
          // Denied count
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '5'] }],
          },
        })
        .mockResolvedValueOnce({
          // Unique tools (grouped by toolId)
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { toolId: 'get_weather' }, value: ['1699900000', '100'] },
              { metric: { toolId: 'search_code' }, value: ['1699900000', '80'] },
              { metric: { toolId: 'send_email' }, value: ['1699900000', '70'] },
            ],
          },
        });

      const metrics = await observer.queryModelMetrics('gpt-4', {
        start: '2026-11-10T00:00:00Z',
        end: '2026-11-10T01:00:00Z',
      });

      expect(metrics.modelId).toBe('gpt-4');
      expect(metrics.totalInvocations).toBe(250);
      expect(metrics.uniqueToolsUsed).toBe(3);
      expect(metrics.errorCount).toBe(10);
      expect(metrics.deniedCount).toBe(5);
      expect(metrics.errorRate).toBe(0.04);
    });

    it('should return empty metrics on error (fail-open)', async () => {
      mockClient.queryRange.mockRejectedValue(new Error('Network error'));

      const metrics = await observer.queryModelMetrics('gpt-4', {
        start: '2026-11-10T00:00:00Z',
        end: '2026-11-10T01:00:00Z',
      });

      expect(metrics.totalInvocations).toBe(0);
      expect(metrics.uniqueToolsUsed).toBe(0);
    });
  });

  describe('traceToolInvocation', () => {
    it('should return chronological invocation events', async () => {
      mockClient.queryRange.mockResolvedValue({
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { correlationId: 'abc-123' },
              values: [
                [
                  '1699900000000000000',
                  JSON.stringify({
                    toolId: 'get_weather',
                    toolName: 'Get Weather',
                    modelId: 'gpt-4',
                    status: 'success',
                    durationMs: 150,
                    correlationId: 'abc-123',
                    rbacDecision: { allowed: true },
                  }),
                ],
                [
                  '1699900001000000000',
                  JSON.stringify({
                    toolId: 'send_email',
                    toolName: 'Send Email',
                    modelId: 'gpt-4',
                    status: 'success',
                    durationMs: 200,
                    correlationId: 'abc-123',
                    rbacDecision: { allowed: true },
                  }),
                ],
              ],
            },
          ],
        },
      });

      const events = await observer.traceToolInvocation('abc-123');

      expect(events).toHaveLength(2);
      expect(events[0].toolId).toBe('get_weather');
      expect(events[1].toolId).toBe('send_email');
      expect(events[0].correlationId).toBe('abc-123');
      expect(events[1].correlationId).toBe('abc-123');
    });

    it('should return empty array on error (fail-open)', async () => {
      mockClient.queryRange.mockResolvedValue({
        status: 'error',
        data: { resultType: 'streams', result: [] },
        error: 'Correlation ID not found',
      });

      const events = await observer.traceToolInvocation('nonexistent');

      expect(events).toEqual([]);
    });

    it('should handle malformed log data gracefully', async () => {
      mockClient.queryRange.mockResolvedValue({
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { correlationId: 'abc-123' },
              values: [
                ['1699900000000000000', 'invalid json'],
                ['1699900001000000000', JSON.stringify({ toolId: 'get_weather' })],
              ],
            },
          ],
        },
      });

      const events = await observer.traceToolInvocation('abc-123');

      // Should only parse the valid entry
      expect(events).toHaveLength(1);
      expect(events[0].toolId).toBe('get_weather');
    });
  });

  describe('getToolHealth', () => {
    it('should return "healthy" when error rate is below threshold', async () => {
      // Mock metrics with low error rate (3%)
      mockClient.queryRange
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '100'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '3'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '0'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'streams', result: [] },
        });

      const health = await observer.getToolHealth('get_weather', 3600000);

      expect(health.status).toBe('healthy');
      expect(health.errorRate).toBe(0.03);
      expect(health.recentInvocations).toBe(100);
    });

    it('should return "degraded" when error rate is elevated', async () => {
      // Mock metrics with 10% error rate
      mockClient.queryRange
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '100'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '10'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '0'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'streams', result: [] },
        });

      const health = await observer.getToolHealth('get_weather', 3600000);

      expect(health.status).toBe('degraded');
      expect(health.errorRate).toBe(0.10);
    });

    it('should return "unhealthy" when error rate exceeds threshold', async () => {
      // Mock metrics with 25% error rate
      mockClient.queryRange
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '100'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '25'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '0'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'streams', result: [] },
        });

      const health = await observer.getToolHealth('get_weather', 3600000);

      expect(health.status).toBe('unhealthy');
      expect(health.errorRate).toBe(0.25);
    });

    it('should return "unknown" when no invocations exist', async () => {
      mockClient.queryRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'vector', result: [] },
      });

      const health = await observer.getToolHealth('get_weather', 3600000);

      expect(health.status).toBe('unknown');
      expect(health.recentInvocations).toBe(0);
    });

    it('should return "unknown" on error (fail-open)', async () => {
      mockClient.queryRange.mockRejectedValue(new Error('Loki unavailable'));

      const health = await observer.getToolHealth('get_weather', 3600000);

      expect(health.status).toBe('unknown');
      // When metrics query fails, it returns empty metrics which triggers "No invocations" message
      expect(health.reason).toContain('No invocations');
    });
  });

  describe('detectAnomalies', () => {
    it('should detect error rate spike', async () => {
      // Mock current metrics: 15% error rate
      mockClient.queryRange
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '100'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699900000', '15'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'vector', result: [] },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'streams', result: [] },
        })
        // Mock baseline metrics: 2% error rate
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699800000', '100'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [{ value: ['1699800000', '2'] }],
          },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'vector', result: [] },
        })
        .mockResolvedValueOnce({
          status: 'success',
          data: { resultType: 'streams', result: [] },
        });

      const anomalies = await observer.detectAnomalies('get_weather', {
        start: '2026-11-10T12:00:00Z',
        end: '2026-11-10T13:00:00Z',
      });

      expect(anomalies.length).toBeGreaterThan(0);
      const errorSpike = anomalies.find((a) => a.type === 'error_spike');
      expect(errorSpike).toBeDefined();
      expect(errorSpike?.multiplier).toBeGreaterThan(3.0);
    });

    it('should return empty array on error (fail-open)', async () => {
      mockClient.queryRange.mockRejectedValue(new Error('Loki unavailable'));

      const anomalies = await observer.detectAnomalies('get_weather', {
        start: '2026-11-10T12:00:00Z',
        end: '2026-11-10T13:00:00Z',
      });

      expect(anomalies).toEqual([]);
    });
  });
});
