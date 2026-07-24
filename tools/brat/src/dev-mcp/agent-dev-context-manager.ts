/**
 * Sprint 358: Agent-Dev Context Manager
 *
 * Manages lifecycle of ephemeral agent-dev execution contexts.
 * Thin wrapper around existing BEC infrastructure with guardrails for agent use.
 *
 * Core responsibilities:
 * - provision(): Create new agent-dev BEC in ephemeral storage
 * - start(): Launch services via DockerOrchestrator
 * - stop(): Gracefully stop services (preserve data)
 * - destroy(): Complete cleanup (containers, volumes, DB, env files)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { randomBytes } from 'crypto';
import {
  buildNonInteractive,
  scaffoldEnvironment,
  waitForPostgres,
  type ContextCreateOptions,
} from '../commands/context/create';
import { DockerOrchestrator } from '../orchestration/docker/orchestrator';
import type { ExecutionContext } from '../config/execution-context-schema';

/**
 * Options for provisioning a new agent-dev context
 */
export interface ProvisionOptions {
  /** Context name (auto-generated if omitted) */
  name?: string;
  /** Deployment profile */
  profile?: 'dev' | 'staging';
  /** Persistence driver */
  persistence?: 'postgres' | 'firestore';
}

/**
 * Result of provisioning operation
 */
export interface ProvisionResult {
  /** Generated or provided context name */
  name: string;
  /** Gateway connection details */
  gateway: {
    url: string;
    authToken?: string;
  };
  /** PostgreSQL connection details */
  postgres: {
    host: string;
    port: number;
    database: string;
  };
  /** Provision status */
  status: 'provisioned';
}

/**
 * Result of start operation
 */
export interface StartResult {
  /** Gateway URL */
  gateway: {
    url: string;
  };
  /** List of running services */
  services: string[];
  /** Status */
  status: 'running';
}

/**
 * Agent-Dev Context Manager
 *
 * Manages ephemeral agent-dev execution contexts with complete lifecycle control.
 */
export class AgentDevContextManager {
  constructor(private readonly repoRoot: string) {}

  /**
   * Provision a new agent-dev execution context
   *
   * Creates:
   * - Entry in .brat/ephemeral-contexts.yaml
   * - Environment directory (env/agent-dev-{timestamp}-{random}/)
   * - Service configuration files (global.yaml, infra.yaml, service yamls)
   * - Seeded PostgreSQL database with routing rules and personalities
   *
   * @param options - Provision options
   * @returns Provision result with context name and connection details
   * @throws Error if context already exists or provisioning fails
   */
  async provision(options: ProvisionOptions = {}): Promise<ProvisionResult> {
    // Generate unique context name
    const contextName = options.name || this.generateContextName();

    // Validate context name format (must be agent-dev-* for safety)
    if (!contextName.startsWith('agent-dev-')) {
      throw new Error(
        `Invalid context name: '${contextName}'. Agent-dev contexts must start with 'agent-dev-'`
      );
    }

    // Check if context already exists (in ephemeral storage)
    if (await this.contextExists(contextName)) {
      throw new Error(
        `Context '${contextName}' already exists. Use a different name or destroy the existing context first.`
      );
    }

    // Build context configuration using existing infrastructure
    const contextConfig = await buildNonInteractive({
      nonInteractive: true,
      type: 'docker-compose',
      description: `Ephemeral agent development context (created ${new Date().toISOString()})`,
      persistenceDriver: options.persistence || 'postgres',
      dockerHost: 'unix:///var/run/docker.sock', // Local Docker only for agent-dev
      pgHost: undefined, // Auto-discover from docker-compose
      tags: 'development,agent-dev,ephemeral',
      envPath: `env/${contextName}`, // Sprint 358: Set env overlay path for agent-dev contexts
    });

    // Add metadata for tracking
    contextConfig.metadata = {
      createdBy: 'agent',
      createdAt: new Date().toISOString(),
      autoDestroy: true,
    };

    // Write to ephemeral storage (.brat/ephemeral-contexts.yaml)
    await this.writeToEphemeralStorage(contextName, contextConfig);

    // Scaffold environment directory
    await scaffoldEnvironment(this.repoRoot, contextName, contextConfig);

    // Return provision result
    const persistence = contextConfig.runtime.persistence;
    const gateway = contextConfig.runtime.gateway;

    return {
      name: contextName,
      gateway: {
        url: gateway.url || `ws://localhost:${gateway.fallbackPort || 3004}/ws/v1`,
        authToken: gateway.authToken,
      },
      postgres: {
        host: persistence.connection?.host || 'localhost',
        port: persistence.connection?.port || 5432,
        database: persistence.connection?.database || 'bitbrat',
      },
      status: 'provisioned',
    };
  }

