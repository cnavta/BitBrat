/**
 * Health Gate - Unified infrastructure health check system
 *
 * Replaces fragmented health check logic:
 * - waitForPostgres() in context/create.ts
 * - validatePostgresConnection() in context-resolver.ts
 * - docker-compose health check waits
 *
 * Provides parallel health checks with detailed error messages.
 *
 * @module infrastructure/health-gate
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { InfrastructureSpec } from './types';

const execAsync = promisify(exec);

/**
 * Logger interface for progress reporting
 */
export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * Options for waitForInfrastructure
 */
export interface WaitOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;

  /** Run health checks in parallel (default: true) */
  parallel?: boolean;

  /** Logger for progress reporting */
  logger?: Logger;
}

/**
 * HealthGate - Unified health check system for infrastructure
 *
 * Core responsibilities:
 * 1. Wait for infrastructure services to be ready
 * 2. Execute health checks in parallel for performance
 * 3. Provide detailed error messages on timeout
 * 4. Support various health check types (CMD, CMD-SHELL, docker exec)
 *
 * @example
 * ```typescript
 * const specs = InfrastructureRegistry.getRequiredInfrastructure(repoRoot, 'local', services);
 *
 * await HealthGate.waitForInfrastructure(specs, {
 *   timeout: 60000,
 *   parallel: true,
 *   logger: myLogger
 * });
 * ```
 */
export class HealthGate {
  /**
   * Wait for all infrastructure services to be healthy
   *
   * Replaces:
   * - waitForPostgres() in context/create.ts
   * - validatePostgresConnection() in context-resolver.ts
   * - docker-compose health check waits
   *
   * @param specs - Infrastructure specs to wait for
   * @param options - Wait options (timeout, parallel, logger)
   * @throws Error with detailed troubleshooting if timeout
   *
   * @example
   * ```typescript
   * await HealthGate.waitForInfrastructure([natSpec, redisSpec, postgresSpec], {
   *   timeout: 60000,
   *   logger: console
   * });
   * ```
   */
  static async waitForInfrastructure(
    specs: InfrastructureSpec[],
    options: WaitOptions = {}
  ): Promise<void> {
    const { timeout = 60000, parallel = true, logger } = options;

    if (specs.length === 0) {
      logger?.info('No infrastructure services to wait for');
      return;
    }

    logger?.info(`Waiting for ${specs.length} infrastructure service(s) to be ready...`);

    const checks = specs.map((spec) => ({
      spec,
      check: () => this.pollUntilHealthy(spec, timeout, logger),
    }));

    if (parallel) {
      await this.waitParallel(checks, logger);
    } else {
      await this.waitSequential(checks, logger);
    }

    logger?.info('✓ All infrastructure services are healthy');
  }

  /**
   * Wait for health checks in parallel
   *
   * @param checks - Array of health check functions
   * @param logger - Optional logger
   * @throws Error if any health check fails
   * @internal
   */
  private static async waitParallel(
    checks: Array<{ spec: InfrastructureSpec; check: () => Promise<void> }>,
    logger?: Logger
  ): Promise<void> {
    const results = await Promise.allSettled(checks.map((c) => c.check()));

    const failures = results
      .map((r, i) => ({ result: r, spec: checks[i].spec }))
      .filter((x) => x.result.status === 'rejected');

    if (failures.length > 0) {
      const errors = failures
        .map((f) => {
          const reason =
            f.result.status === 'rejected' ? f.result.reason : 'Unknown error';
          return `  - ${f.spec.serviceName || f.spec.type}: ${reason}`;
        })
        .join('\n');

      throw new Error(
        `Infrastructure health check failed:\n${errors}\n\n` +
          `Troubleshooting:\n` +
          `1. Check services are running: docker ps\n` +
          `2. Check service logs: docker logs <container>\n` +
          `3. Verify health checks in architecture.yaml\n` +
          `See: documentation/troubleshooting/infrastructure.md`
      );
    }
  }

  /**
   * Wait for health checks sequentially
   *
   * @param checks - Array of health check functions
   * @param logger - Optional logger
   * @throws Error if any health check fails
   * @internal
   */
  private static async waitSequential(
    checks: Array<{ spec: InfrastructureSpec; check: () => Promise<void> }>,
    logger?: Logger
  ): Promise<void> {
    for (const { spec, check } of checks) {
      logger?.info(`Waiting for ${spec.serviceName || spec.type}...`);
      await check();
    }
  }

