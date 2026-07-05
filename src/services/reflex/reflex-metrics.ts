/**
 * Reflex Metrics Collection
 *
 * Tracks performance and health metrics for the reflex service.
 * Compatible with future Prometheus/OpenTelemetry integration.
 *
 * Metrics tracked:
 * - Pattern matching latency (histogram)
 * - Execution latency (histogram)
 * - End-to-end latency (histogram)
 * - Match counts (counter)
 * - Execution counts (counter)
 * - Cache size (gauge)
 * - Error counts (counter)
 */

/**
 * Histogram bucket for latency measurements.
 */
interface HistogramBucket {
  le: number; // less than or equal to (milliseconds)
  count: number;
}

/**
 * Histogram data structure.
 */
interface Histogram {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

/**
 * Counter data structure.
 */
interface Counter {
  value: number;
  labels?: Record<string, string>;
}

/**
 * Gauge data structure.
 */
interface Gauge {
  value: number;
}

/**
 * Metrics store.
 */
class ReflexMetrics {
  // Histograms
  private matchLatency: Histogram;
  private executeLatency: Histogram;
  private endToEndLatency: Histogram;

  // Counters
  private matchCount: Map<string, Counter> = new Map(); // labels: matched/no-match
  private executeCount: Map<string, Counter> = new Map(); // labels: success/failure
  private cacheErrors: Counter = { value: 0 };
  private messageErrors: Counter = { value: 0 };

  // Gauges
  private cacheSize: Gauge = { value: 0 };

  constructor() {
    // Initialize histograms with standard latency buckets (ms)
    const buckets = [1, 5, 10, 25, 50, 100, 150, 250, 500, 1000, 2500, 5000];

    this.matchLatency = this.createHistogram(buckets);
    this.executeLatency = this.createHistogram(buckets);
    this.endToEndLatency = this.createHistogram(buckets);

    // Initialize counters
    this.matchCount.set('matched', { value: 0, labels: { result: 'matched' } });
    this.matchCount.set('no-match', { value: 0, labels: { result: 'no-match' } });
    this.executeCount.set('success', { value: 0, labels: { status: 'success' } });
    this.executeCount.set('failure', { value: 0, labels: { status: 'failure' } });
  }

  /**
   * Creates a histogram with predefined buckets.
   */
  private createHistogram(bucketBoundaries: number[]): Histogram {
    return {
      buckets: bucketBoundaries.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0,
    };
  }

  /**
   * Records a match latency observation.
   */
  recordMatchLatency(latencyMs: number): void {
    this.observeHistogram(this.matchLatency, latencyMs);
  }

  /**
   * Records an execution latency observation.
   */
  recordExecuteLatency(latencyMs: number): void {
    this.observeHistogram(this.executeLatency, latencyMs);
  }

  /**
   * Records an end-to-end latency observation.
   */
  recordEndToEndLatency(latencyMs: number): void {
    this.observeHistogram(this.endToEndLatency, latencyMs);
  }

  /**
   * Increments match count.
   */
  incrementMatchCount(matched: boolean): void {
    const key = matched ? 'matched' : 'no-match';
    const counter = this.matchCount.get(key)!;
    counter.value++;
  }

  /**
   * Increments execution count.
   */
  incrementExecuteCount(success: boolean): void {
    const key = success ? 'success' : 'failure';
    const counter = this.executeCount.get(key)!;
    counter.value++;
  }

  /**
   * Increments cache error count.
   */
  incrementCacheErrors(): void {
    this.cacheErrors.value++;
  }

  /**
   * Increments message error count.
   */
  incrementMessageErrors(): void {
    this.messageErrors.value++;
  }

  /**
   * Sets cache size gauge.
   */
  setCacheSize(size: number): void {
    this.cacheSize.value = size;
  }

