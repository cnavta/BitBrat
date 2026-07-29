/**
 * Deployment Strategy Framework
 *
 * Strategy pattern implementation for unified bit deployment.
 * Automatically selects deployment mechanism based on BitBrat Execution Context (BEC).
 *
 * @module orchestration/deployment/strategy
 * @since Sprint 372
 */

import type { Service } from '../../config/schema';
import type { ResolvedContext } from '../../context/types';

/**
 * Service with name for deployment.
 */
export interface ServiceWithName extends Service {
  /** Service name (key from architecture.yaml services map) */
  name: string;
}

/**
 * Deployment options passed to strategies.
 */
export interface DeployOptions {
  /** Dry-run mode: validate and plan but don't execute */
  dryRun?: boolean;

  /** Force recreate containers (docker-compose) or force redeploy (cloud-run) */
  forceRecreate?: boolean;

  /** Build images even if they exist */
  forceBuild?: boolean;

  /** Maximum concurrent deployments (for --all) */
  concurrency?: number;

  /** Verbose output */
  verbose?: boolean;

  /** Additional deployment-specific options */
  [key: string]: unknown;
}

/**
 * Deployment plan created during prepare phase.
 * Contains all information needed to execute deployment.
 */
export interface DeploymentPlan {
  /** Service being deployed (with name) */
  service: ServiceWithName;

  /** Resolved execution context */
  context: ResolvedContext;

  /** Environment variables (normalized to key-value object) */
  envVars: Record<string, string>;

  /** Secrets (may be references or resolved values depending on strategy) */
  secrets: Record<string, string>;

  /** Deployment-specific metadata */
  metadata: {
    /** Dockerfile path */
    dockerfilePath?: string;

    /** Docker Compose file path */
    composeFilePath?: string;

    /** Image tag */
    imageTag?: string;

    /** Cloud Build substitutions */
    substitutions?: Record<string, string>;

    /** VPC connector (cloud-run) */
    vpcConnector?: string;

    /** Remote docker host (docker-compose with SSH) */
    remoteHost?: string;

    /** Additional strategy-specific metadata */
    [key: string]: unknown;
  };
}

/**
 * Validation result from validate phase.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors (block deployment) */
  errors: string[];

  /** Validation warnings (allow deployment but notify user) */
  warnings: string[];
}

/**
 * Result of deployment execution.
 */
export interface DeploymentResult {
  /** Deployment status */
  status: 'success' | 'failed' | 'skipped';

  /** Service name */
  service: string;

  /** Deployment duration in milliseconds */
  durationMs: number;

  /** Error message if failed */
  error?: string;

  /** Deployment URL (if applicable) */
  url?: string;

  /** Additional result metadata */
  metadata?: {
    /** Container ID (docker-compose) */
    containerId?: string;

    /** Cloud Build ID (cloud-run) */
    buildId?: string;

    /** Image digest */
    imageDigest?: string;

    /** Additional strategy-specific metadata */
    [key: string]: unknown;
  };
}

/**
 * Base deployment strategy interface.
 * All deployment strategies must implement this interface.
 */
export interface DeploymentStrategy {
  /** Strategy name (e.g., "docker-compose", "cloud-run") */
  readonly name: string;

  /**
   * Prepare deployment plan.
   * Loads configuration, resolves secrets, computes metadata.
   *
   * @param service - Service to deploy (with name)
   * @param context - Resolved execution context
   * @param options - Deployment options
   * @returns Deployment plan
   * @throws Error if preparation fails
   */
  prepare(
    service: ServiceWithName,
    context: ResolvedContext,
    options: DeployOptions
  ): Promise<DeploymentPlan>;

  /**
   * Validate deployment plan.
   * Checks prerequisites, validates configuration, runs preflight checks.
   *
   * @param plan - Deployment plan from prepare()
   * @returns Validation result
   */
  validate(plan: DeploymentPlan): Promise<ValidationResult>;

  /**
   * Execute deployment.
   * Performs actual deployment based on plan.
   *
   * @param plan - Validated deployment plan
   * @returns Deployment result
   * @throws Error if deployment fails
   */
  execute(plan: DeploymentPlan): Promise<DeploymentResult>;
}

/**
 * Strategy factory for creating deployment strategies.
 * Selects strategy based on execution context deployment type.
 */
export class StrategyFactory {
  /**
   * Create deployment strategy based on deployment type.
   *
   * @param deploymentType - Type from execution context (e.g., "docker-compose", "cloud-run")
   * @returns Deployment strategy instance
   * @throws Error if deployment type is unknown
   *
   * @example
   * ```typescript
   * const strategy = StrategyFactory.create('docker-compose');
   * const plan = await strategy.prepare(service, context, options);
   * const validation = await strategy.validate(plan);
   * if (validation.valid) {
   *   const result = await strategy.execute(plan);
   * }
   * ```
   */
  static create(deploymentType: string): DeploymentStrategy {
    switch (deploymentType) {
      case 'docker-compose': {
        // Lazy import to avoid circular dependencies
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { DockerComposeStrategy } = require('./docker-compose-strategy');
        return new DockerComposeStrategy();
      }

      case 'cloud-run': {
        // Lazy import to avoid circular dependencies
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { CloudRunStrategy } = require('./cloud-run-strategy');
        return new CloudRunStrategy();
      }

      case 'k8s':
      case 'kubernetes':
        throw new Error(
          `Deployment strategy for '${deploymentType}' not yet implemented. ` +
            `Kubernetes support is planned for a future sprint.`
        );

      default:
        throw new Error(
          `Unknown deployment type: '${deploymentType}'. ` +
            `Supported types: docker-compose, cloud-run. ` +
            `Check your execution context configuration in architecture.yaml.`
        );
    }
  }
}
