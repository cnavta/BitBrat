/**
 * types.ts
 *
 * Type definitions for brat CLI configuration and service definitions.
 *
 * Sprint 374: Secure File Deployment
 * Sprint 15: Deployment Lifecycle Hooks
 */

/**
 * SecureFile defines a secure file to be deployed with a service.
 *
 * Secure files are intended for credentials, certificates, and other sensitive
 * artifacts that must be made available to a service regardless of deployment
 * method (Docker Compose local/remote, Cloud Run, etc.).
 *
 * Security constraints:
 * - Source files MUST be git-ignored (validated before deployment)
 * - Target paths MUST be under /var/secrets or /run/secrets
 * - Permissions default to 0400 (read-only for owner)
 * - Files are deployed via platform-specific secure mechanisms:
 *   - Docker Compose (local): Direct volume mount
 *   - Docker Compose (remote): scp transfer + chmod + volume mount
 *   - Cloud Run: GCP Secret Manager upload + file mount
 *
 * @example
 * ```yaml
 * services:
 *   image-gen-mcp:
 *     secureFiles:
 *       - local: .secure.local/gcp-credentials.json
 *         target: /var/secrets/gcp-credentials.json
 *         env: GOOGLE_APPLICATION_CREDENTIALS
 *         permissions: "0400"
 *         required: true
 * ```
 */
export interface SecureFile {
  /**
   * Source path relative to repository root.
   *
   * MUST be git-ignored (validator checks .gitignore patterns).
   * Typical patterns:
   * - `.secure.local/` - Local development credentials
   * - `.secure.staging/` - Staging credentials
   * - `.secure.prod/` - Production credentials (NOT RECOMMENDED - use cloud secrets)
   *
   * @example ".secure.local/gcp-credentials.json"
   */
  local: string;

  /**
   * Destination path inside container.
   *
   * MUST be under `/var/secrets/` or `/run/secrets/` for security.
   * Validator rejects paths outside these prefixes or containing `..` traversal.
   *
   * @example "/var/secrets/gcp-credentials.json"
   */
  target: string;

  /**
   * Optional environment variable to set to target path.
   *
   * If specified, the deployment strategy will inject this environment variable
   * with the value of `target`, making it easy for services to locate the file.
   *
   * @example "GOOGLE_APPLICATION_CREDENTIALS"
   */
  env?: string;

  /**
   * File permissions (octal string).
   *
   * Defaults to "0400" (read-only for owner).
   * Common values:
   * - "0400" - Read-only for owner (most secure, default)
   * - "0440" - Read-only for owner and group
   * - "0600" - Read-write for owner only
   *
   * Validator ensures permissions are octal strings matching /^0[0-7]{3}$/.
   *
   * @default "0400"
   */
  permissions?: string;

  /**
   * Fail deployment if file is missing.
   *
   * If true (default), deployment fails if `local` path does not exist.
   * If false, deployment proceeds with a warning (file is optional).
   *
   * @default true
   */
  required?: boolean;

  /**
   * Only deploy in specific execution context (optional).
   *
   * If set, the file is only deployed when `brat deploy --context <value>` matches.
   * Useful for environment-specific credentials:
   *
   * @example
   * ```yaml
   * secureFiles:
   *   - local: .secure.local/dev-creds.json
   *     target: /var/secrets/creds.json
   *     context: local
   *   - local: .secure.staging/staging-creds.json
   *     target: /var/secrets/creds.json
   *     context: staging
   * ```
   */
  context?: string;
}

/**
 * Deployment lifecycle hooks.
 *
 * Hooks are shell scripts that execute at specific deployment stages to enable:
 * - Private container registry authentication
 * - Pre-flight validation and checks
 * - Post-deployment verification
 * - Custom deployment logic
 *
 * Sprint 15: Deployment Lifecycle Hooks System
 *
 * @example
 * ```yaml
 * executionContexts:
 *   staging:
 *     deployment:
 *       hooks:
 *         pre-deploy: .brat/hooks/staging/pre-deploy-gcp-auth.sh
 *         post-deploy: .brat/hooks/staging/post-deploy-health-check.sh
 * ```
 */
export interface DeploymentHooks {
  /**
   * Hook executed BEFORE deployment operations begin.
   *
   * Execution context:
   * - Local deployments: Runs on local machine before build
   * - Remote deployments: Runs on local machine before file sync
   *
   * Use cases:
   * - Authenticate to container registries (local Docker daemon)
   * - Validate environment variables
   * - Pre-flight checks
   *
   * @example ".brat/hooks/staging/pre-deploy-gcp-auth.sh"
   */
  'pre-deploy'?: string;

  /**
   * Hook executed AFTER file sync (remote) or BEFORE build (local).
   *
   * Execution context:
   * - Local deployments: Runs on local machine before build
   * - Remote deployments: Runs on remote host after file sync
   *
   * Use cases:
   * - Authenticate to container registries (remote Docker daemon)
   * - Build-time dependency checks
   * - Generate build artifacts
   *
   * @example ".brat/hooks/staging/pre-build-docker-login.sh"
   */
  'pre-build'?: string;

