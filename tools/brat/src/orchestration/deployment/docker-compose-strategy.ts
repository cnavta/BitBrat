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
import { execCmd } from '../exec';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

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
   * Sprint 378: Enhanced to process service-specific compose files and secureFiles
   * identically to single-service deployments.
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

    // Temporary merged compose file path
    const tempMergedPath = path.join(repoRoot, '.docker-compose.merged.yaml');

    try {
      // ============================================================================
      // STAGE 1: Read base compose file
      // ============================================================================
      // For bulk deployments, use infrastructure-only base file (docker-compose.local.yaml)
      // to avoid circular dependencies from generated context-specific files
      // (e.g., docker-compose.staging.yaml which contains all services with dependencies).
      //
      // The infrastructure-only base contains:
      // - Infrastructure services (nats, postgres, firebase-emulator)
      // - Network definitions
      // - Volume definitions
      // - bitbrat-base build-only service
      //
      // All application services (auth, tool-gateway, llm-bot, etc.) are added
      // from service-specific compose files to avoid dependency conflicts.
      const baseComposePath = path.join(
        repoRoot,
        'infrastructure/docker-compose/docker-compose.local.yaml'
      );
      let baseYaml = await fs.promises.readFile(baseComposePath, 'utf-8');

      console.log(`[docker-compose-strategy] Base compose file: ${baseComposePath}`);

      // Filter out infrastructure services that aren't needed for this deployment
      // This prevents errors from required variables in unused services (e.g., firebase-emulator)
      const baseCompose = yaml.load(baseYaml) as any;

      // Remove firebase-emulator if using PostgreSQL (not Firestore)
      const persistenceDriver = context.runtime?.persistence?.driver || 'postgres';
      if (persistenceDriver !== 'firestore' && baseCompose.services['firebase-emulator']) {
        delete baseCompose.services['firebase-emulator'];
        console.log(
          `[docker-compose-strategy] Filtered out firebase-emulator (persistence driver: ${persistenceDriver})`
        );
      }

      // Sprint 378: Fix build context paths for services in base file
      // docker-compose.local.yaml uses context: ../.. (from infrastructure/docker-compose/ to repo root)
      // but merged file is at repo root, so context should be . (repo root itself)
      for (const [serviceName, serviceConfig] of Object.entries(baseCompose.services)) {
        const service = serviceConfig as any;
        if (service.build && typeof service.build === 'object') {
          const buildConfig = service.build as any;
          if (buildConfig.context === '../..') {
            buildConfig.context = '.';
            console.log(
              `[docker-compose-strategy] Fixed build context for ${serviceName}: ../.. → .`
            );
          } else if (buildConfig.context === '../../..') {
            buildConfig.context = '..';
            console.log(
              `[docker-compose-strategy] Fixed build context for ${serviceName}: ../../.. → ..`
            );
          }
        }
      }

      // Sprint 378: Fix network declarations - change external: true to external: false
      // so Docker Compose will create the network if it doesn't exist on the remote host
      if (baseCompose.networks && typeof baseCompose.networks === 'object') {
        for (const [networkName, networkConfig] of Object.entries(baseCompose.networks)) {
          const network = networkConfig as any;
          if (network && network.external === true) {
            network.external = false;
            console.log(
              `[docker-compose-strategy] Changed network ${networkName} from external: true → external: false`
            );
          }
        }
      }

      // Convert back to YAML
      baseYaml = yaml.dump(baseCompose, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });

      // ============================================================================
      // STAGE 2: Collect service-specific compose files
      // ============================================================================
      interface ServiceComposeFile {
        service: string;
        path: string;
        yaml: string;
      }

      const serviceFiles: ServiceComposeFile[] = [];
      const collectionErrors: Array<{ service: string; error: string }> = [];

      for (const service of services) {
        const serviceComposePath = path.join(
          repoRoot,
          'infrastructure/docker-compose/services',
          `${service.name}.compose.yaml`
        );

        if (fs.existsSync(serviceComposePath)) {
          try {
            const yaml = await fs.promises.readFile(serviceComposePath, 'utf-8');
            serviceFiles.push({
              service: service.name,
              path: serviceComposePath,
              yaml,
            });

            console.log(
              `[docker-compose-strategy] Found service-specific compose file for ${service.name}`
            );
          } catch (error: any) {
            collectionErrors.push({
              service: service.name,
              error: `Failed to read service-specific compose file: ${error.message}`,
            });

            console.error(
              `[docker-compose-strategy] Failed to read ${serviceComposePath}: ${error.message}`
            );
          }
        } else {
          console.log(
            `[docker-compose-strategy] No service-specific compose file for ${service.name}`
          );
        }
      }

      console.log(
        `[docker-compose-strategy] Found ${serviceFiles.length} service-specific compose file(s) ` +
          `out of ${services.length} service(s)`
      );

      // Fail if any file read errors occurred
      if (collectionErrors.length > 0) {
        const errorSummary = collectionErrors.map((e) => `  - ${e.service}: ${e.error}`).join('\n');
        throw new Error(
          `Failed to read ${collectionErrors.length} service-specific compose file(s):\n` +
            `${errorSummary}\n\n` +
            `Fix the file permissions or paths and try again.`
        );
      }

      // ============================================================================
      // STAGE 3: Iteratively merge service-specific files
      // ============================================================================
      let mergedYaml = baseYaml;
      const merger = new ComposeMerger();
      const mergeErrors: Array<{ service: string; error: string }> = [];
      const mergeStats: Array<{ service: string; stats: any }> = [];

      for (const serviceFile of serviceFiles) {
        try {
          const mergeResult = merger.merge(mergedYaml, serviceFile.yaml, {
            serviceName: serviceFile.service,
            validationMode: 'lenient', // Don't fail if service missing in override
          });

          mergedYaml = mergeResult.yaml;
          mergeStats.push({
            service: serviceFile.service,
            stats: mergeResult.stats,
          });

          console.log(
            `[docker-compose-strategy] Merged ${serviceFile.service}: ` +
              `+${mergeResult.stats.volumesAdded} volumes, ` +
              `+${mergeResult.stats.environmentAdded} env vars, ` +
              `+${mergeResult.stats.dependenciesAdded} dependencies`
          );
        } catch (error: any) {
          mergeErrors.push({
            service: serviceFile.service,
            error: error.message || String(error),
          });

          console.error(
            `[docker-compose-strategy] Failed to merge ${serviceFile.service}: ${error.message}`
          );
        }
      }

      // Fail if any merges failed
      if (mergeErrors.length > 0) {
        const errorSummary = mergeErrors.map((e) => `  - ${e.service}: ${e.error}`).join('\n');
        throw new Error(
          `Failed to merge ${mergeErrors.length}/${serviceFiles.length} service-specific compose file(s):\n` +
            `${errorSummary}\n\n` +
            `Fix the invalid compose files and try again.`
        );
      }

      // Log total merge statistics
      if (mergeStats.length > 0) {
        const totalStats = mergeStats.reduce(
          (acc, { stats }) => ({
            volumesAdded: acc.volumesAdded + stats.volumesAdded,
            environmentAdded: acc.environmentAdded + stats.environmentAdded,
            dependenciesAdded: acc.dependenciesAdded + stats.dependenciesAdded,
          }),
          { volumesAdded: 0, environmentAdded: 0, dependenciesAdded: 0 }
        );

        console.log(
          `[docker-compose-strategy] Total merge stats: ` +
            `+${totalStats.volumesAdded} volumes, ` +
            `+${totalStats.environmentAdded} env vars, ` +
            `+${totalStats.dependenciesAdded} dependencies`
        );
      }

      // ============================================================================
      // STAGE 4: Collect and validate secureFiles for all services
      // ============================================================================
      const isRemote = context.deployment?.docker?.host?.startsWith('ssh://');
      const allSecureFiles = new Map<string, SecureFile[]>();
      const secureFilesErrors: Array<{ service: string; error: string }> = [];
      const validator = new SecureFilesValidator(repoRoot);

      for (const service of services) {
        if (service.secureFiles && service.secureFiles.length > 0) {
          try {
            // Filter secureFiles by current execution context
            // Only include files where:
            // 1. file.context is undefined (applies to all contexts), OR
            // 2. file.context matches current context name
            const contextFilteredFiles = service.secureFiles.filter((file: SecureFile) => {
              return !file.context || file.context === context.name;
            });

            // Skip if no files match the current context
            if (contextFilteredFiles.length === 0) {
              console.log(
                `[docker-compose-strategy] No secureFiles match context '${context.name}' for ${service.name}`
              );
              continue;
            }

            // Validate context-filtered secureFiles
            await validator.validate(contextFilteredFiles, context.name);

            allSecureFiles.set(service.name, contextFilteredFiles);

            console.log(
              `[docker-compose-strategy] Collected ${contextFilteredFiles.length} secureFile(s) ` +
                `for ${service.name} (context: ${context.name})`
            );
          } catch (error: any) {
            secureFilesErrors.push({
              service: service.name,
              error: error.message || String(error),
            });

            console.error(
              `[docker-compose-strategy] SecureFiles validation failed for ${service.name}: ` +
                `${error.message}`
            );
          }
        }
      }

      // Fail if any secureFiles validation failed
      if (secureFilesErrors.length > 0) {
        const errorSummary = secureFilesErrors
          .map((e) => `  - ${e.service}: ${e.error}`)
          .join('\n');
        throw new Error(
          `SecureFiles validation failed for ${secureFilesErrors.length} service(s):\n` +
            `${errorSummary}\n\n` +
            `Fix the secureFiles declarations and try again.`
        );
      }

      console.log(
        `[docker-compose-strategy] Collected secureFiles for ${allSecureFiles.size} service(s)`
      );

      // ============================================================================
      // STAGE 5: Process secureFiles for all services
      // ============================================================================
      for (const [serviceName, secureFiles] of allSecureFiles) {
        let volumeMounts: string[];
        const secureFileEnvVars = ComposeMerger.extractEnvVars(secureFiles);

        if (!isRemote) {
          // Local deployment: Generate volume mounts with local paths
          volumeMounts = ComposeMerger.generateVolumeMounts(secureFiles, repoRoot);

          console.log(
            `[docker-compose-strategy] Generated ${volumeMounts.length} local volume mount(s) ` +
              `for ${serviceName}`
          );
        } else {
          // Remote deployment: Transfer files via SCP
          const remoteHost = context.deployment!.docker!.host!;
          const remoteDir = context.deployment!.docker!.remoteDir;

          if (!remoteDir) {
            throw new Error(
              `Remote directory not configured in context '${context.name}'. ` +
                `Set deployment.docker.remoteDir in architecture.yaml`
            );
          }

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
            `[docker-compose-strategy] Transferred and mounted ${volumeMounts.length} remote file(s) ` +
              `for ${serviceName}`
          );
        }

        // Inject into merged YAML
        mergedYaml = merger.injectSecureFiles(
          mergedYaml,
          serviceName,
          volumeMounts,
          secureFileEnvVars
        );

        console.log(
          `[docker-compose-strategy] Injected ${volumeMounts.length} volume mount(s) and ` +
            `${Object.keys(secureFileEnvVars).length} env var(s) for ${serviceName}`
        );
      }

      // ============================================================================
      // STAGE 6: Inject image tags for buildable services
      // ============================================================================

      // Sprint 378: Services with build: sections need explicit image: tags
      // to prevent Docker from trying to pull them from a registry.
      // We inject image tags following Docker Compose naming convention:
      // ${COMPOSE_PROJECT_NAME}-${service_name}:${BITBRAT_VERSION:-latest}
      const finalCompose = yaml.load(mergedYaml) as any;
      const composeProjectName = `bitbrat-${context.name}`;

      let imageTagsInjected = 0;
      if (finalCompose?.services && typeof finalCompose.services === 'object') {
        for (const [serviceName, serviceConfig] of Object.entries(finalCompose.services)) {
          const service = serviceConfig as any;
          // If service has build section but no image tag, inject one
          if (service && typeof service === 'object' && service.build && !service.image) {
            service.image = `${composeProjectName}-${serviceName}:\${BITBRAT_VERSION:-latest}`;
            imageTagsInjected++;
            console.log(
              `[docker-compose-strategy] Injected image tag for ${serviceName}: ${service.image}`
            );
          }
        }
      }

      if (imageTagsInjected > 0) {
        mergedYaml = yaml.dump(finalCompose, {
          indent: 2,
          lineWidth: 120,
          noRefs: true,
        });
        console.log(
          `[docker-compose-strategy] Injected ${imageTagsInjected} image tag(s) for buildable services`
        );
      }

      // ============================================================================
      // STAGE 7: Write temporary merged compose file
      // ============================================================================
      await fs.promises.writeFile(tempMergedPath, mergedYaml, 'utf-8');

      const fileSizeKb = (mergedYaml.length / 1024).toFixed(2);
      console.log(
        `[docker-compose-strategy] Wrote temporary merged compose file: ${tempMergedPath} ` +
          `(${fileSizeKb} KB)`
      );

      // For remote deployments, transfer the merged compose file to the remote machine
      // The orchestrator's syncRemoteFiles() doesn't include .docker-compose.merged.yaml
      // in its file list, so we must transfer it manually before calling orchestrator.up()
      if (isRemote) {
        const remoteDir = context.deployment!.docker!.remoteDir || '/opt/BitBratPlatform';
        const sshHost = context.deployment!.docker!.host!.replace('ssh://', '');
        const remotePath = `${remoteDir}/.docker-compose.merged.yaml`;

        console.log(
          `[docker-compose-strategy] Transferring merged compose file to ${sshHost}:${remotePath}...`
        );

        // Transfer file using SCP
        const scpResult = await execCmd('scp', [tempMergedPath, `${sshHost}:${remotePath}`], {
          cwd: repoRoot,
        });

        if (scpResult.code !== 0) {
          throw new Error(
            `Failed to transfer merged compose file to remote: ${scpResult.stderr || scpResult.stdout}`
          );
        }

        console.log(`[docker-compose-strategy] ✓ Merged compose file transferred successfully`);
      }

      // ============================================================================
      // STAGE 8: Extract buildable services from merged compose file
      // ============================================================================

      // Sprint 378: For bulk deployments, we need to tell the orchestrator which services
      // to build and start. We extract this from the LOCAL merged file BEFORE passing
      // the path to the orchestrator (which might be a remote path).
      const mergedCompose = yaml.load(mergedYaml) as any;
      const buildableServices: string[] = [];

      // Sprint 3 Fix #11: Infrastructure services to always include (use image, not build)
      const infrastructureServices = ['nats', 'nats-box', 'postgres', 'redis', 'firebase-emulator'];

      if (mergedCompose?.services && typeof mergedCompose.services === 'object') {
        for (const [serviceName, serviceConfig] of Object.entries(mergedCompose.services)) {
          const service = serviceConfig as any;
          // Include services that have a build section OR are infrastructure services
          if (service && typeof service === 'object') {
            if (service.build != null || infrastructureServices.includes(serviceName)) {
              buildableServices.push(serviceName);
            }
          }
        }
      }

      console.log(
        `[docker-compose-strategy] Extracted ${buildableServices.length} buildable service(s): ` +
          buildableServices.join(', ')
      );

      // ============================================================================
      // STAGE 9: Execute orchestrator with merged compose file
      // ============================================================================

      // For remote deployments, use the remote path (file has been transferred above)
      // For local deployments, use the local path
      let composeFilePath = tempMergedPath;
      if (isRemote) {
        const remoteDir = context.deployment!.docker!.remoteDir || '/opt/BitBratPlatform';
        composeFilePath = `${remoteDir}/.docker-compose.merged.yaml`;
      }

      // Sprint 379: Extract service names for PortManager integration
      const serviceNames = services.map((s) => s.name);

      console.log(
        `[docker-compose-strategy] Services for port resolution: ${serviceNames.join(', ')}`
      );

      const orchestratorOptions: DockerOrchestratorOptions = {
        repoRoot,
        context: context.name,
        service: undefined, // Deploy all services
        composeFile: composeFilePath, // Use merged compose file (local or remote path)
        servicesToStart: buildableServices, // Sprint 378: Explicit list of services to build/start
        allServiceNames: serviceNames, // Sprint 379: Enable PortManager for bulk deployments
        dryRun: options.dryRun || false,
        forceRecreate: options.forceRecreate || false,
        noCache: options.forceBuild || false,
        rebuildBase: options.rebuildBase || false,
        loki: options.loki || false,
        noDeps: options.noDeps || false,
      };

      console.log(
        `[docker-compose-strategy] Orchestrator options: composeFile=${composeFilePath}, allServiceNames=${serviceNames.length} services`
      );

      const orchestrator = new DockerOrchestrator(orchestratorOptions);
      await orchestrator.up();

      const durationMs = Date.now() - startTime;

      console.log(`[docker-compose-strategy] Bulk deployment completed successfully`);

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

      console.error(`[docker-compose-strategy] Bulk deployment failed: ${error.message}`);

      // Return failure for all services
      return services.map((service) => ({
        status: 'failed' as const,
        service: service.name,
        durationMs,
        error: error.message || String(error),
      }));
    } finally {
      // ============================================================================
      // STAGE 8: Cleanup temporary merged file
      // ============================================================================
      try {
        if (fs.existsSync(tempMergedPath)) {
          await fs.promises.unlink(tempMergedPath);
          console.log(`[docker-compose-strategy] Cleaned up temporary merged compose file`);
        }
      } catch (cleanupError: any) {
        console.warn(
          `[docker-compose-strategy] Failed to cleanup temporary file: ${cleanupError.message}`
        );
      }
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
