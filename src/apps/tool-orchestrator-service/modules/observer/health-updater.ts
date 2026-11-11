/**
 * Health Updater Module
 * Periodically queries ToolObserver and updates ToolRegistry health status
 * Sprint 59: Observability - ToolObserver + Loki Integration
 */

import { Logger } from 'pino';
import { ToolObserver } from './tool-observer';
import { IToolRegistry } from '../registry/interfaces';
import { HealthStatus } from '../types';

export interface HealthUpdaterConfig {
  /**
   * How often to update health status (default: 5 minutes)
   */
  updateIntervalMs: number;

  /**
   * How long ago last invocation can be before marking unhealthy (default: 1 hour)
   */
  staleThresholdMs: number;

  /**
   * Error rate threshold for healthy status (default: 0.05 = 5%)
   */
  healthyErrorThreshold: number;

  /**
   * Error rate threshold for degraded status (default: 0.20 = 20%)
   */
  degradedErrorThreshold: number;
}

export class HealthUpdater {
  private updateTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly observer: ToolObserver,
    private readonly registry: IToolRegistry,
    private readonly config: HealthUpdaterConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Start the background health update job
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('health_updater.already_running');
      return;
    }

    this.isRunning = true;
    this.logger.info({
      intervalMs: this.config.updateIntervalMs,
      staleThresholdMs: this.config.staleThresholdMs,
    }, 'health_updater.started');

    // Run immediately on start
    this.updateHealthStatus().catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error({
        error: errorMessage,
      }, 'health_updater.initial_update_failed');
    });

    // Then schedule periodic updates
    this.updateTimer = setInterval(() => {
      this.updateHealthStatus().catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error({
          error: errorMessage,
        }, 'health_updater.periodic_update_failed');
      });
    }, this.config.updateIntervalMs);
  }

  /**
   * Stop the background health update job
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    this.isRunning = false;
    this.logger.info('health_updater.stopped');
  }

  /**
   * Manually trigger health status update
   */
  async updateHealthStatus(): Promise<void> {
    this.logger.debug('health_updater.update_started');

    try {
      // Get all registered tools
      const allTools = await this.registry.queryTools({});

      this.logger.debug({
        toolCount: allTools.length,
      }, 'health_updater.querying_tools');

      const now = Date.now();
      const timeRange = {
        start: new Date(now - this.config.staleThresholdMs).toISOString(),
        end: new Date(now).toISOString(),
      };

      // Update health for each tool
      let updatedCount = 0;
      let errorCount = 0;

      for (const tool of allTools) {
        try {
          const metrics = await this.observer.queryToolMetrics(tool.id, timeRange);
          const healthStatus = this.deriveHealthStatus(metrics, now);

          // Include timestamps from metrics
          await this.registry.updateHealth(tool.id, {
            status: healthStatus.status,
            lastError: healthStatus.lastError,
            lastInvocationAt: metrics.lastInvocationAt,
            lastSuccessAt: metrics.lastSuccessAt,
            lastErrorAt: metrics.lastErrorAt,
          });
          updatedCount++;

          this.logger.debug({
            toolId: tool.id,
            status: healthStatus.status,
            totalInvocations: metrics.totalInvocations,
            errorRate: metrics.errorRate,
          }, 'health_updater.tool_updated');
        } catch (err) {
          errorCount++;
          this.logger.warn({
            toolId: tool.id,
            error: err instanceof Error ? err.message : String(err),
          }, 'health_updater.tool_update_failed');
        }
      }

      this.logger.info({
        totalTools: allTools.length,
        updated: updatedCount,
        errors: errorCount,
      }, 'health_updater.update_complete');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error({
        error: errorMessage,
      }, 'health_updater.update_failed');
      throw err;
    }
  }

  /**
   * Derive health status from tool metrics
   */
  private deriveHealthStatus(
    metrics: {
      totalInvocations: number;
      successCount: number;
      errorCount: number;
      errorRate: number;
      lastInvocationAt?: string;
      lastSuccessAt?: string;
      lastErrorAt?: string;
    },
    nowMs: number
  ): { status: HealthStatus; lastError?: string } {
    const lastInvocationMs = metrics.lastInvocationAt
      ? new Date(metrics.lastInvocationAt).getTime()
      : 0;

    const timeSinceLastInvocation = nowMs - lastInvocationMs;

    // No recent invocations → unhealthy
    if (
      metrics.totalInvocations === 0 ||
      timeSinceLastInvocation > this.config.staleThresholdMs
    ) {
      return {
        status: 'unhealthy',
        lastError:
          metrics.totalInvocations === 0
            ? 'No invocations found'
            : `No invocations in last ${Math.round(timeSinceLastInvocation / (60 * 1000))} minutes`,
      };
    }

    // Error rate > 20% → unhealthy
    if (metrics.errorRate > this.config.degradedErrorThreshold) {
      return {
        status: 'unhealthy',
        lastError: `High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
      };
    }

    // Error rate 5-20% → degraded
    if (metrics.errorRate > this.config.healthyErrorThreshold) {
      return {
        status: 'degraded',
        lastError: `Elevated error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
      };
    }

    // Recent invocations, error rate < 5% → healthy
    return {
      status: 'healthy',
    };
  }
}
