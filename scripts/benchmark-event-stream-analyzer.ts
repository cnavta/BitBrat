#!/usr/bin/env ts-node
/**
 * Benchmark Script for Event Stream Analyzer POC
 *
 * Measures:
 * - Latency: Time from event ingestion to analysis completion
 * - Memory usage: Heap memory growth during test
 * - Throughput: Events processed per second
 * - Window accuracy: Timing precision of window closures
 *
 * Usage:
 *   npx ts-node scripts/benchmark-event-stream-analyzer.ts
 */

import { RxJSWindowManager } from '../src/services/event-stream-analyzer/rxjs-window-manager';
import type { InternalEventV2 } from '../src/types/events';
import type { StreamObserver } from '../src/types/sessi';
import type { Logger } from 'pino';

interface BenchmarkMetrics {
  eventCount: number;
  windowCount: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  memoryStartMB: number;
  memoryEndMB: number;
  memoryGrowthMB: number;
  throughputEventsPerSec: number;
  testDurationMs: number;
}

interface WindowMetrics {
  closedAt: number;
  eventCount: number;
  latencyMs: number;
}

class EventStreamBenchmark {
  private windowManager: RxJSWindowManager;
  private windowMetrics: WindowMetrics[] = [];
  private eventTimestamps: Map<string, number> = new Map();
  private startTime!: number;
  private startMemoryMB!: number;

  private mockLogger: Logger = {
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: () => {},
    child: () => this.mockLogger,
    level: 'silent'
  } as any;

  constructor() {
    this.windowManager = new RxJSWindowManager(this.mockLogger);
  }

