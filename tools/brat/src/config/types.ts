/**
 * types.ts
 *
 * Type definitions for brat CLI configuration and service definitions.
 *
 * Sprint 374: Secure File Deployment
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
