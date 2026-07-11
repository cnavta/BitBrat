/**
 * Loki HTTP Client
 *
 * Client for querying Grafana Loki log aggregation system.
 * Supports LogQL queries with filtering by correlationId, traceId, service, level, and time range.
 */

import { LogRequest, LogEntry, LogLevel } from './types.js';
import { parseTimeDuration, normalizeLevel } from './log-parser.js';

/**
 * Loki query response format
 */
interface LokiQueryResponse {
  status: string;
  data: {
    resultType: 'streams' | 'matrix' | 'vector';
    result: LokiStream[];
    stats?: any;
  };
}

/**
 * Loki stream (log entries grouped by labels)
 */
interface LokiStream {
  stream: Record<string, string>; // Label key-value pairs
  values: Array<[string, string]>; // [timestamp_ns, log_line]
}

/**
 * Loki client configuration
 */
export interface LokiClientConfig {
  /** Loki base URL (e.g., "http://localhost:3100") */
  url: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * LokiClient class
 *
 * Provides methods to query Loki using LogQL and transform results to LogEntry format.
 */
export class LokiClient {
  private config: LokiClientConfig;

  constructor(config: LokiClientConfig) {
    this.config = {
      timeout: 5000, // 5 second default timeout
      ...config
    };
  }

  /**
   * Main entry point: query Loki based on LogRequest parameters
   */
  async query(request: LogRequest): Promise<LogEntry[]> {
    try {
      // Build LogQL query
      const logql = this.buildLogQL(request);

      // Build query parameters
      const params = this.buildQueryParams(request, logql);

      // Execute query
      const response = await this.executeLokiQuery(params);

      // Parse and transform results
      return this.parseResponse(response, request.bit);
    } catch (error: any) {
      throw new Error(`Loki query failed: ${error.message}`);
    }
  }

  /**
   * Build LogQL query from LogRequest
   *
   * LogQL syntax: {label="value"} |= "search" | json | level="info"
   */
  private buildLogQL(request: LogRequest): string {
    const selectors: string[] = [];

    // Service label (Bit name)
    if (request.bit) {
      selectors.push(`service="${request.bit}"`);
    }

    // Correlation ID label
    if (request.correlationId) {
      selectors.push(`correlationId="${request.correlationId}"`);
    }

    // Level filtering (supports multiple levels)
    if (request.level && request.level.length > 0) {
      if (request.level.length === 1) {
        selectors.push(`level="${request.level[0]}"`);
      } else {
        // Multiple levels: level=~"error|warn|info"
        const levelRegex = request.level.join('|');
        selectors.push(`level=~"${levelRegex}"`);
      }
    }

    // Build label matcher: {service="foo",level="info"}
    const labelMatcher = selectors.length > 0 ? `{${selectors.join(',')}}` : '{}';

    return labelMatcher;
  }

  /**
   * Build query parameters for Loki /loki/api/v1/query_range endpoint
   */
  private buildQueryParams(request: LogRequest, logql: string): URLSearchParams {
    const params = new URLSearchParams();

    // Query
    params.set('query', logql);

    // Time range
    if (request.since) {
      const start = parseTimeDuration(request.since);
      params.set('start', new Date(start).getTime().toString() + '000000'); // nanoseconds
    } else {
      // Default: 1 hour ago
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      params.set('start', oneHourAgo.getTime().toString() + '000000');
    }

    if (request.until) {
      const end = new Date(request.until);
      params.set('end', end.getTime().toString() + '000000'); // nanoseconds
    } else {
      // Default: now
      params.set('end', Date.now().toString() + '000000');
    }

    // Limit (Loki accepts 'limit' parameter)
    if (request.limit) {
      params.set('limit', request.limit.toString());
    } else {
      params.set('limit', '1000'); // Default limit
    }

    // Direction (newest first for consistency with Docker logs)
    params.set('direction', 'backward');

    return params;
  }

  /**
   * Execute HTTP query against Loki
   */
  private async executeLokiQuery(params: URLSearchParams): Promise<LokiQueryResponse> {
    const url = `${this.config.url}/loki/api/v1/query_range?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Loki HTTP ${response.status}: ${errorText}`);
      }

      const json = await response.json() as LokiQueryResponse;

      if (json.status !== 'success') {
        throw new Error(`Loki query failed with status: ${json.status}`);
      }

      return json;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error(`Loki query timeout after ${this.config.timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Parse Loki response into LogEntry array
   */
  private parseResponse(response: LokiQueryResponse, serviceName?: string): LogEntry[] {
    const entries: LogEntry[] = [];

    for (const stream of response.data.result) {
      const labels = stream.stream;

      for (const [timestampNs, logLine] of stream.values) {
        try {
          // Parse log line (should be JSON from Promtail pipeline)
          let logData: any;

          try {
            logData = JSON.parse(logLine);
          } catch (jsonError) {
            // Plain text log (fallback)
            logData = { message: logLine };
          }

          // Convert nanosecond timestamp to ISO string
          const timestampMs = parseInt(timestampNs) / 1000000;
          const timestamp = new Date(timestampMs).toISOString();

          // Build LogEntry
          const entry: LogEntry = {
            timestamp: logData.ts || timestamp,
            level: normalizeLevel(logData.level || labels.level || 'info'),
            service: serviceName || logData.service || labels.service || 'unknown',
            message: logData.msg || logData.message || '',
            correlationId: logData.correlationId || labels.correlationId,
            ...logData // Include all additional fields
          };

          entries.push(entry);
        } catch (parseError) {
          // Skip malformed log entries
          continue;
        }
      }
    }

    // Sort by timestamp (newest first, matching Docker logs behavior)
    entries.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return bTime - aTime; // Descending order (newest first)
    });

    return entries;
  }

  /**
   * Check if Loki is available and healthy
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout for health check

      const response = await fetch(`${this.config.url}/ready`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
