/**
 * MetricsCollector
 *
 * Collects and exports metrics for monitoring and alerting.
 * Designed to be compatible with Prometheus but also provides simple JSON export.
 *
 * Phase 3: Production Readiness - Observability
 * Sprint: sprint-20-xc3pcu
 * Task: P3-009
 */

export interface WindowMetrics {
  observerId: string;
  windowType: 'sliding' | 'tumbling' | 'session';
  eventCount: number;
  windowAgeMs: number;
  lastEventAgeMs: number;
}

export interface ProcessingMetrics {
  eventsReceived: number;
  eventsFiltered: number;
  eventsEvicted: number;
  windowsClosed: number;
  analysisCount: number;
  analysisErrors: number;
  averageAnalysisLatencyMs: number;
  snapshotCount: number;
  snapshotErrors: number;
}

export interface ResourceMetrics {
  totalEvents: number;
  maxEvents: number;
  memoryUsagePercent: number;
  activeObservers: number;
  activeSubscriptions: number;
}

export interface ErrorMetrics {
  [errorType: string]: {
    count: number;
    lastOccurrence: string;
    observers: Set<string>;
  };
}

export interface AllMetrics {
  timestamp: string;
  windows: WindowMetrics[];
  processing: ProcessingMetrics;
  resources: ResourceMetrics;
  errors: Record<string, {
    count: number;
    lastOccurrence: string;
    observerCount: number;
  }>;
}

/**
 * MetricsCollector tracks operational metrics for monitoring
 */
export class MetricsCollector {
  private processingMetrics: ProcessingMetrics = {
    eventsReceived: 0,
    eventsFiltered: 0,
    eventsEvicted: 0,
    windowsClosed: 0,
    analysisCount: 0,
    analysisErrors: 0,
    averageAnalysisLatencyMs: 0,
    snapshotCount: 0,
    snapshotErrors: 0
  };

  private analysisLatencies: number[] = [];
  private errorMetrics: ErrorMetrics = {};
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Record event received
   */
  recordEventReceived(count: number = 1): void {
    this.processingMetrics.eventsReceived += count;
  }

  /**
   * Record event filtered (didn't match any observer)
   */
  recordEventFiltered(count: number = 1): void {
    this.processingMetrics.eventsFiltered += count;
  }

  /**
   * Record events evicted due to memory pressure
   */
  recordEviction(count: number): void {
    this.processingMetrics.eventsEvicted += count;
  }

  /**
   * Record window closed
   */
  recordWindowClosed(): void {
    this.processingMetrics.windowsClosed += 1;
  }

  /**
   * Record analysis completed
   */
  recordAnalysis(latencyMs: number, error?: boolean): void {
    if (error) {
      this.processingMetrics.analysisErrors += 1;
    } else {
      this.processingMetrics.analysisCount += 1;

      // Track latency for average calculation
      this.analysisLatencies.push(latencyMs);

      // Keep only last 100 latencies for rolling average
      if (this.analysisLatencies.length > 100) {
        this.analysisLatencies.shift();
      }

      // Update average
      const sum = this.analysisLatencies.reduce((a, b) => a + b, 0);
      this.processingMetrics.averageAnalysisLatencyMs = sum / this.analysisLatencies.length;
    }
  }

  /**
   * Record snapshot completed
   */
  recordSnapshot(error?: boolean): void {
    if (error) {
      this.processingMetrics.snapshotErrors += 1;
    } else {
      this.processingMetrics.snapshotCount += 1;
    }
  }

  /**
   * Record error occurrence
   */
  recordError(errorType: string, observerId?: string): void {
    if (!this.errorMetrics[errorType]) {
      this.errorMetrics[errorType] = {
        count: 0,
        lastOccurrence: new Date().toISOString(),
        observers: new Set()
      };
    }

    this.errorMetrics[errorType].count += 1;
    this.errorMetrics[errorType].lastOccurrence = new Date().toISOString();

    if (observerId) {
      this.errorMetrics[errorType].observers.add(observerId);
    }
  }

  /**
   * Get window metrics from window states
   */
  getWindowMetrics(windowStates: Map<string, any>, observers: Map<string, any>): WindowMetrics[] {
    const metrics: WindowMetrics[] = [];
    const now = Date.now();

    for (const [observerId, state] of windowStates.entries()) {
      const observer = observers.get(observerId);

      metrics.push({
        observerId,
        windowType: observer?.window?.type || 'sliding',
        eventCount: state.eventIds?.length || 0,
        windowAgeMs: now - new Date(state.windowStartedAt).getTime(),
        lastEventAgeMs: now - new Date(state.lastEventAt).getTime()
      });
    }

    return metrics;
  }

  /**
   * Get resource metrics from managers
   */
  getResourceMetrics(memoryStats: any, activeObservers: number, activeSubscriptions: number): ResourceMetrics {
    return {
      totalEvents: memoryStats.totalEvents,
      maxEvents: memoryStats.maxEvents,
      memoryUsagePercent: memoryStats.usagePercent,
      activeObservers,
      activeSubscriptions
    };
  }

