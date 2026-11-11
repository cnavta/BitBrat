/**
 * ToolObserver Implementation
 *
 * Queries Loki for tool and model metrics, health status, and anomaly detection.
 * All methods fail-open (return degraded results on Loki unavailability).
 *
 * @module tool-orchestrator-service/modules/observer
 * @see planning/sprint-59-ig0sr1/execution-plan.md - Task 2
 */

import { Logger } from 'pino';
import { randomUUID } from 'crypto';
import { IToolObserver } from './tool-observer.interface';
import { LokiClient, LokiClientConfig } from './loki-client';
import {
  TimeRange,
  ToolMetrics,
  ModelMetrics,
  ToolHealth,
  ToolHealthStatus,
  Anomaly,
  AnomalySeverity,
  InvocationEvent,
  LatencyPercentiles,
} from '../../types/tool-metrics';

/**
 * ToolObserver configuration
 */
export interface ToolObserverConfig extends LokiClientConfig {
  /** Default health check window in milliseconds (default: 3600000 = 1 hour) */
  defaultHealthWindowMs?: number;

  /** Error rate threshold for 'healthy' status (default: 0.05 = 5%) */
  healthyErrorThreshold?: number;

  /** Error rate threshold for 'degraded' status (default: 0.20 = 20%) */
  degradedErrorThreshold?: number;

  /** Anomaly detection: error spike multiplier (default: 3.0 = 3x baseline) */
  errorSpikeMultiplier?: number;

  /** Anomaly detection: latency spike multiplier (default: 2.0 = 2x P95 baseline) */
  latencySpikeMultiplier?: number;
}

/**
 * ToolObserver implementation
 *
 * Queries Loki via LogQL to provide tool observability metrics.
 * Implements fail-open pattern: errors are logged but never thrown.
 */
export class ToolObserver implements IToolObserver {
  private readonly logger: Logger;
  private readonly client: LokiClient;
  private readonly config: Required<ToolObserverConfig>;

  constructor(config: ToolObserverConfig, logger: Logger) {
    this.logger = logger;
    this.client = new LokiClient(config, logger);
    this.config = {
      url: config.url,
      timeoutMs: config.timeoutMs ?? 10000,
      cacheResults: config.cacheResults ?? false,
      defaultHealthWindowMs: config.defaultHealthWindowMs ?? 3600000, // 1 hour
      healthyErrorThreshold: config.healthyErrorThreshold ?? 0.05,
      degradedErrorThreshold: config.degradedErrorThreshold ?? 0.20,
      errorSpikeMultiplier: config.errorSpikeMultiplier ?? 3.0,
      latencySpikeMultiplier: config.latencySpikeMultiplier ?? 2.0,
    };

    this.logger.info({ lokiUrl: config.url, defaultHealthWindowMs: this.config.defaultHealthWindowMs }, 'tool_observer.initialized');
  }