  /**
   * Poll until a service is healthy (with timeout)
   *
   * @param spec - Infrastructure spec
   * @param timeout - Timeout in milliseconds
   * @param logger - Optional logger
   * @throws Error on timeout
   * @internal
   */
  private static async pollUntilHealthy(
    spec: InfrastructureSpec,
    timeout: number,
    logger?: Logger
  ): Promise<void> {
    const start = Date.now();
    const interval = 2000; // Poll every 2 seconds
    const serviceName = spec.serviceName || spec.type || 'unknown';

    while (Date.now() - start < timeout) {
      try {
        const healthy = await this.checkHealth(spec);
        if (healthy) {
          logger?.info(`✓ ${serviceName} is healthy`);
          return;
        }
      } catch (error) {
        // Ignore errors during polling, just retry
        logger?.debug(
          `Health check failed for ${serviceName}, retrying... (${error instanceof Error ? error.message : String(error)})`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    // Timeout reached
    const elapsed = Math.round((Date.now() - start) / 1000);
    throw new Error(
      `Timeout after ${elapsed}s waiting for ${serviceName}\n\n` +
        `Troubleshooting:\n` +
        `1. Check service is running: docker ps --filter name=${serviceName}\n` +
        `2. Check service logs: docker logs bitbrat-${serviceName}-1\n` +
        `3. Verify health check: ${spec.healthCheck ? JSON.stringify(spec.healthCheck.test) : 'No health check defined'}\n` +
        `4. Check configuration in architecture.yaml: infrastructure.${spec.provider}.${spec.capability}\n\n` +
        `If the service is running but health checks are failing, check:\n` +
        `- Network connectivity (can the health check reach the service?)\n` +
        `- Service logs for startup errors\n` +
        `- Health check command is correct for the service version`
    );
  }

  /**
   * Check if a specific infrastructure service is healthy
   *
   * Supports various health check types:
   * - CMD: Execute command directly
   * - CMD-SHELL: Execute command in shell
   * - docker exec: Execute inside container
   *
   * @param spec - Infrastructure spec with health check
   * @returns True if healthy, false otherwise
   *
   * @example
   * ```typescript
   * const healthy = await HealthGate.checkHealth(postgresSpec);
   * if (healthy) {
   *   console.log('PostgreSQL is ready');
   * }
   * ```
   */
  static async checkHealth(spec: InfrastructureSpec): Promise<boolean> {
    if (!spec.healthCheck) {
      // No health check defined, assume healthy
      return true;
    }

    const { test } = spec.healthCheck;
    if (!test || test.length === 0) {
      return true;
    }

    const [cmdType, ...cmdArgs] = test;

    try {
      if (cmdType === 'CMD' || cmdType === 'CMD-SHELL') {
        // Execute command directly or in shell
        const command = cmdType === 'CMD' ? cmdArgs.join(' ') : cmdArgs[0];
        const { stdout, stderr } = await execAsync(command, {
          timeout: 5000, // 5s timeout per check
        });

        // Command succeeded (exit code 0)
        return true;
      } else if (cmdType === 'docker') {
        // Docker exec format: ['docker', 'exec', 'container', 'command']
        const command = test.join(' ');
        const { stdout, stderr } = await execAsync(command, {
          timeout: 5000,
        });

        return true;
      } else {
        // Unknown command type, log warning and assume healthy
        console.warn(
          `Unknown health check command type: ${cmdType} for ${spec.serviceName || spec.type}`
        );
        return true;
      }
    } catch (error) {
      // Health check failed (non-zero exit code or error)
      return false;
    }
  }

  /**
   * Check health for a specific service by name
   *
   * Convenience method for checking a single service when you don't have
   * the full InfrastructureSpec.
   *
   * @param serviceName - Service name (e.g., 'postgres', 'redis', 'nats')
   * @param healthCheck - Health check configuration
   * @returns True if healthy, false otherwise
   *
   * @example
   * ```typescript
   * const healthy = await HealthGate.checkServiceHealth('postgres', {
   *   test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
   *   interval: '10s',
   *   timeout: '5s'
   * });
   * ```
   */
  static async checkServiceHealth(
    serviceName: string,
    healthCheck: InfrastructureSpec['healthCheck']
  ): Promise<boolean> {
    const spec: InfrastructureSpec = {
      capability: 'unknown',
      provider: 'unknown',
      serviceName,
      config: {},
      healthCheck,
    };

    return this.checkHealth(spec);
  }
}