  /**
   * Get all metrics in structured format
   */
  getAllMetrics(
    windowStates: Map<string, any>,
    observers: Map<string, any>,
    memoryStats: any,
    activeObservers: number,
    activeSubscriptions: number
  ): AllMetrics {
    // Convert error metrics to serializable format
    const serializableErrors: Record<string, { count: number; lastOccurrence: string; observerCount: number }> = {};
    for (const [errorType, metrics] of Object.entries(this.errorMetrics)) {
      serializableErrors[errorType] = {
        count: metrics.count,
        lastOccurrence: metrics.lastOccurrence,
        observerCount: metrics.observers.size
      };
    }

    return {
      timestamp: new Date().toISOString(),
      windows: this.getWindowMetrics(windowStates, observers),
      processing: { ...this.processingMetrics },
      resources: this.getResourceMetrics(memoryStats, activeObservers, activeSubscriptions),
      errors: serializableErrors
    };
  }

  /**
   * Get processing metrics
   */
  getProcessingMetrics(): ProcessingMetrics {
    return { ...this.processingMetrics };
  }

  /**
   * Reset metrics (for testing or periodic reset)
   */
  reset(): void {
    this.processingMetrics = {
      eventsReceived: 0,
      eventsFiltered: 0,
      eventsEvicted: 0,
      windowsClosed: 0,
      analysisCount: 0,
      analysisErrors: 0,
      averageAnalysisLatencyMs: 0,
      snapshotCount: 0,
      snapshotErrors: 0
    };
    this.analysisLatencies = [];
    this.errorMetrics = {};

    this.logger.debug('metrics-collector.reset');
  }

  /**
   * Export metrics in Prometheus text format
   * Can be consumed by Prometheus scraper
   */
  exportPrometheusFormat(
    windowStates: Map<string, any>,
    observers: Map<string, any>,
    memoryStats: any,
    activeObservers: number,
    activeSubscriptions: number
  ): string {
    const lines: string[] = [];

    // Processing metrics
    lines.push('# HELP esa_events_received_total Total events received');
    lines.push('# TYPE esa_events_received_total counter');
    lines.push(`esa_events_received_total ${this.processingMetrics.eventsReceived}`);

    lines.push('# HELP esa_events_filtered_total Total events filtered (no match)');
    lines.push('# TYPE esa_events_filtered_total counter');
    lines.push(`esa_events_filtered_total ${this.processingMetrics.eventsFiltered}`);

    lines.push('# HELP esa_events_evicted_total Total events evicted due to memory');
    lines.push('# TYPE esa_events_evicted_total counter');
    lines.push(`esa_events_evicted_total ${this.processingMetrics.eventsEvicted}`);

    lines.push('# HELP esa_windows_closed_total Total windows closed');
    lines.push('# TYPE esa_windows_closed_total counter');
    lines.push(`esa_windows_closed_total ${this.processingMetrics.windowsClosed}`);

    lines.push('# HELP esa_analysis_total Total analyses completed');
    lines.push('# TYPE esa_analysis_total counter');
    lines.push(`esa_analysis_total ${this.processingMetrics.analysisCount}`);

    lines.push('# HELP esa_analysis_errors_total Total analysis errors');
    lines.push('# TYPE esa_analysis_errors_total counter');
    lines.push(`esa_analysis_errors_total ${this.processingMetrics.analysisErrors}`);

    lines.push('# HELP esa_analysis_latency_ms Average analysis latency in milliseconds');
    lines.push('# TYPE esa_analysis_latency_ms gauge');
    lines.push(`esa_analysis_latency_ms ${this.processingMetrics.averageAnalysisLatencyMs.toFixed(2)}`);

    // Resource metrics
    lines.push('# HELP esa_memory_events_total Total events in memory');
    lines.push('# TYPE esa_memory_events_total gauge');
    lines.push(`esa_memory_events_total ${memoryStats.totalEvents}`);

    lines.push('# HELP esa_memory_usage_percent Memory usage as percentage (0-1)');
    lines.push('# TYPE esa_memory_usage_percent gauge');
    lines.push(`esa_memory_usage_percent ${memoryStats.usagePercent.toFixed(4)}`);

    lines.push('# HELP esa_observers_active Active observers');
    lines.push('# TYPE esa_observers_active gauge');
    lines.push(`esa_observers_active ${activeObservers}`);

    lines.push('# HELP esa_subscriptions_active Active NATS subscriptions');
    lines.push('# TYPE esa_subscriptions_active gauge');
    lines.push(`esa_subscriptions_active ${activeSubscriptions}`);

    // Window metrics (by observer)
    const windowMetrics = this.getWindowMetrics(windowStates, observers);
    for (const window of windowMetrics) {
      lines.push(`esa_window_events{observer="${window.observerId}",type="${window.windowType}"} ${window.eventCount}`);
      lines.push(`esa_window_age_ms{observer="${window.observerId}",type="${window.windowType}"} ${window.windowAgeMs}`);
    }

    // Error metrics (by type)
    for (const [errorType, metrics] of Object.entries(this.errorMetrics)) {
      lines.push(`esa_errors_total{type="${errorType}"} ${metrics.count}`);
    }

    return lines.join('\n') + '\n';
  }
}
