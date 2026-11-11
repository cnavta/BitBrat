/**
 * Tool Metrics Types
 *
 * Type definitions for tool invocation metrics, model metrics, health status,
 * and anomaly detection. Used by ToolObserver module to query and aggregate
 * metrics from Loki event stream.
 *
 * @module tool-orchestrator-service/types/tool-metrics
 * @see planning/sprint-59-ig0sr1/execution-plan.md - Task 2
 */

/**
 * Time range for metric queries
 */
export interface TimeRange {
  /**
   * Start time (ISO 8601 timestamp)
   * Example: "2026-11-10T00:00:00Z"
   */
  start: string;

  /**
   * End time (ISO 8601 timestamp)
   * Example: "2026-11-10T23:59:59Z"
   */
  end: string;
}

/**
 * Latency percentiles for tool invocations
 */
export interface LatencyPercentiles {
  /** 50th percentile (median) in milliseconds */
  p50: number;

  /** 95th percentile in milliseconds */
  p95: number;

  /** 99th percentile in milliseconds */
  p99: number;

  /** Average latency in milliseconds */
  avg: number;

  /** Minimum latency in milliseconds */
  min: number;

  /** Maximum latency in milliseconds */
  max: number;
}

/**
 * Tool-level metrics aggregated from Loki event stream
 */
export interface ToolMetrics {
  /** Tool identifier (e.g., "get_weather", "search_code") */
  toolId: string;

  /** Tool name (human-readable) */
  toolName: string;

  /** Total number of invocations in time range */
  totalInvocations: number;

  /** Number of successful invocations */
  successCount: number;

  /** Number of failed invocations (errors) */
  errorCount: number;

  /** Number of RBAC-denied invocations */
  deniedCount: number;

  /** Error rate (0.0 - 1.0) */
  errorRate: number;

  /** Latency statistics */
  latency: LatencyPercentiles;

  /** Timestamp of most recent invocation */
  lastInvocationAt?: string;

  /** Timestamp of most recent successful invocation */
  lastSuccessAt?: string;

  /** Timestamp of most recent error */
  lastErrorAt?: string;

  /** Time range queried */
  timeRange: TimeRange;

  /** Top 5 models using this tool (by invocation count) */
  topModels?: Array<{
    modelId: string;
    modelName: string;
    invocations: number;
  }>;

  /** Top 5 error messages (by frequency) */
  topErrors?: Array<{
    message: string;
    count: number;
  }>;
}

/**
 * Model-level metrics aggregated across all tool invocations
 */
export interface ModelMetrics {
  /** Model identifier (e.g., "gpt-4", "claude-3-opus") */
  modelId: string;

  /** Model name (human-readable) */
  modelName: string;

  /** Total number of tool invocations by this model */
  totalInvocations: number;

  /** Number of unique tools invoked */
  uniqueToolsUsed: number;

  /** Number of successful invocations */
  successCount: number;

  /** Number of failed invocations */
  errorCount: number;

  /** Number of RBAC-denied invocations */
  deniedCount: number;

  /** Error rate (0.0 - 1.0) */
  errorRate: number;

  /** Estimated cost in USD (if available) */
  estimatedCost?: {
    totalUsd: number;
    totalTokens: number;
  };

  /** Time range queried */
  timeRange: TimeRange;

  /** Top 5 tools used by this model (by invocation count) */
  topTools?: Array<{
    toolId: string;
    toolName: string;
    invocations: number;
  }>;

  /** Timestamp of most recent invocation */
  lastInvocationAt?: string;
}

/**
 * Tool health status (derived from recent invocation patterns)
 */
export type ToolHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Detailed health information for a tool
 */
export interface ToolHealth {
  /** Tool identifier */
  toolId: string;

  /** Tool name */
  toolName: string;

  /** Current health status */
  status: ToolHealthStatus;

  /** Human-readable reason for status */
  reason: string;

  /** Error rate in recent window (0.0 - 1.0) */
  errorRate: number;

  /** Number of invocations in recent window */
  recentInvocations: number;

  /** Timestamp of most recent invocation */
  lastInvocationAt?: string;

  /** Timestamp of most recent successful invocation */
  lastSuccessAt?: string;

  /** Timestamp of most recent error */
  lastErrorAt?: string;

  /** Average latency in recent window (ms) */
  avgLatency: number;

  /** Time window used for health calculation */
  windowMs: number;

  /** Timestamp of health check */
  checkedAt: string;
}

/**
 * Anomaly severity levels
 */
export type AnomalySeverity = 'critical' | 'warning' | 'info';

/**
 * Detected anomaly in tool invocation patterns
 */
export interface Anomaly {
  /** Unique anomaly identifier */
  id: string;

  /** Tool identifier */
  toolId: string;

  /** Tool name */
  toolName: string;

  /** Anomaly type */
  type: 'error_spike' | 'latency_spike' | 'denial_spike' | 'no_invocations';

  /** Severity level */
  severity: AnomalySeverity;

  /** Human-readable description */
  description: string;

  /** Current value that triggered anomaly */
  currentValue: number;

  /** Baseline value for comparison */
  baselineValue: number;

  /** Multiplier (currentValue / baselineValue) */
  multiplier: number;

  /** Timestamp when anomaly was detected */
  detectedAt: string;

  /** Time range analyzed */
  timeRange: TimeRange;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Single tool invocation event (for correlation tracing)
 */
export interface InvocationEvent {
  /** Event timestamp (ISO 8601) */
  timestamp: string;

  /** Correlation ID (links events in request lifecycle) */
  correlationId: string;

  /** Trace ID (distributed tracing) */
  traceId?: string;

  /** Tool identifier */
  toolId: string;

  /** Tool name */
  toolName: string;

  /** Model identifier */
  modelId: string;

  /** Model name */
  modelName: string;

  /** Invocation status */
  status: 'success' | 'error' | 'denied';

  /** Duration in milliseconds */
  durationMs: number;

  /** Input preview (max 500 chars) */
  inputPreview?: string;

  /** Output preview (max 500 chars) */
  outputPreview?: string;

  /** Error message (if status === 'error') */
  errorMessage?: string;

  /** RBAC decision details */
  rbacDecision: {
    allowed: boolean;
    reason?: string;
    userRoles?: string[];
    modelTier?: string;
    requiredRoles?: string[];
    deniedRoles?: string[];
  };

  /** Estimated cost */
  estimatedCost?: {
    tokens?: number;
    costUsd?: number;
  };

  /** User ID (if available) */
  userId?: string;

  /** Session ID (if available) */
  sessionId?: string;

  /** Service that logged the event */
  service: string;

  /** Log level */
  level: string;
}

/**
 * LogQL query result (raw data from Loki)
 */
export interface LogQLResult {
  /** Result type */
  resultType: 'matrix' | 'vector' | 'streams';

  /** Result data */
  result: Array<{
    /** Stream labels */
    stream?: Record<string, string>;

    /** Metric labels */
    metric?: Record<string, string>;

    /** Time series values */
    values?: Array<[string, string]>; // [timestamp_ns, value]

    /** Single value */
    value?: [string, string]; // [timestamp_ns, value]
  }>;

  /** Query statistics */
  stats?: {
    ingester?: {
      totalChunksMatched?: number;
      totalBatches?: number;
      totalLinesSent?: number;
    };
  };
}

/**
 * Loki API response wrapper
 */
export interface LokiResponse<T = LogQLResult> {
  /** Status (success or error) */
  status: 'success' | 'error';

  /** Response data */
  data: T;

  /** Error message (if status === 'error') */
  error?: string;

  /** Error type (if status === 'error') */
  errorType?: string;
}
