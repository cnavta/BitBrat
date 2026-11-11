/**
 * ToolObserver Interface
 *
 * Defines the contract for querying tool and model metrics from Loki.
 * ToolObserver provides observability into tool invocation patterns,
 * performance metrics, health status, and anomaly detection.
 *
 * @module tool-orchestrator-service/modules/observer
 * @see planning/sprint-59-ig0sr1/execution-plan.md - Task 2
 */

import {
  TimeRange,
  ToolMetrics,
  ModelMetrics,
  ToolHealth,
  Anomaly,
  InvocationEvent,
} from '../../types/tool-metrics';

/**
 * ToolObserver interface
 *
 * Primary abstraction for querying Loki-backed tool observability metrics.
 * All methods are async and fail-open (return empty/degraded results on Loki unavailability).
 */
export interface IToolObserver {
  /**
   * Query aggregated metrics for a specific tool
   *
   * Aggregates invocation counts, error rates, and latency percentiles from Loki event stream.
   * Queries Loki using: `{service="tool-orchestrator", eventType="tool.invocation", toolId="<toolId>"}`
   *
   * @param toolId - Tool identifier (e.g., "get_weather")
   * @param timeRange - Time window for aggregation
   * @returns Tool metrics with invocation counts, error rates, latency stats
   * @throws Never (fail-open design: returns degraded metrics on error)
   *
   * @example
   * const metrics = await observer.queryToolMetrics('get_weather', {
   *   start: '2026-11-10T00:00:00Z',
   *   end: '2026-11-10T23:59:59Z'
   * });
   * console.log(`Error rate: ${metrics.errorRate * 100}%`);
   * console.log(`P95 latency: ${metrics.latency.p95}ms`);
   */
  queryToolMetrics(toolId: string, timeRange: TimeRange): Promise<ToolMetrics>;

  /**
   * Query aggregated metrics for a specific model
   *
   * Aggregates invocation counts, tool usage, and estimated costs across all tools invoked by the model.
   * Queries Loki using: `{service="tool-orchestrator", eventType="tool.invocation", modelId="<modelId>"}`
   *
   * @param modelId - Model identifier (e.g., "gpt-4", "claude-3-opus")
   * @param timeRange - Time window for aggregation
   * @returns Model metrics with invocation counts, tool usage, estimated costs
   * @throws Never (fail-open design)
   *
   * @example
   * const metrics = await observer.queryModelMetrics('gpt-4', {
   *   start: '2026-11-10T00:00:00Z',
   *   end: '2026-11-10T23:59:59Z'
   * });
   * console.log(`Tools used: ${metrics.uniqueToolsUsed}`);
   * console.log(`Estimated cost: $${metrics.estimatedCost?.totalUsd.toFixed(2)}`);
   */
  queryModelMetrics(
    modelId: string,
    timeRange: TimeRange
  ): Promise<ModelMetrics>;

  /**
   * Trace a tool invocation by correlation ID
   *
   * Returns chronological list of all tool invocation events for a given correlationId.
   * Useful for debugging multi-tool compositions and understanding request lifecycle.
   * Queries Loki using: `{correlationId="<correlationId>", eventType="tool.invocation"}`
   *
   * @param correlationId - Correlation ID (links events in request lifecycle)
   * @returns Chronological list of invocation events (sorted by timestamp)
   * @throws Never (fail-open design: returns empty array on error)
   *
   * @example
   * const events = await observer.traceToolInvocation('abc-123-def');
   * for (const event of events) {
   *   console.log(`${event.timestamp}: ${event.toolName} (${event.status}) - ${event.durationMs}ms`);
   * }
   */
  traceToolInvocation(correlationId: string): Promise<InvocationEvent[]>;

  /**
   * Get current health status for a tool
   *
   * Derives health status from recent invocation patterns (last 1 hour by default).
   * Health logic:
   * - **healthy**: Recent invocations (< 1 hour), error rate < 5%
   * - **degraded**: Recent invocations, error rate 5-20%
   * - **unhealthy**: No recent invocations (> 1 hour) OR error rate > 20%
   * - **unknown**: Insufficient data
   *
   * @param toolId - Tool identifier
   * @param windowMs - Time window for health calculation (default: 3600000 = 1 hour)
   * @returns Tool health status with error rate, timestamps, and reason
   * @throws Never (fail-open design: returns status='unknown' on error)
   *
   * @example
   * const health = await observer.getToolHealth('get_weather');
   * if (health.status === 'unhealthy') {
   *   console.warn(`Tool unhealthy: ${health.reason}`);
   * }
   */
  getToolHealth(
    toolId: string,
    windowMs?: number
  ): Promise<ToolHealth>;

  /**
   * Detect anomalies in tool invocation patterns
   *
   * Analyzes recent metrics vs baseline to detect:
   * - Error rate spikes (>3x baseline)
   * - Latency spikes (>2x P95 baseline)
   * - RBAC denial spikes (>5x baseline)
   * - Invocation drops (no invocations in expected window)
   *
   * @param toolId - Tool identifier
   * @param timeRange - Time window to analyze
   * @param baselineRange - Baseline time window for comparison (optional)
   * @returns Array of detected anomalies sorted by severity
   * @throws Never (fail-open design: returns empty array on error)
   *
   * @example
   * const anomalies = await observer.detectAnomalies('get_weather', {
   *   start: '2026-11-10T12:00:00Z',
   *   end: '2026-11-10T13:00:00Z'
   * });
   * for (const anomaly of anomalies) {
   *   console.log(`[${anomaly.severity}] ${anomaly.type}: ${anomaly.description}`);
   * }
   */
  detectAnomalies(
    toolId: string,
    timeRange: TimeRange,
    baselineRange?: TimeRange
  ): Promise<Anomaly[]>;
}
