/**
 * Cloud Run Deployment Strategy
 *
 * Deploys services to GCP Cloud Run using Cloud Build.
 * Supports both build-and-deploy and deploy-only (external images).
 *
 * @module orchestration/deployment/cloud-run-strategy
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
import { submitBuild } from '../../providers/gcp/cloudbuild';
import { assertVpcPreconditions } from '../../providers/gcp/preflight';
import { deriveTag } from '../../util/git';
import { loadEnvKv, synthesizeSecretMapping } from '../../config/loader';
import { resolveSecretMappingToNumeric } from '../../providers/gcp/secrets';
import { SecureFilesValidator } from '../../validation/secure-files-validator';
import { execCmd } from '../exec';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cloud Run deployment strategy.
 * Deploys services to GCP Cloud Run via Cloud Build.
 */
export class CloudRunStrategy implements DeploymentStrategy {
  readonly name = 'cloud-run';

  /**
   * Prepare deployment plan for Cloud Run.
   *
   * Loads environment variables, resolves secrets from Secret Manager,
   * determines dockerfile path, computes Cloud Build substitutions.
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
    // Extract GCP configuration from context
    const gcpConfig = context.deployment.gcp;
    if (!gcpConfig) {
      throw new Error(
        `GCP configuration missing in context '${context.name}'. ` +
          `Check deployment.gcp in architecture.yaml executionContexts.${context.name}`
      );
    }

    const repoRoot = process.cwd();
    const projectId = gcpConfig.project;
    const region = service.region || gcpConfig.region || 'us-central1';
    const envName = context.name;

    // Determine if using external image (deploy-only) or build-and-deploy
    const isExternalImage = !!service.image;

    // Determine dockerfile path
    let dockerfilePath = '';
    if (!isExternalImage) {
      dockerfilePath = this.getDockerfilePath(service, repoRoot);
    }

    // Determine image tag
    const imageTag = (options as any).imageTag || deriveTag();

    // Load environment variables
    // loadEnvKv returns string format: "KEY1=val1;KEY2=val2"
    const envKvString = loadEnvKv(envName, service.name);
    const envVars = Object.assign({}, context.runtime.envVars || {});

    // Parse envKvString into object
    if (envKvString) {
      const pairs = envKvString.split(';').filter(Boolean);
      for (const pair of pairs) {
        const [key, ...valueParts] = pair.split('=');
        if (key) {
          envVars[key.trim()] = valueParts.join('='); // Rejoin in case value contains '='
        }
      }
    }

    // Load and resolve secrets
    // synthesizeSecretMapping returns string format: "KEY1=KEY1:latest;KEY2=KEY2:latest"
    let secretMap = '';
    const resolvedSecrets: Record<string, string> = {};

    if (service.secrets && service.secrets.length > 0) {
      secretMap = synthesizeSecretMapping(service.secrets);

      if (!options.dryRun) {
        try {
          const resolved = await resolveSecretMappingToNumeric(secretMap, projectId);
          if (resolved) {
            secretMap = resolved;
            // Parse resolved secrets string into object for filtering
            const secretPairs = resolved.split(';').filter(Boolean);
            for (const pair of secretPairs) {
              const [key, ...valueParts] = pair.split('=');
              if (key) {
                resolvedSecrets[key.trim()] = valueParts.join('=');
              }
            }
          }
        } catch (error: any) {
          if (options.dryRun) {
            // In dry-run, warn but continue
            console.warn(`[cloud-run-strategy] Dry-run: Could not resolve secrets: ${error.message}`);
          } else {
            throw error;
          }
        }
      }
    }

    // Filter env vars that are also secrets (secrets take precedence)
    const filteredEnvVars = { ...envVars };
    Object.keys(resolvedSecrets).forEach((key) => {
      delete filteredEnvVars[key];
    });

    // Sprint 374: Validate and process secureFiles
    const secureFiles = service.secureFiles || [];
    let processedSecureFiles: SecureFile[] = [];
    const secretFileRefs: Array<{ secretName: string; targetPath: string; envVar?: string }> = [];

    if (secureFiles.length > 0) {
      // Validate secure files
      const validator = new SecureFilesValidator(process.cwd());
      const validationResult = await validator.validate(secureFiles, context.name);

      // Log warnings (non-fatal)
      if (validationResult.warnings.length > 0) {
        console.warn(
          `[cloud-run-strategy] Secure file warnings for ${service.name}:\n` +
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
        `[cloud-run-strategy] ${processedSecureFiles.length} secure file(s) applicable for context '${context.name}'`
      );

      // Upload files to Secret Manager (unless dry-run)
      if (!options.dryRun && processedSecureFiles.length > 0) {
        for (const file of processedSecureFiles) {
          const secretName = this.deriveSecretName(envName, file.local);

          console.log(`[cloud-run-strategy] Uploading ${file.local} to Secret Manager as ${secretName}`);

          try {
            // Ensure secret exists
            await this.ensureSecret(secretName, projectId);

            // Upload file content as new version
            await this.addSecretVersion(secretName, projectId, file.local);

            // Track secret reference for deployment
            secretFileRefs.push({
              secretName,
              targetPath: file.target,
              envVar: file.env,
            });
          } catch (error: any) {
            throw new Error(
              `Failed to upload secure file ${file.local} to Secret Manager: ${error.message}`
            );
          }
        }
      } else if (processedSecureFiles.length > 0) {
        // Dry-run: just generate secret references without uploading
        for (const file of processedSecureFiles) {
          const secretName = this.deriveSecretName(envName, file.local);
          secretFileRefs.push({
            secretName,
            targetPath: file.target,
            envVar: file.env,
          });
        }
        console.log(
          `[cloud-run-strategy] Dry-run: Would upload ${processedSecureFiles.length} secure file(s) to Secret Manager`
        );
      }
    }

    // Compute VPC connector name (follows brat naming convention)
    const vpcConnectorName = `brat-conn-${region}-${envName}`;

    // Build Cloud Build substitutions manually
    // (Can't use computeDeploySubstitutions - it expects legacy ResolvedServiceConfig)
    const substitutions: Record<string, string> = {
      _SERVICE_NAME: service.name,
      _REGION: region,
      _TAG: imageTag,
      _REPO: (options as any).repo || 'bitbrat-services',
      _PORT: String(service.port || 3000),
      _MIN_INSTANCES: String(service.scaling?.min ?? 0),
      _MAX_INSTANCES: String(service.scaling?.max ?? 1),
      _CPU: service.cpu || '1',
      _MEMORY: service.memory || '512Mi',
      _VPC_CONNECTOR: vpcConnectorName,
      _ALLOW_UNAUTH: String(service.security?.allowUnauthenticated ?? true),
      _INGRESS: 'all', // Default ingress policy
      _BILLING: 'instance',
      _DRY_RUN: String(false),
    };

    // Add dockerfile if building (not external image)
    if (dockerfilePath) {
      substitutions._DOCKERFILE = dockerfilePath;
    }

    // Add external image if provided
    if (service.image) {
      substitutions._IMAGE = service.image;
    }

    // Add env vars as Cloud Build substitution
    // Format: KEY1=value1;KEY2=value2
    if (Object.keys(filteredEnvVars).length > 0) {
      const envPairs = Object.entries(filteredEnvVars).map(([k, v]) => `${k}=${v}`);
      substitutions._ENV_VARS_ARG = envPairs.join(';');
    } else {
      substitutions._ENV_VARS_ARG = '';
    }

    // Add secrets as Cloud Build substitution
    // secretMap is already in the correct string format: "KEY1=projects/.../versions/1;KEY2=..."
    substitutions._SECRET_SET_ARG = secretMap || '';

    // Sprint 374: Add secure file mount flags
    // Format: /var/secrets/file.json=bitbrat-staging-file:latest;/run/secrets/cert.pem=bitbrat-staging-cert:latest
    if (secretFileRefs.length > 0) {
      const secretMountPairs = secretFileRefs.map((ref) => {
        return `${ref.targetPath}=${ref.secretName}:latest`;
      });
      substitutions._SECRET_FILE_MOUNTS = secretMountPairs.join(';');

      // Add env vars for secure files (if specified)
      const secureFileEnvPairs: string[] = [];
      for (const ref of secretFileRefs) {
        if (ref.envVar) {
          secureFileEnvPairs.push(`${ref.envVar}=${ref.targetPath}`);
        }
      }
      if (secureFileEnvPairs.length > 0) {
        // Append to existing env vars
        if (substitutions._ENV_VARS_ARG) {
          substitutions._ENV_VARS_ARG += ';' + secureFileEnvPairs.join(';');
        } else {
          substitutions._ENV_VARS_ARG = secureFileEnvPairs.join(';');
        }
      }
    } else {
      substitutions._SECRET_FILE_MOUNTS = '';
    }

    // Prepare metadata
    const metadata: DeploymentPlan['metadata'] = {
      dockerfilePath,
      imageTag,
      substitutions,
      projectId,
      region,
      vpcConnector: vpcConnectorName,
      cloudBuildConfig: isExternalImage ? 'cloudbuild.deploy-only.yaml' : 'cloudbuild.oauth-flow.yaml',
      deployOptions: options,
      secretFileRefs, // Sprint 374: Secret Manager references for secure files
    };

    return {
      service,
      context,
      envVars: filteredEnvVars,
      secrets: resolvedSecrets,
      metadata,
    };
  }

  /**
   * Validate deployment plan.
   *
   * Checks:
   * - Dockerfile exists (if not external image)
   * - VPC connector configured
   * - Required environment variables present
   *
   * @param plan - Deployment plan
   * @returns Validation result
   */
  async validate(plan: DeploymentPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const deployOptions = (plan.metadata.deployOptions || {}) as DeployOptions;
    const dockerfilePath = plan.metadata.dockerfilePath as string;
    const projectId = plan.metadata.projectId as string;
    const region = plan.metadata.region as string;
    const vpcConnector = plan.metadata.vpcConnector as string | undefined;

    // Check Dockerfile exists (if not external image)
    if (dockerfilePath && !fs.existsSync(dockerfilePath)) {
      errors.push(`Dockerfile not found: ${dockerfilePath}`);
    }

    // VPC preflight check (unless dry-run or allow-no-vpc)
    if (!deployOptions.dryRun) {
      try {
        await assertVpcPreconditions({
          projectId,
          region,
          env: plan.context.name,
          allowNoVpc: (deployOptions as any).allowNoVpc,
          dryRun: deployOptions.dryRun,
        });
      } catch (error: any) {
        if ((deployOptions as any).allowNoVpc) {
          warnings.push(`VPC check skipped: ${error.message}`);
        } else {
          errors.push(`VPC preflight failed: ${error.message}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute deployment using Cloud Build.
   *
   * Submits build to GCP Cloud Build which:
   * - Builds docker image (if not external)
   * - Pushes to Artifact Registry
   * - Deploys to Cloud Run
   *
   * @param plan - Validated deployment plan
   * @returns Deployment result
   */
  async execute(plan: DeploymentPlan): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      const deployOptions = (plan.metadata.deployOptions || {}) as DeployOptions;
      const projectId = plan.metadata.projectId as string;
      const region = plan.metadata.region as string;
      const cloudBuildConfig = plan.metadata.cloudBuildConfig as string;
      const substitutions = plan.metadata.substitutions as Record<string, string>;

      // Dry-run: just validate and return
      if (deployOptions.dryRun) {
        const durationMs = Date.now() - startTime;
        return {
          status: 'success',
          service: plan.service.name,
          durationMs,
          metadata: {
            buildId: 'dry-run',
          },
        };
      }

      // Submit build to Cloud Build
      const repoRoot = process.cwd();
      const buildConfigPath = path.join(repoRoot, cloudBuildConfig);

      const buildResult = await submitBuild({
        projectId,
        configPath: buildConfigPath,
        substitutions,
        cwd: repoRoot,
      });

      // Check if build submission succeeded
      if (buildResult.code !== 0) {
        throw new Error(`Cloud Build submission failed: ${buildResult.stderr || buildResult.stdout}`);
      }

      // Deployment succeeded
      const durationMs = Date.now() - startTime;

      // Construct Cloud Run URL
      const serviceName = plan.service.name;
      const url = `https://${serviceName}-${projectId.split('-')[0]}-${region}.run.app`;

      // Extract build ID from stdout if available
      const buildIdMatch = buildResult.stdout.match(/Build ID: (\S+)/);
      const buildId = buildIdMatch ? buildIdMatch[1] : 'unknown';

      return {
        status: 'success',
        service: plan.service.name,
        durationMs,
        url,
        metadata: {
          buildId,
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
   * Checks for service-specific Dockerfile with fallback to kebab-case variant.
   *
   * @param service - Service
   * @param repoRoot - Repository root
   * @returns Dockerfile path
   */
  private getDockerfilePath(service: ServiceWithName, repoRoot: string): string {
    const dockerfile = `Dockerfile.${service.name}`;
    const dockerfilePath = path.join(repoRoot, dockerfile);

    if (fs.existsSync(dockerfilePath)) {
      return dockerfilePath;
    }

    // Try kebab-case variant
    const kebab = service.name.replace(/\s+/g, '-');
    const altDockerfile = `Dockerfile.${kebab}`;
    const altPath = path.join(repoRoot, altDockerfile);

    if (fs.existsSync(altPath)) {
      return altPath;
    }

    // Return expected path (will fail validation)
    return dockerfilePath;
  }

  /**
   * Sprint 374: Derive secret name from execution context and file path.
   *
   * Secret naming convention:
   * bitbrat-<context>-<filename-without-extension>
   *
   * Examples:
   * - .secure.local/gcp-credentials.json → bitbrat-local-gcp-credentials
   * - .secure.staging/db-cert.pem → bitbrat-staging-db-cert
   *
   * @param context - Execution context (e.g., "local", "staging", "prod")
   * @param filePath - Local file path
   * @returns Secret name for GCP Secret Manager
   */
  private deriveSecretName(context: string, filePath: string): string {
    const basename = path.basename(filePath);
    const nameWithoutExt = basename.replace(/\.[^.]+$/, ''); // Remove extension
    const sanitized = nameWithoutExt.replace(/[^a-zA-Z0-9-]/g, '-'); // Replace invalid chars
    return `bitbrat-${context}-${sanitized}`;
  }

  /**
   * Sprint 374: Ensure secret exists in GCP Secret Manager.
   *
   * Creates secret if it doesn't exist. Idempotent (safe to call multiple times).
   *
   * @param secretName - Secret name (e.g., "bitbrat-staging-gcp-credentials")
   * @param projectId - GCP project ID
   * @throws Error if gcloud command fails
   */
  private async ensureSecret(secretName: string, projectId: string): Promise<void> {
    // Check if secret exists
    const describeResult = await execCmd('gcloud', [
      'secrets',
      'describe',
      secretName,
      '--project',
      projectId,
    ]);

    if (describeResult.code === 0) {
      // Secret already exists
      console.log(`[cloud-run-strategy] Secret ${secretName} already exists`);
      return;
    }

    // Create secret with automatic replication
    console.log(`[cloud-run-strategy] Creating secret ${secretName}`);
    const createResult = await execCmd('gcloud', [
      'secrets',
      'create',
      secretName,
      '--project',
      projectId,
      '--replication-policy',
      'automatic',
    ]);

    if (createResult.code !== 0) {
      throw new Error(
        `Failed to create secret ${secretName}: ${createResult.stderr || createResult.stdout}`
      );
    }

    console.log(`[cloud-run-strategy] Secret ${secretName} created successfully`);
  }

  /**
   * Sprint 374: Upload file content as new secret version.
   *
   * Reads file content and uploads to GCP Secret Manager.
   * Supports both text and binary files.
   *
   * @param secretName - Secret name
   * @param projectId - GCP project ID
   * @param filePath - Path to file to upload
   * @throws Error if file doesn't exist or gcloud command fails
   */
  private async addSecretVersion(secretName: string, projectId: string, filePath: string): Promise<void> {
    const repoRoot = process.cwd();
    const absolutePath = path.join(repoRoot, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Secure file not found: ${filePath} (resolved to ${absolutePath})`);
    }

    console.log(`[cloud-run-strategy] Adding version to secret ${secretName} from ${filePath}`);

    // Upload file content using --data-file
    const addVersionResult = await execCmd('gcloud', [
      'secrets',
      'versions',
      'add',
      secretName,
      '--project',
      projectId,
      '--data-file',
      absolutePath,
    ]);

    if (addVersionResult.code !== 0) {
      throw new Error(
        `Failed to add version to secret ${secretName}: ${addVersionResult.stderr || addVersionResult.stdout}`
      );
    }

    console.log(`[cloud-run-strategy] Version added to secret ${secretName} successfully`);
  }
}
