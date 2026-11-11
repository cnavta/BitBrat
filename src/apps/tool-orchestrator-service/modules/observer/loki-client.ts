/**
 * Loki Client
 *
 * HTTP client for querying Grafana Loki via LogQL.
 * Provides low-level query execution and result parsing.
 *
 * @module tool-orchestrator-service/modules/observer
 * @see planning/sprint-59-ig0sr1/execution-plan.md - Task 2.2
 */

import { Logger } from 'pino';
import { LokiResponse, LogQLResult } from '../../types/tool-metrics';

/**
 * Loki client configuration
 */
export interface LokiClientConfig {
  /** Loki HTTP endpoint (e.g., "http://bitbrat.lan:3100") */
  url: string;

  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;

  /** Enable query result caching (default: false) */
  cacheResults?: boolean;
}

/**
 * LogQL query options
 */
export interface QueryOptions {
  /** LogQL query string */
  query: string;

  /** Start time (Unix timestamp in nanoseconds OR ISO 8601 string) */
  start: string | number;

  /** End time (Unix timestamp in nanoseconds OR ISO 8601 string) */
  end: string | number;

  /** Max number of log lines to return (default: 1000) */
  limit?: number;

  /** Query direction ('forward' or 'backward', default: 'backward') */
  direction?: 'forward' | 'backward';

  /** Step interval for range queries (e.g., "5m", "1h") */
  step?: string;
}

/**
 * Loki client for LogQL query execution
 *
 * **Fail-open design**: All methods catch errors and return empty results.
 * Network/API failures are logged but do not throw exceptions.
 */
export class LokiClient {
  private readonly logger: Logger;
  private readonly config: Required<LokiClientConfig>;

  constructor(config: LokiClientConfig, logger: Logger) {
    this.config = {
      url: config.url.replace(/\/$/, ''), // Remove trailing slash
      timeoutMs: config.timeoutMs ?? 10000,
      cacheResults: config.cacheResults ?? false,
    };
    this.logger = logger;
  }