  /**
   * Start all services in the agent-dev context
   *
   * Delegates to DockerOrchestrator.up() and waits for service readiness.
   *
   * @param contextName - Context name to start
   * @param service - Optional: start only this service
   * @returns Start result with gateway URL and running services
   * @throws Error if context doesn't exist or start fails
   */
  async start(contextName: string, service?: string): Promise<StartResult> {
    // Validate context exists
    if (!(await this.contextExists(contextName))) {
      throw new Error(
        `Context '${contextName}' not found. Run agent_dev.provision first.`
      );
    }

    // Validate agent-dev context
    this.validateAgentDevContext(contextName);

    // Start services via DockerOrchestrator
    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: contextName,
      service,
      dryRun: false,
      loki: false,
    });

    await orchestrator.up();

    // Wait for PostgreSQL readiness (30s timeout)
    try {
      await waitForPostgres(30);
    } catch (error) {
      throw new Error(
        `PostgreSQL did not become ready within 30 seconds. ` +
        `Check logs: fleet.logs({ context: '${contextName}', bit: 'postgres' })`
      );
    }

    // Wait for NATS readiness (Sprint 358, Phase 3)
    try {
      await this.waitForNats(contextName, 10);
    } catch (error) {
      // NATS is not critical for basic operation, log warning but continue
      console.warn(`Warning: NATS may not be fully ready: ${(error as Error).message}`);
      // Give it a few more seconds
      await this.sleep(3000);
    }

    // Seed database if not already seeded
    await this.seedDatabaseIfNeeded(contextName);

    // Get gateway URL from context config
    const contextConfig = await this.getRawContext(contextName);
    const gatewayConfig = contextConfig?.runtime.gateway;
    const gatewayUrl = gatewayConfig?.url || `ws://localhost:${gatewayConfig?.fallbackPort || 3004}/ws/v1`;

    // Return start result
    return {
      gateway: {
        url: gatewayUrl,
      },
      services: service ? [service] : ['all'],
      status: 'running',
    };
  }

  /**
   * Stop all services in the agent-dev context (preserve data for restart)
   *
   * Delegates to DockerOrchestrator.down() without volume removal.
   *
   * @param contextName - Context name to stop
   * @throws Error if context doesn't exist or stop fails
   */
  async stop(contextName: string): Promise<void> {
    // Validate context exists
    if (!(await this.contextExists(contextName))) {
      throw new Error(
        `Context '${contextName}' not found.`
      );
    }

    // Validate agent-dev context
    this.validateAgentDevContext(contextName);

    // Stop services via DockerOrchestrator
    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: contextName,
      dryRun: false,
      loki: false,
    });

    await orchestrator.down();

    // Sprint 358: Wait for Docker to release ports (critical for E2E tests)
    // Docker Compose 'down' returns before ports are fully released
    await this.sleep(2000);
  }

  /**
   * Destroy agent-dev context and cleanup all resources
   *
   * Removes:
   * - Docker containers
   * - Docker volumes
   * - PostgreSQL database
   * - Environment directory
   * - Ephemeral context entry
   *
   * @param contextName - Context name to destroy
   * @throws Error if destroy fails (but is idempotent - safe to retry)
   */
  async destroy(contextName: string): Promise<void> {
    // Validate agent-dev context (allow destroy even if doesn't exist for idempotency)
    this.validateAgentDevContext(contextName);

    const errors: string[] = [];

    // Step 1: Stop and remove containers + volumes
    try {
      const orchestrator = new DockerOrchestrator({
        repoRoot: this.repoRoot,
        context: contextName,
        dryRun: false,
        loki: false,
      });

      // DockerOrchestrator.down() doesn't remove volumes by default
      // We need to call docker compose down -v explicitly
      await this.removeContainersAndVolumes(contextName);

      // Sprint 358: Wait for Docker to release ports
      // Critical for E2E tests that run sequentially
      await this.sleep(2000);
    } catch (error) {
      errors.push(`Failed to remove containers/volumes: ${(error as Error).message}`);
    }

    // Step 2: Drop PostgreSQL database
    try {
      await this.dropDatabase(contextName);
    } catch (error) {
      errors.push(`Failed to drop PostgreSQL database: ${(error as Error).message}`);
    }

    // Step 3: Delete environment directory
    try {
      const envDir = path.join(this.repoRoot, 'env', contextName);
      if (fs.existsSync(envDir)) {
        fs.rmSync(envDir, { recursive: true, force: true });
      }
    } catch (error) {
      errors.push(`Failed to delete env directory: ${(error as Error).message}`);
    }

    // Step 4: Remove from ephemeral storage
    try {
      await this.removeFromEphemeralStorage(contextName);
    } catch (error) {
      errors.push(`Failed to remove from ephemeral storage: ${(error as Error).message}`);
    }

    // If any errors occurred, report them (but operation is still partially successful)
    if (errors.length > 0) {
      throw new Error(
        `Destroy completed with ${errors.length} error(s):\n` +
        errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
      );
    }

    // Sprint 358: Phase 3 - Validate cleanup completion
    await this.validateCleanup(contextName);
  }

  /**
   * Generate unique context name
   * Format: agent-dev-{timestamp}-{random}
   */
  private generateContextName(): string {
    const timestamp = Date.now();
    const random = randomBytes(4).toString('hex');
    return `agent-dev-${timestamp}-${random}`;
  }

  /**
   * Write context to ephemeral storage (.brat/ephemeral-contexts.yaml)
   */
  private async writeToEphemeralStorage(
    name: string,
    config: ExecutionContext
  ): Promise<void> {
    const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');
    const bratDir = path.dirname(ephemeralPath);

    // Create .brat/ directory if it doesn't exist
    if (!fs.existsSync(bratDir)) {
      fs.mkdirSync(bratDir, { recursive: true });
    }

    // Load existing ephemeral contexts (or create empty)
    let ephemeral: any = { executionContexts: {} };
    if (fs.existsSync(ephemeralPath)) {
      try {
        const content = fs.readFileSync(ephemeralPath, 'utf8');
        ephemeral = yaml.load(content) as any;
      } catch (error) {
        // If file is corrupted, start fresh
        ephemeral = { executionContexts: {} };
      }
    }

    // Add new context
    if (!ephemeral.executionContexts) {
      ephemeral.executionContexts = {};
    }
    ephemeral.executionContexts[name] = config;

    // Write back to file
    const newContent = yaml.dump(ephemeral, { indent: 2, lineWidth: 100, noRefs: true });
    fs.writeFileSync(ephemeralPath, newContent, 'utf8');
  }

  /**
   * Remove context from ephemeral storage
   */
  private async removeFromEphemeralStorage(name: string): Promise<void> {
    const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');

    if (!fs.existsSync(ephemeralPath)) {
      return; // Nothing to do
    }

    try {
      const content = fs.readFileSync(ephemeralPath, 'utf8');
      const ephemeral = yaml.load(content) as any;

      if (ephemeral?.executionContexts && ephemeral.executionContexts[name]) {
        delete ephemeral.executionContexts[name];

        // Write back to file
        const newContent = yaml.dump(ephemeral, { indent: 2, lineWidth: 100, noRefs: true });
        fs.writeFileSync(ephemeralPath, newContent, 'utf8');
      }
    } catch (error) {
      throw new Error(`Failed to remove context from ephemeral storage: ${(error as Error).message}`);
    }
  }

  /**
   * Check if context exists in ephemeral storage
   */
  private async contextExists(name: string): Promise<boolean> {
    const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');

    if (!fs.existsSync(ephemeralPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(ephemeralPath, 'utf8');
      const ephemeral = yaml.load(content) as any;
      return !!(ephemeral?.executionContexts && ephemeral.executionContexts[name]);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get raw context configuration from ephemeral storage
   */
  private async getRawContext(name: string): Promise<ExecutionContext | undefined> {
    const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');

    if (!fs.existsSync(ephemeralPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(ephemeralPath, 'utf8');
      const ephemeral = yaml.load(content) as any;
      return ephemeral?.executionContexts?.[name];
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Validate context name is an agent-dev context
   * Prevents agents from destroying local, staging, or prod contexts
   */
  private validateAgentDevContext(contextName: string): void {
    if (!contextName.startsWith('agent-dev-')) {
      throw new Error(
        `Cannot operate on non-agent context: '${contextName}'. ` +
        `Agent-dev tools can only manage contexts starting with 'agent-dev-'.`
      );
    }
  }

  /**
   * Remove Docker containers and volumes for context
   */
  private async removeContainersAndVolumes(contextName: string): Promise<void> {
    // Use docker compose down -v to remove volumes
    const { execCmd } = await import('../orchestration/exec');

    const composeProjectName = `bitbrat-${contextName}`;

    try {
      await execCmd('docker', ['compose', '-p', composeProjectName, 'down', '-v']);
    } catch (error) {
      // Ignore errors if containers don't exist (idempotent)
    }
  }

  /**
   * Drop PostgreSQL database for context
   */
  private async dropDatabase(contextName: string): Promise<void> {
    // Database name follows pattern: bitbrat_agent_dev_{timestamp}_{random}
    // But for simplicity, we just use the default 'bitbrat' database
    // (each context uses same DB but different compose project)

    // For true isolation, we would need separate databases
    // TODO: Implement separate DB per context (Sprint 358 follow-up)

    // For now, we don't drop the shared database
    // The docker volume removal handles data cleanup
  }

  /**
   * Seed database if not already seeded
   */
  private async seedDatabaseIfNeeded(contextName: string): Promise<void> {
    // Set DATABASE_URL for seeding
    const connectionString = 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';
    process.env.DATABASE_URL = connectionString;

    try {
      // Import seeding functions directly to avoid cmdSeed's process.exit() calls
      const { seedPostgres } = await import('../seeding/postgres-seed-writer');

      const seedingOptions = {
        contextName,
        botName: 'BitBrat',
        dryRun: false,
        wipe: false,
        apiToken: undefined,
      };

      await seedPostgres(connectionString, seedingOptions);
    } catch (error) {
      // Log warning but don't fail - database seeding is not critical for context start
      console.warn(`Warning: Database seeding failed: ${(error as Error).message}`);
    }
  }

  /**
   * Wait for NATS to be ready
   * Sprint 358: Phase 3 - Proper health check for NATS
   *
   * @param contextName - Context name
   * @param timeoutSeconds - Timeout in seconds
   */
  private async waitForNats(contextName: string, timeoutSeconds: number): Promise<void> {
    const { execCmd } = await import('../orchestration/exec');
    const composeProjectName = `bitbrat-${contextName}`;

    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check if NATS container is running and healthy
        const result = await execCmd('docker', [
          'compose',
          '-p',
          composeProjectName,
          'exec',
          '-T',
          'nats',
          'nats',
          'server',
          'ping',
        ]);

        if (result.code === 0) {
          return; // NATS is ready
        }
      } catch (error) {
        // Container might not be ready yet, continue waiting
      }

      // Wait 1 second before retrying
      await this.sleep(1000);
    }

    throw new Error(`NATS did not become ready within ${timeoutSeconds} seconds`);
  }

  /**
   * Sleep utility for waiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate complete cleanup after destroy
   * Sprint 358: Phase 3 - Verify all resources removed
   *
   * @param contextName - Context name to validate
   * @throws Error if cleanup validation finds remaining resources
   */
  private async validateCleanup(contextName: string): Promise<void> {
    const { execCmd } = await import('../orchestration/exec');
    const composeProjectName = `bitbrat-${contextName}`;
    const errors: string[] = [];

    // Check 1: Verify Docker containers removed
    try {
      const containerCheck = await execCmd('docker', ['ps', '-a', '--filter', `name=${composeProjectName}`, '--format', '{{.Names}}']);
      if (containerCheck.stdout && containerCheck.stdout.trim() !== '') {
        errors.push(`Docker containers still exist: ${containerCheck.stdout.trim()}`);
      }
    } catch (error) {
      // Ignore errors - docker command might fail if no containers found
    }

    // Check 2: Verify Docker volumes removed
    try {
      const volumeCheck = await execCmd('docker', ['volume', 'ls', '--filter', `name=${composeProjectName}`, '--format', '{{.Name}}']);
      if (volumeCheck.stdout && volumeCheck.stdout.trim() !== '') {
        errors.push(`Docker volumes still exist: ${volumeCheck.stdout.trim()}`);
      }
    } catch (error) {
      // Ignore errors - docker command might fail if no volumes found
    }

    // Check 3: Verify environment directory removed
    const envDir = path.join(this.repoRoot, 'env', contextName);
    if (fs.existsSync(envDir)) {
      errors.push(`Environment directory still exists: ${envDir}`);
    }

    // Check 4: Verify ephemeral context entry removed
    const ephemeralPath = path.join(this.repoRoot, '.brat', 'ephemeral-contexts.yaml');
    if (fs.existsSync(ephemeralPath)) {
      try {
        const content = fs.readFileSync(ephemeralPath, 'utf8');
        if (content.includes(contextName)) {
          errors.push(`Ephemeral context entry still exists in ${ephemeralPath}`);
        }
      } catch (error) {
        // Ignore read errors
      }
    }

    // Report validation errors
    if (errors.length > 0) {
      throw new Error(
        `Cleanup validation failed - ${errors.length} resource(s) remain:\n` +
        errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
      );
    }
  }
}