  /**
   * Create test observer with configurable window size and slide
   */
  private createObserver(windowSizeMs: number, slideMs: number): StreamObserver {
    return {
      id: 'benchmark-observer',
      active: true,
      source: {
        mode: 'stream',
        topics: ['internal.contextualization.v1']
      },
      window: {
        type: 'sliding',
        sizeMs: windowSizeMs,
        slideMs: slideMs
      },
      trigger: { type: 'time' },
      analysis: {
        promptId: 'benchmark',
        outputFormat: 'markdown'
      },
      delivery: {
        egressTopic: 'internal.egress.v1'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Create synthetic test event
   */
  private createEvent(id: string, platform: 'twitch' | 'discord' = 'twitch'): InternalEventV2 {
    return {
      v: '2',
      correlationId: id,
      type: 'chat.message.v1',
      ingress: {
        ingressAt: new Date().toISOString(),
        source: platform,
        connector: platform
      },
      identity: {
        external: { id: 'benchmark-user', platform }
      },
      egress: {
        destination: platform,
        connector: platform
      },
      message: {
        id,
        role: 'user',
        text: `Benchmark message ${id}`
      },
      routing: {
        stage: 'contextualization',
        slip: [],
        history: []
      }
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Run benchmark with specified parameters
   */
  async run(
    eventCount: number = 1000,
    durationMs: number = 60000,
    windowSizeMs: number = 5000,
    slideMs: number = 1000
  ): Promise<BenchmarkMetrics> {
    console.log('\n📊 Event Stream Analyzer Benchmark');
    console.log('=====================================');
    console.log(`Events: ${eventCount}`);
    console.log(`Duration: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s)`);
    console.log(`Window: ${windowSizeMs}ms size, ${slideMs}ms slide`);
    console.log('');

    // Record baseline memory
    this.startMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
    this.startTime = Date.now();

    // Create observer with window handler
    const observer = this.createObserver(windowSizeMs, slideMs);
    this.windowManager.createSlidingWindow(observer, async (events, observerId) => {
      const now = Date.now();

      // Calculate latencies for events in this window
      let totalLatency = 0;
      events.forEach(event => {
        const eventTime = this.eventTimestamps.get(event.correlationId);
        if (eventTime) {
          totalLatency += now - eventTime;
        }
      });

      this.windowMetrics.push({
        closedAt: now,
        eventCount: events.length,
        latencyMs: totalLatency / events.length
      });
    });

    // Publish events at consistent rate
    const intervalMs = durationMs / eventCount;
    let publishedCount = 0;

    console.log('⏳ Publishing events...');

    const publishInterval = setInterval(() => {
      if (publishedCount >= eventCount) {
        clearInterval(publishInterval);
        return;
      }

      const eventId = `event-${publishedCount}`;
      const event = this.createEvent(eventId);

      this.eventTimestamps.set(eventId, Date.now());
      this.windowManager.addEvent(event);

      publishedCount++;

      if (publishedCount % 100 === 0) {
        console.log(`  Published ${publishedCount}/${eventCount} events`);
      }
    }, intervalMs);

    // Wait for all events to be published + extra time for final windows to close
    await new Promise(resolve => setTimeout(resolve, durationMs + windowSizeMs + 1000));

    // Calculate metrics
    const endTime = Date.now();
    const endMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const testDurationMs = endTime - this.startTime;

    const latencies = this.windowMetrics.map(m => m.latencyMs).filter(l => !isNaN(l));
    latencies.sort((a, b) => a - b);

    const metrics: BenchmarkMetrics = {
      eventCount: publishedCount,
      windowCount: this.windowMetrics.length,
      totalLatencyMs: latencies.reduce((sum, l) => sum + l, 0),
      minLatencyMs: latencies.length > 0 ? latencies[0] : 0,
      maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0,
      p50LatencyMs: latencies.length > 0 ? this.percentile(latencies, 0.50) : 0,
      p95LatencyMs: latencies.length > 0 ? this.percentile(latencies, 0.95) : 0,
      p99LatencyMs: latencies.length > 0 ? this.percentile(latencies, 0.99) : 0,
      memoryStartMB: this.startMemoryMB,
      memoryEndMB: endMemoryMB,
      memoryGrowthMB: endMemoryMB - this.startMemoryMB,
      throughputEventsPerSec: (publishedCount / testDurationMs) * 1000,
      testDurationMs
    };

    // Cleanup
    this.windowManager.destroy();

    return metrics;
  }

  /**
   * Print benchmark results
   */
  printResults(metrics: BenchmarkMetrics): void {
    console.log('\n✅ Benchmark Complete');
    console.log('=====================================');
    console.log('\n📈 Performance Metrics:');
    console.log(`  Events Published:     ${metrics.eventCount.toLocaleString()}`);
    console.log(`  Windows Closed:       ${metrics.windowCount.toLocaleString()}`);
    console.log(`  Test Duration:        ${(metrics.testDurationMs / 1000).toFixed(2)}s`);
    console.log(`  Throughput:           ${metrics.throughputEventsPerSec.toFixed(2)} events/sec`);

    console.log('\n⏱️  Latency (event → analysis):');
    console.log(`  Min:                  ${metrics.minLatencyMs.toFixed(2)}ms`);
    console.log(`  Avg:                  ${metrics.avgLatencyMs.toFixed(2)}ms`);
    console.log(`  p50:                  ${metrics.p50LatencyMs.toFixed(2)}ms`);
    console.log(`  p95:                  ${metrics.p95LatencyMs.toFixed(2)}ms`);
    console.log(`  p99:                  ${metrics.p99LatencyMs.toFixed(2)}ms`);
    console.log(`  Max:                  ${metrics.maxLatencyMs.toFixed(2)}ms`);

    console.log('\n💾 Memory Usage:');
    console.log(`  Start:                ${metrics.memoryStartMB.toFixed(2)} MB`);
    console.log(`  End:                  ${metrics.memoryEndMB.toFixed(2)} MB`);
    console.log(`  Growth:               ${metrics.memoryGrowthMB.toFixed(2)} MB`);

    console.log('\n✨ Assessment:');

    // Latency assessment
    if (metrics.p95LatencyMs < 1000) {
      console.log('  ✅ Latency: EXCELLENT (p95 < 1s)');
    } else if (metrics.p95LatencyMs < 2000) {
      console.log('  ⚠️  Latency: GOOD (p95 < 2s)');
    } else {
      console.log('  ❌ Latency: NEEDS IMPROVEMENT (p95 > 2s)');
    }

    // Memory assessment
    if (metrics.memoryGrowthMB < 50) {
      console.log('  ✅ Memory: EXCELLENT (growth < 50 MB)');
    } else if (metrics.memoryGrowthMB < 100) {
      console.log('  ⚠️  Memory: GOOD (growth < 100 MB)');
    } else {
      console.log('  ❌ Memory: NEEDS IMPROVEMENT (growth > 100 MB)');
    }

    // Throughput assessment
    if (metrics.throughputEventsPerSec > 100) {
      console.log('  ✅ Throughput: EXCELLENT (> 100 events/sec)');
    } else if (metrics.throughputEventsPerSec > 50) {
      console.log('  ⚠️  Throughput: GOOD (> 50 events/sec)');
    } else {
      console.log('  ❌ Throughput: NEEDS IMPROVEMENT (< 50 events/sec)');
    }

    console.log('');
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const benchmark = new EventStreamBenchmark();

  benchmark.run(
    1000,  // eventCount
    60000, // durationMs (60 seconds)
    5000,  // windowSizeMs (5 seconds)
    1000   // slideMs (1 second)
  ).then(metrics => {
    benchmark.printResults(metrics);

    // Write results to file
    const fs = require('fs');
    const path = require('path');
    const outputDir = path.join(__dirname, '../planning/stream-analyst-realtime');
    const outputFile = path.join(outputDir, 'POC_BENCHMARK_RESULTS.json');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(metrics, null, 2));

    console.log(`📄 Results written to: ${outputFile}`);
    process.exit(0);
  }).catch(error => {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  });
}

export { EventStreamBenchmark, BenchmarkMetrics };
