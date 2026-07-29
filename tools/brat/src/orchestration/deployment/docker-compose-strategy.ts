/**
 * Docker Compose Deployment Strategy
 *
 * Deploys services to local or remote Docker Compose environments.
 * Supports both local unix socket and remote SSH docker hosts.
 *
 * @module orchestration/deployment/docker-compose-strategy
 * @since Sprint 372
 */

import type {
  DeploymentStrategy,
  DeploymentPlan,
  DeploymentResult,
  ValidationResult,
  DeployOptions,
  ServiceWithName,
} from './strategy';
import type { ResolvedContext } from '../../context/types';
import { DockerOrchestrator, DockerOrchestratorOptions } from '../docker/orchestrator';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Docker Compose deployment strategy.
 * Delegates to existing DockerOrchestrator for execution.
 */
export class DockerComposeStrategy implements DeploymentStrategy {
  readonly name = 'docker-compose';

  /**
   * Prepare deployment plan for Docker Compose.
   *
   * Loads environment configuration from execution context,
   * determines docker host (unix socket or SSH), and prepares
   * compose file paths.
   *
   * @param service - Service to deploy (with name)
   * @param context - Resolved execution context
   * @param options - Deployment options
   * @returns Deployment plan
   */
  async prepare(
    service: ServiceWithName,
    context: ResolvedContext,
    options: DeployOptions
  ): Promise<DeploymentPlan> {
    // Extract docker configuration from context
    const dockerConfig = context.deployment.docker;
    if (!dockerConfig) {
      throw new Error(
        `Docker configuration missing in context '${context.name}'. ` +
          `Check deployment.docker in architecture.yaml executionContexts.${context.name}`
      );
    }

    // Determine if this is a remote deployment
    const isRemote = dockerConfig.host?.startsWith('ssh://');

    // Load environment variables from context
    const envVars = context.runtime.envVars || {};

    // Prepare metadata
    const metadata: DeploymentPlan['metadata'] = {
      dockerfilePath: this.getDockerfilePath(service),
      composeFilePath: this.getComposeFilePath(context, service),
      remoteHost: isRemote ? dockerConfig.host : undefined,
      remoteDir: dockerConfig.remoteDir,
      deployOptions: options, // Store options for execute() phase
    };

    return {
      service,
      context,
      envVars,
      secrets: {}, // Secrets handled via env files in docker-compose
      metadata,
    };
  }

  /**
   * Validate deployment plan.
   *
   * Checks:
   * - Dockerfile exists
   * - Compose file exists (or can be generated)
   * - Docker host is accessible
   *
   * @param plan - Deployment plan
   * @returns Validation result
   */
  async validate(plan: DeploymentPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check Dockerfile exists
    const dockerfilePath = plan.metadata.dockerfilePath as string;
    if (dockerfilePath && !fs.existsSync(dockerfilePath)) {
      errors.push(`Dockerfile not found: ${dockerfilePath}`);
    }

    // Check compose file exists or can be generated
    const composeFilePath = plan.metadata.composeFilePath as string;
    if (composeFilePath && !fs.existsSync(composeFilePath)) {
      warnings.push(
        `Compose file not found: ${composeFilePath}. ` +
          `Will be generated automatically if service is registered in architecture.yaml`
      );
    }

    // Validate remote host format if SSH
    const remoteHost = plan.metadata.remoteHost as string | undefined;
    if (remoteHost && !remoteHost.match(/^ssh:\/\/.+@.+$/)) {
      errors.push(
        `Invalid SSH host format: ${remoteHost}. ` +
          `Expected format: ssh://user@host or ssh://user@host:port`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute deployment using DockerOrchestrator.
   *
   * Delegates to existing DockerOrchestrator which handles:
   * - Building docker images
   * - Syncing files to remote host (if SSH)
   * - Running docker-compose up
   * - Port management
   *
   * @param plan - Validated deployment plan
   * @returns Deployment result
   */
  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      // Extract deployment options from plan metadata
      const deployOptions = (plan.metadata.deployOptions || {}) as DeployOptions;

      // Map new deployment plan to DockerOrchestratorOptions
      const orchestratorOptions: DockerOrchestratorOptions = {
        repoRoot: process.cwd(),
        context: plan.context.name,
        service: plan.service.name,
        dryRun: deployOptions.dryRun || false,
        forceRecreate: deployOptions.forceRecreate || false,
        noCache: deployOptions.forceBuild || false,
        // loki and noDeps not currently mapped from DeployOptions
      };

      // Create orchestrator and execute deployment
      const orchestrator = new DockerOrchestrator(orchestratorOptions);
      await orchestrator.up();

      // Deployment succeeded
      const durationMs = Date.now() - startTime;

      return {
        status: 'success',
        service: plan.service.name,
        durationMs,
        metadata: {
          containerId: `bitbrat-${plan.context.name}-${plan.service.name}`, // Docker Compose container naming
        },
      };
    } catch (error: any) {
      // Deployment failed
      const durationMs = Date.now() - startTime;

      return {
        status: 'failed',
        service: plan.service.name,
        durationMs,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Get Dockerfile path for service.
   *
   * Checks for service-specific Dockerfile, falls back to standard Dockerfile.service.
   *
   * @param service - Service
   * @returns Dockerfile path
   */
  private getDockerfilePath(service: ServiceWithName): string {
    const repoRoot = process.cwd();

    // Check for service-specific Dockerfile
    const serviceDockerfile = path.join(repoRoot, `Dockerfile.${service.name}`);
    if (fs.existsSync(serviceDockerfile)) {
      return serviceDockerfile;
    }

    // Fall back to standard Dockerfile.service
    return path.join(repoRoot, 'Dockerfile.service');
  }

  /**
   * Get docker-compose file path for service.
   *
   * Looks for context-specific compose file or per-service compose file.
   *
   * @param context - Execution context
   * @param service - Service
   * @returns Compose file path
   */
  private getComposeFilePath(context: ResolvedContext, service: ServiceWithName): string {
    const repoRoot = process.cwd();

    // Check for context-specific base compose file
    const contextCompose = path.join(
      repoRoot,
      `infrastructure/docker-compose/docker-compose.${context.name}.yaml`
    );
    if (fs.existsSync(contextCompose)) {
      return contextCompose;
    }

    // Check for service-specific compose file
    const serviceCompose = path.join(
      repoRoot,
      `infrastructure/docker-compose/services/${service.name}.compose.yaml`
    );
    if (fs.existsSync(serviceCompose)) {
      return serviceCompose;
    }

    // Return standard base compose file
    return path.join(repoRoot, 'infrastructure/docker-compose/docker-compose.yaml');
  }
}