  /**
   * Query tool metrics from Loki event stream
   */
  async queryToolMetrics(
    toolId: string,
    timeRange: TimeRange
  ): Promise<ToolMetrics> {
    this.logger.debug({ toolId, timeRange }, 'tool_observer.query_tool_metrics.start');

    try {
      // Query 1: Count total invocations
      const totalQuery = `count_over_time({service="tool-orchestrator", eventType="tool.invocation", toolId="${toolId}"}[${this.getLogQLDuration(timeRange)}])`;
      const totalResult = await this.client.queryRange({
        query: totalQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const totalInvocations = this.extractScalarValue(totalResult);

      // Query 2: Count errors
      const errorQuery = `count_over_time({service="tool-orchestrator", eventType="tool.invocation", toolId="${toolId}", status="error"}[${this.getLogQLDuration(timeRange)}])`;
      const errorResult = await this.client.queryRange({
        query: errorQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const errorCount = this.extractScalarValue(errorResult);

      // Query 3: Count denied
      const deniedQuery = `count_over_time({service="tool-orchestrator", eventType="tool.invocation", toolId="${toolId}", status="denied"}[${this.getLogQLDuration(timeRange)}])`;
      const deniedResult = await this.client.queryRange({
        query: deniedQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const deniedCount = this.extractScalarValue(deniedResult);

      // Query 4: Latency percentiles
      const latencyQuery = `{service="tool-orchestrator", eventType="tool.invocation", toolId="${toolId}"} | json | unwrap durationMs`;
      const latencyResult = await this.client.queryRange({
        query: latencyQuery,
        start: timeRange.start,
        end: timeRange.end,
        limit: 10000, // Sample size for percentile calculation
      });

      const latency = this.calculateLatencyPercentiles(latencyResult);

      // Calculate derived metrics
      const successCount = totalInvocations - errorCount - deniedCount;
      const errorRate = totalInvocations > 0 ? errorCount / totalInvocations : 0;

      const metrics: ToolMetrics = {
        toolId,
        toolName: toolId, // TODO: Look up from registry
        totalInvocations,
        successCount,
        errorCount,
        deniedCount,
        errorRate,
        latency,
        timeRange,
      };

      this.logger.debug({ toolId, totalInvocations, errorRate }, 'tool_observer.query_tool_metrics.success');

      return metrics;
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack, toolId }, 'tool_observer.query_tool_metrics.error');

      // Fail-open: return empty metrics
      return this.getEmptyToolMetrics(toolId, timeRange);
    }
  }

  /**
   * Query model metrics from Loki event stream
   */
  async queryModelMetrics(
    modelId: string,
    timeRange: TimeRange
  ): Promise<ModelMetrics> {
    this.logger.debug({ modelId, timeRange }, 'tool_observer.query_model_metrics.start');

    try {
      // Query 1: Count total invocations
      const totalQuery = `count_over_time({service="tool-orchestrator", eventType="tool.invocation", modelId="${modelId}"}[${this.getLogQLDuration(timeRange)}])`;
      const totalResult = await this.client.queryRange({
        query: totalQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const totalInvocations = this.extractScalarValue(totalResult);

      // Query 2: Count errors
      const errorQuery = `count_over_time({service="tool-orchestrator", eventType="tool.invocation", modelId="${modelId}", status="error"}[${this.getLogQLDuration(timeRange)}])`;
      const errorResult = await this.client.queryRange({
        query: errorQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const errorCount = this.extractScalarValue(errorResult);

      // Query 3: Count denied
      const deniedQuery = `count_over_time({service="tool-orchestrator", eventType="tool.invocation", modelId="${modelId}", status="denied"}[${this.getLogQLDuration(timeRange)}])`;
      const deniedResult = await this.client.queryRange({
        query: deniedQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const deniedCount = this.extractScalarValue(deniedResult);

      // Query 4: Count unique tools (using label values API)
      const toolsQuery = `sum by (toolId) (count_over_time({service="tool-orchestrator", eventType="tool.invocation", modelId="${modelId}"}[${this.getLogQLDuration(timeRange)}]))`;
      const toolsResult = await this.client.queryRange({
        query: toolsQuery,
        start: timeRange.start,
        end: timeRange.end,
      });

      const uniqueToolsUsed = toolsResult.data.result?.length ?? 0;

      // Calculate derived metrics
      const successCount = totalInvocations - errorCount - deniedCount;
      const errorRate = totalInvocations > 0 ? errorCount / totalInvocations : 0;

      const metrics: ModelMetrics = {
        modelId,
        modelName: modelId, // TODO: Look up from registry
        totalInvocations,
        uniqueToolsUsed,
        successCount,
        errorCount,
        deniedCount,
        errorRate,
        timeRange,
      };

      this.logger.debug({ modelId, totalInvocations, uniqueToolsUsed }, 'tool_observer.query_model_metrics.success');

      return metrics;
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack, modelId }, 'tool_observer.query_model_metrics.error');

      // Fail-open: return empty metrics
      return this.getEmptyModelMetrics(modelId, timeRange);
    }
  }

  /**
   * Trace tool invocation by correlation ID
   */
  async traceToolInvocation(correlationId: string): Promise<InvocationEvent[]> {
    this.logger.debug({ correlationId }, 'tool_observer.trace_invocation.start');

    try {
      // Query all events with this correlationId
      const query = `{correlationId="${correlationId}", eventType="tool.invocation"} | json`;
      const result = await this.client.queryRange({
        query,
        start: new Date(Date.now() - 86400000).toISOString(), // Last 24 hours
        end: new Date().toISOString(),
        limit: 1000,
        direction: 'forward', // Chronological order
      });

      if (result.status === 'error' || !result.data.result) {
        this.logger.warn({ correlationId }, 'tool_observer.trace_invocation.no_results');
        return [];
      }

      const events: InvocationEvent[] = [];

      for (const stream of result.data.result) {
        if (!stream.values) continue;

        for (const [timestampNs, logLine] of stream.values) {
          try {
            const logData = JSON.parse(logLine);
            const event = this.parseInvocationEvent(logData, timestampNs);
            if (event) {
              events.push(event);
            }
          } catch (parseError) {
            this.logger.warn({ error: (parseError as Error).message, logLine: logLine.substring(0, 200) }, 'tool_observer.trace_invocation.parse_error');
          }
        }
      }

      // Sort by timestamp (should already be sorted, but ensure)
      events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      this.logger.debug({ correlationId, eventCount: events.length }, 'tool_observer.trace_invocation.success');

      return events;
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack, correlationId }, 'tool_observer.trace_invocation.error');

      return [];
    }
  }

  /**
   * Get tool health status
   */
  async getToolHealth(
    toolId: string,
    windowMs = this.config.defaultHealthWindowMs
  ): Promise<ToolHealth> {
    this.logger.debug({ toolId, windowMs }, 'tool_observer.get_health.start');

    try {
      const end = new Date();
      const start = new Date(end.getTime() - windowMs);

      const metrics = await this.queryToolMetrics(toolId, {
        start: start.toISOString(),
        end: end.toISOString(),
      });

      // Derive health status
      let status: ToolHealthStatus;
      let reason: string;

      if (metrics.totalInvocations === 0) {
        status = 'unknown';
        reason = `No invocations in last ${Math.floor(windowMs / 60000)} minutes`;
      } else if (metrics.errorRate < this.config.healthyErrorThreshold) {
        status = 'healthy';
        reason = `Error rate ${(metrics.errorRate * 100).toFixed(2)}% below threshold`;
      } else if (metrics.errorRate < this.config.degradedErrorThreshold) {
        status = 'degraded';
        reason = `Error rate ${(metrics.errorRate * 100).toFixed(2)}% elevated`;
      } else {
        status = 'unhealthy';
        reason = `Error rate ${(metrics.errorRate * 100).toFixed(2)}% exceeds threshold`;
      }

      const health: ToolHealth = {
        toolId,
        toolName: toolId,
        status,
        reason,
        errorRate: metrics.errorRate,
        recentInvocations: metrics.totalInvocations,
        lastInvocationAt: metrics.lastInvocationAt,
        lastSuccessAt: metrics.lastSuccessAt,
        lastErrorAt: metrics.lastErrorAt,
        avgLatency: metrics.latency.avg,
        windowMs,
        checkedAt: new Date().toISOString(),
      };

      this.logger.debug({ toolId, status, errorRate: metrics.errorRate }, 'tool_observer.get_health.success');

      return health;
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack, toolId }, 'tool_observer.get_health.error');

      // Fail-open: return unknown health
      return {
        toolId,
        toolName: toolId,
        status: 'unknown',
        reason: `Health check failed: ${err.message}`,
        errorRate: 0,
        recentInvocations: 0,
        avgLatency: 0,
        windowMs,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Detect anomalies in tool invocation patterns
   */
  async detectAnomalies(
    toolId: string,
    timeRange: TimeRange,
    baselineRange?: TimeRange
  ): Promise<Anomaly[]> {
    this.logger.debug({ toolId, timeRange, baselineRange }, 'tool_observer.detect_anomalies.start');

    try {
      // Query current metrics
      const currentMetrics = await this.queryToolMetrics(toolId, timeRange);

      // Query baseline metrics (default: same duration before current window)
      let baselineMetrics: ToolMetrics;
      if (baselineRange) {
        baselineMetrics = await this.queryToolMetrics(toolId, baselineRange);
      } else {
        // Auto-calculate baseline: same duration before current window
        const duration = new Date(timeRange.end).getTime() - new Date(timeRange.start).getTime();
        const baselineStart = new Date(new Date(timeRange.start).getTime() - duration);
        const baselineEnd = new Date(timeRange.start);

        baselineMetrics = await this.queryToolMetrics(toolId, {
          start: baselineStart.toISOString(),
          end: baselineEnd.toISOString(),
        });
      }

      const anomalies: Anomaly[] = [];

      // Anomaly 1: Error rate spike
      if (
        baselineMetrics.errorRate > 0 &&
        currentMetrics.errorRate >= baselineMetrics.errorRate * this.config.errorSpikeMultiplier
      ) {
        anomalies.push({
          id: randomUUID(),
          toolId,
          toolName: toolId,
          type: 'error_spike',
          severity: currentMetrics.errorRate > 0.5 ? 'critical' : 'warning',
          description: `Error rate spiked to ${(currentMetrics.errorRate * 100).toFixed(2)}% (baseline: ${(baselineMetrics.errorRate * 100).toFixed(2)}%)`,
          currentValue: currentMetrics.errorRate,
          baselineValue: baselineMetrics.errorRate,
          multiplier: currentMetrics.errorRate / baselineMetrics.errorRate,
          detectedAt: new Date().toISOString(),
          timeRange,
        });
      }

      // Anomaly 2: Latency spike
      if (
        baselineMetrics.latency.p95 > 0 &&
        currentMetrics.latency.p95 >= baselineMetrics.latency.p95 * this.config.latencySpikeMultiplier
      ) {
        anomalies.push({
          id: randomUUID(),
          toolId,
          toolName: toolId,
          type: 'latency_spike',
          severity: currentMetrics.latency.p95 > 10000 ? 'critical' : 'warning',
          description: `P95 latency spiked to ${currentMetrics.latency.p95.toFixed(0)}ms (baseline: ${baselineMetrics.latency.p95.toFixed(0)}ms)`,
          currentValue: currentMetrics.latency.p95,
          baselineValue: baselineMetrics.latency.p95,
          multiplier: currentMetrics.latency.p95 / baselineMetrics.latency.p95,
          detectedAt: new Date().toISOString(),
          timeRange,
        });
      }

      // Anomaly 3: No invocations (when baseline had invocations)
      if (baselineMetrics.totalInvocations > 10 && currentMetrics.totalInvocations === 0) {
        anomalies.push({
          id: randomUUID(),
          toolId,
          toolName: toolId,
          type: 'no_invocations',
          severity: 'warning',
          description: `No invocations detected (baseline: ${baselineMetrics.totalInvocations} invocations)`,
          currentValue: 0,
          baselineValue: baselineMetrics.totalInvocations,
          multiplier: 0,
          detectedAt: new Date().toISOString(),
          timeRange,
        });
      }

      // Sort by severity (critical first)
      anomalies.sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      });

      this.logger.debug({ toolId, anomalyCount: anomalies.length }, 'tool_observer.detect_anomalies.success');

      return anomalies;
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, stack: err.stack, toolId }, 'tool_observer.get_health.error');

      return [];
    }
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Extract scalar value from LogQL query result
   */
  private extractScalarValue(result: any): number {
    if (result.status === 'error') return 0;
    if (!result.data?.result || result.data.result.length === 0) return 0;

    // Handle vector result
    const firstResult = result.data.result[0];
    if (firstResult.value && Array.isArray(firstResult.value)) {
      return parseFloat(firstResult.value[1]) || 0;
    }

    // Handle matrix result
    if (firstResult.values && Array.isArray(firstResult.values)) {
      const latestValue = firstResult.values[firstResult.values.length - 1];
      if (latestValue && Array.isArray(latestValue)) {
        return parseFloat(latestValue[1]) || 0;
      }
    }

    return 0;
  }

  /**
   * Calculate latency percentiles from raw log data
   */
  private calculateLatencyPercentiles(result: any): LatencyPercentiles {
    if (result.status === 'error') {
      return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
    }

    const latencies: number[] = [];

    // Extract durationMs from log lines
    if (result.data?.result) {
      for (const stream of result.data.result) {
        if (stream.values) {
          for (const [, logLine] of stream.values) {
            try {
              const logData = JSON.parse(logLine);
              if (logData.durationMs && typeof logData.durationMs === 'number') {
                latencies.push(logData.durationMs);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    }

    if (latencies.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
    }

    // Sort for percentile calculation
    latencies.sort((a, b) => a - b);

    const p50Index = Math.floor(latencies.length * 0.5);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);

    const sum = latencies.reduce((acc, val) => acc + val, 0);
    const avg = sum / latencies.length;

    return {
      p50: latencies[p50Index] || 0,
      p95: latencies[p95Index] || 0,
      p99: latencies[p99Index] || 0,
      avg,
      min: latencies[0] || 0,
      max: latencies[latencies.length - 1] || 0,
    };
  }

  /**
   * Parse InvocationEvent from log data
   */
  private parseInvocationEvent(
    logData: any,
    timestampNs: string
  ): InvocationEvent | null {
    try {
      return {
        timestamp: this.nanosToISO(timestampNs),
        correlationId: logData.correlationId || '',
        traceId: logData.traceId,
        toolId: logData.toolId || '',
        toolName: logData.toolName || logData.toolId || '',
        modelId: logData.modelId || '',
        modelName: logData.modelName || logData.modelId || '',
        status: logData.status || 'success',
        durationMs: logData.durationMs || 0,
        inputPreview: logData.inputPreview,
        outputPreview: logData.outputPreview,
        errorMessage: logData.errorMessage,
        rbacDecision: logData.rbacDecision || { allowed: true },
        estimatedCost: logData.estimatedCost,
        userId: logData.userId,
        sessionId: logData.sessionId,
        service: logData.service || 'tool-orchestrator',
        level: logData.level || 'info',
      };
    } catch {
      return null;
    }
  }

  /**
   * Convert nanosecond timestamp to ISO 8601 string
   */
  private nanosToISO(timestampNs: string): string {
    const ms = parseInt(timestampNs) / 1000000;
    return new Date(ms).toISOString();
  }

  /**
   * Get LogQL duration string from TimeRange
   */
  private getLogQLDuration(timeRange: TimeRange): string {
    const start = new Date(timeRange.start).getTime();
    const end = new Date(timeRange.end).getTime();
    const durationMs = end - start;
    const durationSeconds = Math.floor(durationMs / 1000);

    if (durationSeconds < 3600) {
      return `${Math.floor(durationSeconds / 60)}m`;
    } else if (durationSeconds < 86400) {
      return `${Math.floor(durationSeconds / 3600)}h`;
    } else {
      return `${Math.floor(durationSeconds / 86400)}d`;
    }
  }

  /**
   * Get empty ToolMetrics (fail-open fallback)
   */
  private getEmptyToolMetrics(toolId: string, timeRange: TimeRange): ToolMetrics {
    return {
      toolId,
      toolName: toolId,
      totalInvocations: 0,
      successCount: 0,
      errorCount: 0,
      deniedCount: 0,
      errorRate: 0,
      latency: { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 },
      timeRange,
    };
  }

  /**
   * Get empty ModelMetrics (fail-open fallback)
   */
  private getEmptyModelMetrics(modelId: string, timeRange: TimeRange): ModelMetrics {
    return {
      modelId,
      modelName: modelId,
      totalInvocations: 0,
      uniqueToolsUsed: 0,
      successCount: 0,
      errorCount: 0,
      deniedCount: 0,
      errorRate: 0,
      timeRange,
    };
  }
}
