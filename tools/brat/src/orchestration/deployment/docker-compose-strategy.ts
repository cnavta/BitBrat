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
import type { SecureFile } from '../../config/types';
import { DockerOrchestrator, DockerOrchestratorOptions } from '../docker/orchestrator';
import { SecureFilesValidator } from '../../validation/secure-files-validator';
import { ComposeMerger } from '../docker/compose-merger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Docker Compose deployment strategy.
 * Delegates to existing DockerOrchestrator for execution.
 */
export class DockerComposeStrategy implements DeploymentStrategy {
  readonly name = 'docker-compose';
  readonly supportsBulkDeployment = true;

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

    // Sprint 374: Validate and process secureFiles
    const secureFiles = service.secureFiles || [];
    let processedSecureFiles: SecureFile[] = [];

    if (secureFiles.length > 0) {
      // Validate secure files
      const validator = new SecureFilesValidator(process.cwd());
      const validationResult = await validator.validate(secureFiles, context.name);

      // Log warnings (non-fatal)
      if (validationResult.warnings.length > 0) {
        console.warn(
          `[docker-compose-strategy] Secure file warnings for ${service.name}:\n` +
            validationResult.warnings.map((w) => `  - ${w}`).join('\n')
        );
      }

      // Abort on validation errors
      if (!validationResult.valid) {
        throw new Error(
          `Secure file validation failed for ${service.name}:\n` +
            validationResult.errors.map((e) => `  - ${e}`).join('\n')
        );
      }

      // Filter files by current execution context
      processedSecureFiles = secureFiles.filter((file) => {
        if (!file.context) return true; // No context restriction
        return file.context === context.name;
      });

      console.log(
        `[docker-compose-strategy] ${processedSecureFiles.length} secure file(s) applicable for context '${context.name}'`
      );
    }