  /**
   * Execute a LogQL range query
   *
   * Queries Loki's `/loki/api/v1/query_range` endpoint for time-series data.
   * Returns aggregated metrics or log streams within the specified time range.
   *
   * @param options - Query options (query, start, end, limit, step)
   * @returns Loki API response with query results
   * @throws Never (fail-open: returns empty result on error)
   *
   * @example
   * const result = await client.queryRange({
   *   query: '{service="tool-orchestrator", eventType="tool.invocation"}',
   *   start: '2026-11-10T00:00:00Z',
   *   end: '2026-11-10T23:59:59Z',
   *   limit: 1000
   * });
   */
  async queryRange(
    options: QueryOptions
  ): Promise<LokiResponse<LogQLResult>> {
    const queryUrl = `${this.config.url}/loki/api/v1/query_range`;
    const params = new URLSearchParams();

    params.append('query', options.query);
    params.append('start', this.normalizeTimestamp(options.start));
    params.append('end', this.normalizeTimestamp(options.end));

    if (options.limit) {
      params.append('limit', options.limit.toString());
    }

    if (options.direction) {
      params.append('direction', options.direction);
    }

    if (options.step) {
      params.append('step', options.step);
    }

    const url = `${queryUrl}?${params.toString()}`;

    this.logger.debug({ query: options.query, start: options.start, end: options.end, url: queryUrl }, 'loki.query_range.start');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn({ status: response.status, statusText: response.statusText, error: errorText }, 'loki.query_range.http_error');

        return {
          status: 'error',
          data: { resultType: 'streams', result: [] },
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json()) as LokiResponse<LogQLResult>;

      this.logger.debug({ resultType: data.data?.resultType, resultCount: data.data?.result?.length ?? 0 }, 'loki.query_range.success');

      return data;
    } catch (error) {
      const err = error as Error;

      // Handle timeout
      if (err.name === 'AbortError') {
        this.logger.warn({ timeoutMs: this.config.timeoutMs, query: options.query }, 'loki.query_range.timeout');

        return {
          status: 'error',
          data: { resultType: 'streams', result: [] },
          error: `Query timeout after ${this.config.timeoutMs}ms`,
          errorType: 'timeout',
        };
      }

      // Handle network/fetch errors
      this.logger.error({ error: err.message, stack: err.stack, query: options.query }, 'loki.query_range.error');

      return {
        status: 'error',
        data: { resultType: 'streams', result: [] },
        error: err.message,
        errorType: 'network',
      };
    }
  }

  /**
   * Execute an instant LogQL query
   *
   * Queries Loki's `/loki/api/v1/query` endpoint for metrics at a single point in time.
   *
   * @param query - LogQL query string
   * @param time - Query timestamp (Unix timestamp in nanoseconds OR ISO 8601 string)
   * @param limit - Max number of results (default: 1000)
   * @returns Loki API response
   * @throws Never (fail-open)
   *
   * @example
   * const result = await client.query(
   *   '{service="tool-orchestrator"}',
   *   '2026-11-10T12:00:00Z'
   * );
   */
  async query(
    query: string,
    time?: string | number,
    limit = 1000
  ): Promise<LokiResponse<LogQLResult>> {
    const queryUrl = `${this.config.url}/loki/api/v1/query`;
    const params = new URLSearchParams();

    params.append('query', query);

    if (time) {
      params.append('time', this.normalizeTimestamp(time));
    }

    params.append('limit', limit.toString());

    const url = `${queryUrl}?${params.toString()}`;

    this.logger.debug({ query, time, url: queryUrl }, 'loki.query.start');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn({
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });

        return {
          status: 'error',
          data: { resultType: 'streams', result: [] },
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json()) as LokiResponse<LogQLResult>;

      this.logger.debug({
        resultType: data.data?.resultType,
        resultCount: data.data?.result?.length ?? 0,
      });

      return data;
    } catch (error) {
      const err = error as Error;

      if (err.name === 'AbortError') {
        this.logger.warn({ timeoutMs: this.config.timeoutMs, query }, 'loki.query.timeout');

        return {
          status: 'error',
          data: { resultType: 'streams', result: [] },
          error: `Query timeout after ${this.config.timeoutMs}ms`,
          errorType: 'timeout',
        };
      }

      this.logger.error({ error: err.message, stack: err.stack, query }, 'loki.query.error');

      return {
        status: 'error',
        data: { resultType: 'streams', result: [] },
        error: err.message,
        errorType: 'network',
      };
    }
  }

  /**
   * Get all available label names from Loki
   *
   * Queries `/loki/api/v1/labels` to list all indexed labels.
   *
   * @returns Array of label names
   * @throws Never (fail-open: returns empty array on error)
   */
  async getLabels(): Promise<string[]> {
    const url = `${this.config.url}/loki/api/v1/labels`;

    this.logger.debug({ url }, 'loki.get_labels.start');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'loki.get_labels.http_error');
        return [];
      }

      const data = (await response.json()) as LokiResponse<string[]>;

      this.logger.debug({ labelCount: data.data?.length ?? 0 }, 'loki.get_labels.success');

      return data.data ?? [];
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'loki.get_labels.error');
      return [];
    }
  }

  /**
   * Get all values for a specific label
   *
   * Queries `/loki/api/v1/label/{name}/values` to list all unique values for a label.
   *
   * @param labelName - Label name (e.g., "service", "toolId")
   * @returns Array of label values
   * @throws Never (fail-open: returns empty array on error)
   */
  async getLabelValues(labelName: string): Promise<string[]> {
    const url = `${this.config.url}/loki/api/v1/label/${encodeURIComponent(labelName)}/values`;

    this.logger.debug({ labelName, url }, 'loki.get_label_values.start');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn({ status: response.status, labelName }, 'loki.get_label_values.http_error');
        return [];
      }

      const data = (await response.json()) as LokiResponse<string[]>;

      this.logger.debug({ labelName, valueCount: data.data?.length ?? 0 }, 'loki.get_label_values.success');

      return data.data ?? [];
    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message, labelName }, 'loki.get_label_values.error');
      return [];
    }
  }

  /**
   * Check if Loki is ready
   *
   * Queries `/ready` endpoint.
   *
   * @returns true if Loki is ready, false otherwise
   */
  async isReady(): Promise<boolean> {
    const url = `${this.config.url}/ready`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000); // Short timeout

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return response.ok;
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, 'loki.ready_check.failed');
      return false;
    }
  }

  /**
   * Normalize timestamp to Loki format (nanoseconds since Unix epoch)
   *
   * Accepts:
   * - ISO 8601 string (e.g., "2026-11-10T00:00:00Z")
   * - Unix timestamp in milliseconds (e.g., 1699900000000)
   * - Unix timestamp in nanoseconds (e.g., 1699900000000000000)
   *
   * @param timestamp - Timestamp in various formats
   * @returns Timestamp in nanoseconds as string
   */
  private normalizeTimestamp(timestamp: string | number): string {
    if (typeof timestamp === 'string') {
      // ISO 8601 string → parse and convert to nanoseconds
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid timestamp: ${timestamp}`);
      }
      return `${date.getTime()}000000`; // ms → ns (add 6 zeros)
    }

    // Number: Assume milliseconds if < 10^15, otherwise nanoseconds
    if (timestamp < 1e15) {
      // Milliseconds → nanoseconds
      return `${timestamp}000000`;
    }

    // Already in nanoseconds
    return timestamp.toString();
  }
}
