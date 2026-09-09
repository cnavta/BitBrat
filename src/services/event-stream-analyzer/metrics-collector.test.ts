import { MetricsCollector } from './metrics-collector';

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

describe('MetricsCollector', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let collector: MetricsCollector;

  beforeEach(() => {
    mockLogger = createMockLogger();
    collector = new MetricsCollector(mockLogger);
  });

  describe('Event Tracking', () => {
    it('should record events received', () => {
      collector.recordEventReceived(10);
      collector.recordEventReceived(5);

      const metrics = collector.getProcessingMetrics();
      expect(metrics.eventsReceived).toBe(15);
    });

    it('should record events filtered', () => {
      collector.recordEventFiltered(3);
      collector.recordEventFiltered(2);

      const metrics = collector.getProcessingMetrics();
      expect(metrics.eventsFiltered).toBe(5);
    });

    it('should record events evicted', () => {
      collector.recordEviction(100);
      collector.recordEviction(50);

      const metrics = collector.getProcessingMetrics();
      expect(metrics.eventsEvicted).toBe(150);
    });

    it('should record windows closed', () => {
      collector.recordWindowClosed();
      collector.recordWindowClosed();
      collector.recordWindowClosed();

      const metrics = collector.getProcessingMetrics();
      expect(metrics.windowsClosed).toBe(3);
    });
  });

  describe('Analysis Metrics', () => {
    it('should record successful analyses', () => {
      collector.recordAnalysis(100);
      collector.recordAnalysis(200);
      collector.recordAnalysis(300);

      const metrics = collector.getProcessingMetrics();
      expect(metrics.analysisCount).toBe(3);
      expect(metrics.analysisErrors).toBe(0);
      expect(metrics.averageAnalysisLatencyMs).toBe(200); // (100+200+300)/3
    });

    it('should record analysis errors', () => {
      collector.recordAnalysis(100, true);
      collector.recordAnalysis(200, true);

      const metrics = collector.getProcessingMetrics();
      expect(metrics.analysisCount).toBe(0);
      expect(metrics.analysisErrors).toBe(2);
    });

    it('should calculate rolling average latency', () => {
      // Add 100 latencies
      for (let i = 1; i <= 100; i++) {
        collector.recordAnalysis(i * 10);
      }

      let metrics = collector.getProcessingMetrics();
      expect(metrics.averageAnalysisLatencyMs).toBe(505); // Average of 10, 20, ..., 1000

      // Add one more (should drop the first)
      collector.recordAnalysis(2000);

      metrics = collector.getProcessingMetrics();
      // Now average of 20, 30, ..., 1000, 2000 (dropped 10)
      expect(metrics.analysisCount).toBe(101);
      expect(metrics.analysisErrors).toBe(0);
    });
  });

  describe('Snapshot Metrics', () => {
    it('should record successful snapshots', () => {
      collector.recordSnapshot();
      collector.recordSnapshot();

      const metrics = collector.getProcessingMetrics();
      expect(metrics.snapshotCount).toBe(2);
      expect(metrics.snapshotErrors).toBe(0);
    });

    it('should record snapshot errors', () => {
      collector.recordSnapshot(true);

      const metrics = collector.getProcessingMetrics();
      expect(metrics.snapshotCount).toBe(0);
      expect(metrics.snapshotErrors).toBe(1);
    });
  });

  describe('Error Tracking', () => {
    it('should record errors by type', () => {
      collector.recordError('database_error');
      collector.recordError('database_error');
      collector.recordError('llm_timeout');

      const allMetrics = collector.getAllMetrics(
        new Map(),
        new Map(),
        { totalEvents: 0, maxEvents: 10000, usagePercent: 0 },
        0,
        0
      );

      expect(allMetrics.errors['database_error'].count).toBe(2);
      expect(allMetrics.errors['llm_timeout'].count).toBe(1);
    });

    it('should track observers affected by errors', () => {
      collector.recordError('analysis_error', 'observer-1');
      collector.recordError('analysis_error', 'observer-2');
      collector.recordError('analysis_error', 'observer-1'); // Duplicate

      const allMetrics = collector.getAllMetrics(
        new Map(),
        new Map(),
        { totalEvents: 0, maxEvents: 10000, usagePercent: 0 },
        0,
        0
      );

      expect(allMetrics.errors['analysis_error'].count).toBe(3);
      expect(allMetrics.errors['analysis_error'].observerCount).toBe(2); // Unique observers
    });

    it('should track last error occurrence', () => {
      const before = new Date().toISOString();
      collector.recordError('test_error');
      const after = new Date().toISOString();

      const allMetrics = collector.getAllMetrics(
        new Map(),
        new Map(),
        { totalEvents: 0, maxEvents: 10000, usagePercent: 0 },
        0,
        0
      );

      const timestamp = allMetrics.errors['test_error'].lastOccurrence;
      expect(timestamp >= before && timestamp <= after).toBe(true);
    });
  });

  describe('Window Metrics', () => {
    it('should collect window metrics from window states', () => {
      const windowStates = new Map([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2', 'evt-3'],
          windowStartedAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
          lastEventAt: new Date(Date.now() - 10000).toISOString()      // 10 sec ago
        }],
        ['observer-2', {
          observerId: 'observer-2',
          eventIds: ['evt-4', 'evt-5'],
          windowStartedAt: new Date(Date.now() - 120000).toISOString(),
          lastEventAt: new Date(Date.now() - 30000).toISOString()
        }]
      ]);

      const observers = new Map([
        ['observer-1', { window: { type: 'sliding' } }],
        ['observer-2', { window: { type: 'tumbling' } }]
      ]);

      const windowMetrics = collector.getWindowMetrics(windowStates, observers);

      expect(windowMetrics).toHaveLength(2);
      expect(windowMetrics[0]).toMatchObject({
        observerId: 'observer-1',
        windowType: 'sliding',
        eventCount: 3
      });
      expect(windowMetrics[0].windowAgeMs).toBeGreaterThanOrEqual(60000);
      expect(windowMetrics[0].lastEventAgeMs).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('Resource Metrics', () => {
    it('should collect resource metrics', () => {
      const memoryStats = {
        totalEvents: 5000,
        maxEvents: 10000,
        usagePercent: 0.5
      };

      const resourceMetrics = collector.getResourceMetrics(memoryStats, 10, 5);

      expect(resourceMetrics).toEqual({
        totalEvents: 5000,
        maxEvents: 10000,
        memoryUsagePercent: 0.5,
        activeObservers: 10,
        activeSubscriptions: 5
      });
    });
  });

  describe('All Metrics', () => {
    it('should collect all metrics in structured format', () => {
      // Record some activity
      collector.recordEventReceived(100);
      collector.recordEviction(10);
      collector.recordWindowClosed();
      collector.recordAnalysis(150);
      collector.recordError('test_error', 'observer-1');

      const windowStates = new Map([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1'],
          windowStartedAt: new Date().toISOString(),
          lastEventAt: new Date().toISOString()
        }]
      ]);

      const observers = new Map([
        ['observer-1', { window: { type: 'sliding' } }]
      ]);

      const memoryStats = {
        totalEvents: 1000,
        maxEvents: 10000,
        usagePercent: 0.1
      };

      const allMetrics = collector.getAllMetrics(windowStates, observers, memoryStats, 1, 1);

      expect(allMetrics.timestamp).toBeTruthy();
      expect(allMetrics.windows).toHaveLength(1);
      expect(allMetrics.processing.eventsReceived).toBe(100);
      expect(allMetrics.processing.eventsEvicted).toBe(10);
      expect(allMetrics.resources.totalEvents).toBe(1000);
      expect(allMetrics.errors['test_error']).toBeDefined();
    });
  });

  describe('Prometheus Export', () => {
    it('should export metrics in Prometheus text format', () => {
      collector.recordEventReceived(100);
      collector.recordAnalysis(150);

      const windowStates = new Map();
      const observers = new Map();
      const memoryStats = {
        totalEvents: 1000,
        maxEvents: 10000,
        usagePercent: 0.1
      };

      const prometheus = collector.exportPrometheusFormat(windowStates, observers, memoryStats, 5, 3);

      expect(prometheus).toContain('esa_events_received_total 100');
      expect(prometheus).toContain('esa_analysis_total 1');
      expect(prometheus).toContain('esa_memory_events_total 1000');
      expect(prometheus).toContain('esa_observers_active 5');
      expect(prometheus).toContain('# HELP');
      expect(prometheus).toContain('# TYPE');
    });

    it('should include window metrics per observer', () => {
      const windowStates = new Map([
        ['observer-1', {
          observerId: 'observer-1',
          eventIds: ['evt-1', 'evt-2'],
          windowStartedAt: new Date(Date.now() - 60000).toISOString(),
          lastEventAt: new Date().toISOString()
        }]
      ]);

      const observers = new Map([
        ['observer-1', { window: { type: 'sliding' } }]
      ]);

      const memoryStats = {
        totalEvents: 2,
        maxEvents: 10000,
        usagePercent: 0.0002
      };

      const prometheus = collector.exportPrometheusFormat(windowStates, observers, memoryStats, 1, 1);

      expect(prometheus).toContain('esa_window_events{observer="observer-1",type="sliding"} 2');
      expect(prometheus).toContain('esa_window_age_ms{observer="observer-1",type="sliding"}');
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      collector.recordEventReceived(100);
      collector.recordAnalysis(200);
      collector.recordError('test_error');

      collector.reset();

      const metrics = collector.getProcessingMetrics();
      expect(metrics.eventsReceived).toBe(0);
      expect(metrics.analysisCount).toBe(0);

      const allMetrics = collector.getAllMetrics(
        new Map(),
        new Map(),
        { totalEvents: 0, maxEvents: 10000, usagePercent: 0 },
        0,
        0
      );
      expect(Object.keys(allMetrics.errors)).toHaveLength(0);
    });
  });
});
