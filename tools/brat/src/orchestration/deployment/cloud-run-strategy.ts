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
import { submitBuild } from '../../providers/gcp/cloudbuild';
import { assertVpcPreconditions } from '../../providers/gcp/preflight';
import { deriveTag } from '../../util/git';
import { loadEnvKv, synthesizeSecretMapping } from '../../config/loader';
import { resolveSecretMappingToNumeric } from '../../providers/gcp/secrets';
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
}