    // Prepare metadata
    const metadata: DeploymentPlan['metadata'] = {
      dockerfilePath: this.getDockerfilePath(service),
      composeFilePath: this.getComposeFilePath(context, service),
      remoteHost: isRemote ? dockerConfig.host : undefined,
      remoteDir: dockerConfig.remoteDir,
      deployOptions: options, // Store options for execute() phase
      secureFiles: processedSecureFiles, // Sprint 374: Include processed secure files
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
   * Sprint 375: Now uses ComposeMerger to:
   * 1. Merge service-specific compose files (infrastructure/docker-compose/services/*.compose.yaml)
   * 2. Inject secureFiles volume mounts and environment variables
   * 3. Write temporary merged file for deployment
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
    let tempComposePath: string | null = null;
    let originalComposeContent: string | null = null;

    try {
      // Extract deployment options from plan metadata
      const deployOptions = (plan.metadata.deployOptions || {}) as DeployOptions;
      const repoRoot = process.cwd();
      const baseComposeFilePath = plan.metadata.composeFilePath as string;

      // Sprint 375: Read original compose file FIRST (before any processing)
      // This ensures we can restore even if merge/secureFiles processing fails
      originalComposeContent = await fs.promises.readFile(baseComposeFilePath, 'utf-8');
      tempComposePath = baseComposeFilePath; // Track for cleanup

      // Sprint 375: Merge service-specific compose file with generated compose file
      const serviceComposeFilePath = path.join(
        repoRoot,
        'infrastructure',
        'docker-compose',
        'services',
        `${plan.service.name}.compose.yaml`
      );

      let finalComposeYaml: string;
      const merger = new ComposeMerger();

      // Check if service-specific compose file exists
      if (fs.existsSync(serviceComposeFilePath)) {
        console.log(
          `[docker-compose-strategy] Merging service-specific compose file: ${serviceComposeFilePath}`
        );

        // Read service-specific file (base already read above)
        const serviceYaml = await fs.promises.readFile(serviceComposeFilePath, 'utf-8');

        // Merge service-specific overrides
        const mergeResult = merger.merge(originalComposeContent, serviceYaml, {
          serviceName: plan.service.name,
          validationMode: 'lenient', // Don't fail if service missing
        });

        console.log(
          `[docker-compose-strategy] Merge stats: ` +
            `volumes=${mergeResult.stats.volumesAdded}, ` +
            `env=${mergeResult.stats.environmentAdded}, ` +
            `deps=${mergeResult.stats.dependenciesAdded}`
        );

        finalComposeYaml = mergeResult.yaml;
      } else {
        console.log(
          `[docker-compose-strategy] No service-specific compose file found at ${serviceComposeFilePath}, ` +
            `using base compose only`
        );
        finalComposeYaml = originalComposeContent; // Use already-read content
      }

      // Sprint 374/375: Process secure files
      const secureFiles = (plan.metadata.secureFiles || []) as SecureFile[];
      const isRemote = plan.metadata.remoteHost !== undefined;

      if (secureFiles.length > 0) {
        console.log(
          `[docker-compose-strategy] Processing ${secureFiles.length} secure file(s) for ${plan.service.name}`
        );

        let volumeMounts: string[];
        const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);

        if (!isRemote) {
          // Local deployment: Generate volume mounts with local paths
          volumeMounts = ComposeMerger.generateVolumeMounts(secureFiles, repoRoot);
        } else {
          // Remote deployment: Transfer files via scp first
          const remoteHost = plan.metadata.remoteHost as string;
          const remoteDir = plan.metadata.remoteDir as string;

          if (!remoteDir) {
            throw new Error(
              `Remote directory not configured in context '${plan.context.name}'. ` +
                `Set deployment.docker.remoteDir in architecture.yaml`
            );
          }

          // Transfer files to remote host
          const remotePaths = await this.transferSecureFilesToRemote(
            secureFiles,
            remoteHost,
            remoteDir,
            repoRoot
          );

          // Generate volume mounts using remote paths
          volumeMounts = secureFiles.map((file) => {
            const remotePath = remotePaths.get(file.local)!;
            return `${remotePath}:${file.target}:ro`;
          });

          console.log(
            `[docker-compose-strategy] Transferred ${secureFiles.length} secure file(s) to remote`
          );
        }

        // Inject secureFiles into final compose YAML
        finalComposeYaml = merger.injectSecureFiles(
          finalComposeYaml,
          plan.service.name,
          volumeMounts,
          secureFileEnvVars
        );

        console.log(
          `[docker-compose-strategy] Injected ${volumeMounts.length} volume mount(s) and ` +
            `${Object.keys(secureFileEnvVars).length} environment variable(s)`
        );
      }

      // Write merged content to base path (orchestrator will pick it up)
      await fs.promises.writeFile(baseComposeFilePath, finalComposeYaml, 'utf-8');
      console.log(
        `[docker-compose-strategy] Temporarily replaced ${baseComposeFilePath} with merged content`
      );

      // Map new deployment plan to DockerOrchestratorOptions
      const orchestratorOptions: DockerOrchestratorOptions = {
        repoRoot,
        context: plan.context.name,
        service: plan.service.name,
        dryRun: deployOptions.dryRun || false,
        forceRecreate: deployOptions.forceRecreate || false,
        noCache: deployOptions.forceBuild || false,
        rebuildBase: deployOptions.rebuildBase || false, // Sprint 375: Force rebuild base image
        loki: deployOptions.loki || false, // Enable Loki + Promtail observability stack
        noDeps: deployOptions.noDeps || false, // Don't start linked services
      };

      // Create orchestrator and execute deployment
      const orchestrator = new DockerOrchestrator(orchestratorOptions);
      await orchestrator.up();

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
    } finally {
      // Sprint 375: ALWAYS restore original compose file (success, failure, or early error)
      // This finally block ensures cleanup even if errors occur during:
      // - File reading/merging
      // - SecureFiles processing
      // - File replacement
      // - Orchestrator execution
      if (originalComposeContent !== null && tempComposePath !== null) {
        try {
          await fs.promises.writeFile(tempComposePath, originalComposeContent, 'utf-8');
          console.log(`[docker-compose-strategy] Restored original compose file: ${tempComposePath}`);
        } catch (restoreError: any) {
          // Log restoration failure but don't throw (avoid masking original error)
          console.error(
            `[docker-compose-strategy] CRITICAL: Failed to restore original compose file: ${tempComposePath}`,
            restoreError
          );
          console.error(
            `[docker-compose-strategy] MANUAL RECOVERY REQUIRED: Restore from git or backup`
          );
        }
      }
    }
  }

  /**
   * Generate volume mount strings for secure files (local deployment).
   *
   * Sprint 374: SF-010
   *
   * @param secureFiles - Secure files to mount
   * @param repoRoot - Repository root directory
   * @returns Array of volume mount strings
   */
  private generateVolumeMounts(secureFiles: SecureFile[], repoRoot: string): string[] {
    return secureFiles.map((file) => {
      const absoluteLocal = path.resolve(repoRoot, file.local);
      // Format: <host-path>:<container-path>:ro (read-only)
      return `${absoluteLocal}:${file.target}:ro`;
    });
  }

  /**
   * Transfer secure files to remote Docker host via scp.
   *
   * Sprint 374: SF-012
   *
   * @param secureFiles - Secure files to transfer
   * @param remoteHost - SSH host (format: ssh://user@host or ssh://user@host:port)
   * @param remoteDir - Remote directory (e.g., /opt/BitBratPlatform)
   * @param repoRoot - Local repository root
   * @returns Remote paths for transferred files
   */
  private async transferSecureFilesToRemote(
    secureFiles: SecureFile[],
    remoteHost: string,
    remoteDir: string,
    repoRoot: string
  ): Promise<Map<string, string>> {
    const { execSync } = require('child_process');
    const remotePaths = new Map<string, string>();

    // Parse SSH host (ssh://user@host:port)
    const sshMatch = remoteHost.match(/^ssh:\/\/([^@]+)@([^:]+)(?::(\d+))?$/);
    if (!sshMatch) {
      throw new Error(
        `Invalid SSH host format: ${remoteHost}. ` +
          `Expected: ssh://user@host or ssh://user@host:port`
      );
    }

    const [, user, host, portStr] = sshMatch;
    const port = portStr ? parseInt(portStr, 10) : 22;
    const sshTarget = `${user}@${host}`;

    console.log(`[docker-compose-strategy] Transferring ${secureFiles.length} file(s) to ${sshTarget}...`);

    // Create remote .secure directory
    const remoteSecureDir = `${remoteDir}/.secure`;
    const mkdirCmd = `ssh -p ${port} ${sshTarget} "mkdir -p ${remoteSecureDir}"`;

    try {
      execSync(mkdirCmd, { stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(
        `Failed to create remote directory ${remoteSecureDir}: ${error.message}`
      );
    }

    // Transfer each file
    for (const file of secureFiles) {
      const localPath = path.resolve(repoRoot, file.local);
      const remoteFileName = path.basename(file.local);
      const remotePath = `${remoteSecureDir}/${remoteFileName}`;

      // Transfer file with scp (with retry logic)
      let lastError: Error | null = null;
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const scpCmd = `scp -P ${port} "${localPath}" ${sshTarget}:${remotePath}`;
          execSync(scpCmd, { stdio: 'pipe' });

          // Set permissions (default to 0400 if not specified)
          const perms = file.permissions || '0400';
          const chmodCmd = `ssh -p ${port} ${sshTarget} "chmod ${perms} ${remotePath}"`;
          execSync(chmodCmd, { stdio: 'pipe' });

          console.log(`[docker-compose-strategy] ✓ Transferred ${file.local} → ${remotePath} (${perms})`);

          remotePaths.set(file.local, remotePath);
          lastError = null;
          break; // Success, exit retry loop
        } catch (error: any) {
          lastError = error;

          if (attempt < maxAttempts) {
            const backoffMs = Math.pow(2, attempt) * 1000; // Exponential backoff
            console.warn(
              `[docker-compose-strategy] Transfer failed (attempt ${attempt}/${maxAttempts}), ` +
                `retrying in ${backoffMs}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }

      if (lastError) {
        throw new Error(
          `Failed to transfer ${file.local} after ${maxAttempts} attempts: ${lastError.message}`
        );
      }
    }

    return remotePaths;
  }

  /**
   * Inject volume mounts and environment variables into compose YAML.
   *
   * Sprint 374: SF-011
   *
   * @param composeFilePath - Path to compose file
   * @param serviceName - Service name
   * @param volumeMounts - Volume mount strings
   * @param envVars - Environment variables to add
   * @returns Modified compose file content (YAML string)
   */
  private async injectSecureFileConfig(
    composeFilePath: string,
    serviceName: string,
    volumeMounts: string[],
    envVars: Record<string, string>
  ): Promise<string> {
    const yaml = require('js-yaml');

    // Read existing compose file
    const composeContent = await fs.promises.readFile(composeFilePath, 'utf-8');
    const composeConfig = yaml.load(composeContent);

    // Ensure services object exists
    if (!composeConfig.services) {
      composeConfig.services = {};
    }

    // Ensure service exists in compose file
    if (!composeConfig.services[serviceName]) {
      composeConfig.services[serviceName] = {};
    }

    const serviceConfig = composeConfig.services[serviceName];

    // Inject volume mounts
    if (volumeMounts.length > 0) {
      if (!serviceConfig.volumes) {
        serviceConfig.volumes = [];
      }
      // Add new volume mounts (dedupe if already present)
      for (const mount of volumeMounts) {
        if (!serviceConfig.volumes.includes(mount)) {
          serviceConfig.volumes.push(mount);
        }
      }
    }

    // Inject environment variables
    if (Object.keys(envVars).length > 0) {
      if (!serviceConfig.environment) {
        serviceConfig.environment = {};
      }
      // Merge environment variables
      Object.assign(serviceConfig.environment, envVars);
    }

    // Return modified YAML
    return yaml.dump(composeConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });
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
  /**
   * Deploy all services at once using a single docker compose up.
   * This avoids port conflicts and container recreation issues that occur
   * when deploying services sequentially.
   *
   * @param services - All services to deploy
   * @param context - Resolved execution context
   * @param options - Deployment options
   * @returns Array of deployment results
   */
  async deployAll(
    services: ServiceWithName[],
    context: ResolvedContext,
    options: DeployOptions
  ): Promise<DeploymentResult[]> {
    const startTime = Date.now();
    const repoRoot = process.cwd();

    console.log(`[docker-compose-strategy] Bulk deployment of ${services.length} services`);

    try {
      // Use DockerOrchestrator to deploy all services at once
      const orchestratorOptions: DockerOrchestratorOptions = {
        repoRoot,
        context: context.name,
        service: undefined, // No specific service - deploy all
        dryRun: options.dryRun || false,
        forceRecreate: options.forceRecreate || false,
        noCache: options.forceBuild || false,
        rebuildBase: options.rebuildBase || false,
        loki: options.loki || false,
        noDeps: options.noDeps || false,
      };

      const orchestrator = new DockerOrchestrator(orchestratorOptions);
      await orchestrator.up();

      const durationMs = Date.now() - startTime;

      // Return success for all services
      return services.map((service) => ({
        status: 'success' as const,
        service: service.name,
        durationMs,
        metadata: {
          containerId: `bitbrat-${context.name}-${service.name}`,
        },
      }));
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Return failure for all services
      return services.map((service) => ({
        status: 'failed' as const,
        service: service.name,
        durationMs,
        error: error.message || String(error),
      }));
    }
  }

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