  /**
   * Hook executed AFTER build completes, BEFORE containers start.
   *
   * Execution context:
   * - Local deployments: Runs on local machine after build
   * - Remote deployments: Runs on remote host after build
   *
   * Use cases:
   * - Image scanning for vulnerabilities
   * - Image tagging
   * - Build artifact validation
   *
   * NOTE: Current implementation runs after `docker compose up` completes
   * (containers already started). See hook-injection-points.md for details.
   *
   * @example ".brat/hooks/staging/post-build-scan.sh"
   */
  'post-build'?: string;

  /**
   * Hook executed AFTER containers start.
   *
   * Execution context:
   * - Local deployments: Runs on local machine after containers start
   * - Remote deployments: Runs on remote host after containers start
   *
   * Use cases:
   * - Health checks and smoke tests
   * - Deployment notifications (Slack, email, etc.)
   * - Service registration (Consul, etcd, etc.)
   *
   * NOTE: Hook failures do NOT abort deployment (containers already running).
   * Failed post-deploy hooks log errors but return success.
   *
   * @example ".brat/hooks/staging/post-deploy-health-check.sh"
   */
  'post-deploy'?: string;
}

/**
 * Docker deployment configuration.
 *
 * Used for local development, remote staging, and self-hosted production
 * environments using Docker Compose.
 *
 * Sprint 15: Added additionalSyncPaths for custom file sync control.
 */
export interface DockerDeploymentConfig {
  /**
   * Docker host (unix:///var/run/docker.sock or ssh://user@host[:port])
   */
  host: string;

  /**
   * Remote directory for docker-compose files (SSH deployments only).
   *
   * @example "/opt/bitbrat-staging"
   */
  remoteDir?: string;

  /**
   * Maximum concurrent Docker operations (default: 3).
   *
   * For SSH deployments, defaults to 1 to avoid "only one connection allowed" errors.
   */
  maxConcurrent?: number;

  /**
   * Additional files/directories to sync to remote host.
   *
   * Paths are relative to repository root and appended to the default sync whitelist.
   * Useful for syncing hook scripts, custom configurations, or BEC-specific files.
   *
   * Automatic additions:
   * - `.brat/hooks/` is auto-added when deployment.hooks is configured
   *
   * Validation:
   * - Paths must be relative (not absolute)
   * - Paths outside repo root are rejected
   * - Non-existent paths logged as warnings (don't fail deployment)
   *
   * Sprint 15: Deployment Lifecycle Hooks System
   *
   * @example
   * ```yaml
   * additionalSyncPaths:
   *   - .brat/hooks
   *   - custom-scripts
   *   - vendor/special-lib
   * ```
   */
  additionalSyncPaths?: string[];
}

/**
 * Google Cloud Platform deployment configuration.
 *
 * Used for Cloud Run deployments.
 */
export interface GcpDeploymentConfig {
  /**
   * GCP project ID.
   *
   * @example "bitbrat-prod"
   */
  project: string;

  /**
   * GCP region (e.g., us-central1).
   *
   * @example "us-central1"
   */
  region: string;
}

/**
 * Kubernetes deployment configuration.
 *
 * Used for K8s deployments (future).
 */
export interface K8sDeploymentConfig {
  /**
   * Kubernetes cluster name or context.
   */
  cluster: string;

  /**
   * Kubernetes namespace.
   */
  namespace: string;
}

/**
 * Deployment configuration.
 *
 * Defines how services are deployed (platform, target, hooks).
 *
 * Sprint 15: Added hooks field for deployment lifecycle hooks.
 */
export interface DeploymentConfig {
  /**
   * Deployment platform type.
   */
  type: 'docker-compose' | 'cloud-run' | 'k8s';

  /**
   * Docker Compose configuration (if type = 'docker-compose').
   */
  docker?: DockerDeploymentConfig;

  /**
   * GCP configuration (if type = 'cloud-run').
   */
  gcp?: GcpDeploymentConfig;

  /**
   * Kubernetes configuration (if type = 'k8s').
   */
  k8s?: K8sDeploymentConfig;

  /**
   * Deployment lifecycle hooks.
   *
   * Hooks are shell scripts that execute at specific deployment stages.
   * All hooks are optional.
   *
   * Sprint 15: Deployment Lifecycle Hooks System
   *
   * @see DeploymentHooks
   */
  hooks?: DeploymentHooks;
}

/**
 * ServiceWithName is a service definition augmented with its name.
 *
 * Used internally by deployment strategies to access service name
 * without requiring separate name parameter.
 */
export interface ServiceWithName {
  name: string;
  active?: boolean;
  category?: 'platform' | 'domain';
  description?: string;
  image?: string;
  entry?: string;
  region?: string;
  port?: number;
  scaling?: { min?: number; max?: number };
  cpu?: string;
  memory?: string;
  security?: { allowUnauthenticated?: boolean };
  profile?: 'core' | 'llm' | 'mcp-server' | 'gateway';
  mcp?: { exposure?: 'platform-only' | 'platform+domain' };
  env?: string[];
  secrets?: string[];

  /**
   * Secure files to deploy with this service.
   *
   * Added in Sprint 374: Secure File Deployment.
   */
  secureFiles?: SecureFile[];
}