  /**
   * Records a histogram observation.
   */
  private observeHistogram(histogram: Histogram, value: number): void {
    histogram.sum += value;
    histogram.count++;

    // Increment bucket counts
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  /**
   * Calculates histogram percentile.
   */
  private calculatePercentile(histogram: Histogram, percentile: number): number {
    if (histogram.count === 0) return 0;

    const targetCount = Math.ceil((percentile / 100) * histogram.count);
    let cumulativeCount = 0;

    for (const bucket of histogram.buckets) {
      cumulativeCount = bucket.count;
      if (cumulativeCount >= targetCount) {
        return bucket.le;
      }
    }

    // Return last bucket if we didn't find it
    return histogram.buckets[histogram.buckets.length - 1].le;
  }

  /**
   * Gets metrics summary for monitoring/debugging.
   */
  getSummary(): {
    match: { p50: number; p95: number; p99: number; count: number; avg: number };
    execute: { p50: number; p95: number; p99: number; count: number; avg: number };
    endToEnd: { p50: number; p95: number; p99: number; count: number; avg: number };
    counts: {
      matched: number;
      noMatch: number;
      success: number;
      failure: number;
      cacheErrors: number;
      messageErrors: number;
    };
    cache: { size: number };
  } {
    return {
      match: {
        p50: this.calculatePercentile(this.matchLatency, 50),
        p95: this.calculatePercentile(this.matchLatency, 95),
        p99: this.calculatePercentile(this.matchLatency, 99),
        count: this.matchLatency.count,
        avg: this.matchLatency.count > 0 ? this.matchLatency.sum / this.matchLatency.count : 0,
      },
      execute: {
        p50: this.calculatePercentile(this.executeLatency, 50),
        p95: this.calculatePercentile(this.executeLatency, 95),
        p99: this.calculatePercentile(this.executeLatency, 99),
        count: this.executeLatency.count,
        avg: this.executeLatency.count > 0 ? this.executeLatency.sum / this.executeLatency.count : 0,
      },
      endToEnd: {
        p50: this.calculatePercentile(this.endToEndLatency, 50),
        p95: this.calculatePercentile(this.endToEndLatency, 95),
        p99: this.calculatePercentile(this.endToEndLatency, 99),
        count: this.endToEndLatency.count,
        avg: this.endToEndLatency.count > 0 ? this.endToEndLatency.sum / this.endToEndLatency.count : 0,
      },
      counts: {
        matched: this.matchCount.get('matched')!.value,
        noMatch: this.matchCount.get('no-match')!.value,
        success: this.executeCount.get('success')!.value,
        failure: this.executeCount.get('failure')!.value,
        cacheErrors: this.cacheErrors.value,
        messageErrors: this.messageErrors.value,
      },
      cache: {
        size: this.cacheSize.value,
      },
    };
  }

  /**
   * Gets Prometheus-style metrics output.
   *
   * Compatible with Prometheus scraping.
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];

    // Match latency histogram
    lines.push('# HELP reflex_match_latency_ms Pattern matching latency in milliseconds');
    lines.push('# TYPE reflex_match_latency_ms histogram');
    for (const bucket of this.matchLatency.buckets) {
      lines.push(`reflex_match_latency_ms_bucket{le="${bucket.le}"} ${bucket.count}`);
    }
    lines.push(`reflex_match_latency_ms_bucket{le="+Inf"} ${this.matchLatency.count}`);
    lines.push(`reflex_match_latency_ms_sum ${this.matchLatency.sum}`);
    lines.push(`reflex_match_latency_ms_count ${this.matchLatency.count}`);

    // Execute latency histogram
    lines.push('# HELP reflex_execute_latency_ms Tool execution latency in milliseconds');
    lines.push('# TYPE reflex_execute_latency_ms histogram');
    for (const bucket of this.executeLatency.buckets) {
      lines.push(`reflex_execute_latency_ms_bucket{le="${bucket.le}"} ${bucket.count}`);
    }
    lines.push(`reflex_execute_latency_ms_bucket{le="+Inf"} ${this.executeLatency.count}`);
    lines.push(`reflex_execute_latency_ms_sum ${this.executeLatency.sum}`);
    lines.push(`reflex_execute_latency_ms_count ${this.executeLatency.count}`);

    // End-to-end latency histogram
    lines.push('# HELP reflex_end_to_end_latency_ms End-to-end latency in milliseconds');
    lines.push('# TYPE reflex_end_to_end_latency_ms histogram');
    for (const bucket of this.endToEndLatency.buckets) {
      lines.push(`reflex_end_to_end_latency_ms_bucket{le="${bucket.le}"} ${bucket.count}`);
    }
    lines.push(`reflex_end_to_end_latency_ms_bucket{le="+Inf"} ${this.endToEndLatency.count}`);
    lines.push(`reflex_end_to_end_latency_ms_sum ${this.endToEndLatency.sum}`);
    lines.push(`reflex_end_to_end_latency_ms_count ${this.endToEndLatency.count}`);

    // Match count
    lines.push('# HELP reflex_match_count Total number of pattern match attempts');
    lines.push('# TYPE reflex_match_count counter');
    lines.push(`reflex_match_count{result="matched"} ${this.matchCount.get('matched')!.value}`);
    lines.push(`reflex_match_count{result="no-match"} ${this.matchCount.get('no-match')!.value}`);

    // Execute count
    lines.push('# HELP reflex_execute_count Total number of tool executions');
    lines.push('# TYPE reflex_execute_count counter');
    lines.push(`reflex_execute_count{status="success"} ${this.executeCount.get('success')!.value}`);
    lines.push(`reflex_execute_count{status="failure"} ${this.executeCount.get('failure')!.value}`);

    // Cache size
    lines.push('# HELP reflex_cache_size Number of active reflexes in cache');
    lines.push('# TYPE reflex_cache_size gauge');
    lines.push(`reflex_cache_size ${this.cacheSize.value}`);

    // Error counts
    lines.push('# HELP reflex_cache_errors Total number of cache synchronization errors');
    lines.push('# TYPE reflex_cache_errors counter');
    lines.push(`reflex_cache_errors ${this.cacheErrors.value}`);

    lines.push('# HELP reflex_message_errors Total number of message processing errors');
    lines.push('# TYPE reflex_message_errors counter');
    lines.push(`reflex_message_errors ${this.messageErrors.value}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Resets all metrics (useful for testing).
   */
  reset(): void {
    this.matchLatency = this.createHistogram([1, 5, 10, 25, 50, 100, 150, 250, 500, 1000, 2500, 5000]);
    this.executeLatency = this.createHistogram([1, 5, 10, 25, 50, 100, 150, 250, 500, 1000, 2500, 5000]);
    this.endToEndLatency = this.createHistogram([1, 5, 10, 25, 50, 100, 150, 250, 500, 1000, 2500, 5000]);

    this.matchCount.get('matched')!.value = 0;
    this.matchCount.get('no-match')!.value = 0;
    this.executeCount.get('success')!.value = 0;
    this.executeCount.get('failure')!.value = 0;
    this.cacheErrors.value = 0;
    this.messageErrors.value = 0;
    this.cacheSize.value = 0;
  }
}

/**
 * Singleton metrics instance.
 */
export const metrics = new ReflexMetrics();
