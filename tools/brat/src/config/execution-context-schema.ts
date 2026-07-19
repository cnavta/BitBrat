import { z } from 'zod';

/**
 * Sprint 349: Environment Unification - Execution Context Schema
 *
 * Defines the schema for execution contexts, which unify environment configuration
 * across deployment types (docker-compose, cloud-run, k8s) and runtime concerns
 * (gateway URLs, persistence, environment overlays).
 *
 * See: documentation/architecture/environment-unification-proposal.md
 */

// ============================================================================
// Deployment Configuration Schemas
// ============================================================================

/**
 * Docker deployment configuration
 * Used for: local development, remote staging, self-hosted production
 */
export const DockerDeploymentSchema = z.object({
  host: z.string().describe('Docker host (unix:///var/run/docker.sock or ssh://user@host)'),
  remoteDir: z.string().optional().describe('Remote directory for docker-compose files (SSH deployments)'),
  maxConcurrent: z.number().int().positive().optional().describe('Maximum concurrent Docker operations'),
});

/**
 * Google Cloud Platform deployment configuration
 * Used for: Cloud Run deployments
 */
export const GcpDeploymentSchema = z.object({
  project: z.string().describe('GCP project ID'),
  region: z.string().describe('GCP region (e.g., us-central1)'),
});

/**
 * Kubernetes deployment configuration
 * Used for: K8s deployments (future)
 */
export const K8sDeploymentSchema = z.object({
  cluster: z.string().describe('Kubernetes cluster name or context'),
  namespace: z.string().describe('Kubernetes namespace'),
});

/**
 * Deployment configuration (discriminated union by type)
 * Exactly one deployment sub-config must be present based on type.
 */
export const DeploymentSchema = z.object({
  type: z.enum(['docker-compose', 'cloud-run', 'k8s']).describe('Deployment platform type'),
  docker: DockerDeploymentSchema.optional(),
  gcp: GcpDeploymentSchema.optional(),
  k8s: K8sDeploymentSchema.optional(),
}).refine(
  (data) => {
    // Validate that the correct sub-schema is present for the deployment type
    if (data.type === 'docker-compose' && !data.docker) {
      return false;
    }
    if (data.type === 'cloud-run' && !data.gcp) {
      return false;
    }
    if (data.type === 'k8s' && !data.k8s) {
      return false;
    }
    return true;
  },
  {
    message: 'Deployment configuration must include the appropriate sub-config for the specified type',
  }
);

// ============================================================================
// Runtime Configuration Schemas
// ============================================================================

/**
 * Gateway (api-gateway/tool-gateway) configuration
 * Used for: MCP tool access, fleet management, chat commands
 */
export const GatewayConfigSchema = z.object({
  url: z.string().optional().describe('Explicit gateway URL (e.g., http://bitbrat.lan:3017)'),
  authToken: z.string().optional().describe('MCP authentication token (e.g., ${MCP_AUTH_TOKEN})'),
  autoDiscover: z.boolean().optional().describe('Auto-discover gateway port from docker ps'),
  fallbackPort: z.number().int().positive().optional().describe('Fallback port if auto-discovery fails'),
}).refine(
  (data) => {
    // At least one resolution method must be provided
    return data.url || data.autoDiscover || data.fallbackPort;
  },
  {
    message: 'Gateway config must provide at least one of: url, autoDiscover, or fallbackPort',
  }
);

/**
 * Persistence connection configuration (PostgreSQL)
 */
export const PersistenceConnectionSchema = z.object({
  host: z.string().describe('Database host'),
  port: z.number().int().positive().describe('Database port'),
  database: z.string().describe('Database name'),
  username: z.string().describe('Database username'),
  password: z.string().describe('Database password (can use ${ENV_VAR} interpolation)'),
});

/**
 * Persistence configuration
 * Supports: postgres (default), firestore (legacy)
 */
export const PersistenceConfigSchema = z.object({
  driver: z.enum(['postgres', 'firestore']).describe('Persistence driver'),
  autoDiscover: z.boolean().optional().describe('Auto-discover database from docker-compose stack'),
  connection: PersistenceConnectionSchema.optional().describe('Explicit database connection config'),
}).refine(
  (data) => {
    // Postgres requires either connection or autoDiscover
    if (data.driver === 'postgres' && !data.connection && !data.autoDiscover) {
      return false;
    }
    return true;
  },
  {
    message: 'PostgreSQL persistence requires either connection config or autoDiscover',
  }
);

/**
 * Environment variable overlay configuration
 * Defines how environment variables are loaded and merged for services.
 *
 * Load order (later overrides earlier):
 * 1. global.yaml - Base environment variables
 * 2. infra.yaml - Infrastructure-specific config
 * 3. {service}.yaml - Per-service customization
 * 4. .secure.{context} - Secrets (highest priority)
 */
export const EnvOverlayConfigSchema = z.object({
  path: z.string().describe('Directory path containing overlay files (e.g., env/local)'),
  files: z.array(z.string()).describe('Load order (e.g., ["global.yaml", "infra.yaml", "{service}.yaml"])'),
  secure: z.string().optional().describe('Optional secrets file (e.g., .secure.local)'),
});

/**
 * Runtime configuration
 * Defines runtime concerns: gateway access, persistence, environment variables
 */
export const RuntimeConfigSchema = z.object({
  gateway: GatewayConfigSchema.optional().describe('Gateway (api-gateway/tool-gateway) configuration'),
  persistence: PersistenceConfigSchema.describe('Persistence configuration (postgres or firestore)'),
  envOverlay: EnvOverlayConfigSchema.optional().describe('Environment variable overlay configuration'),
});

// ============================================================================
// Execution Context Schema
// ============================================================================

/**
 * Execution Context
 * Unifies deployment configuration and runtime concerns for a single environment.
 *
 * Examples: local, staging, prod, llm-test, demo
 */
export const ExecutionContextSchema = z.object({
  description: z.string().optional().describe('Human-readable description of this context'),
  deployment: DeploymentSchema.describe('Deployment platform configuration'),
  runtime: RuntimeConfigSchema.describe('Runtime configuration (gateway, persistence, env overlays)'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization (e.g., ["development", "local"])'),
});

/**
 * Execution Contexts map
 * Record of context name → ExecutionContext
 */
export const ExecutionContextsSchema = z.record(ExecutionContextSchema);

// ============================================================================
// TypeScript Types (exported for use in application code)
// ============================================================================

export type DockerDeployment = z.infer<typeof DockerDeploymentSchema>;
export type GcpDeployment = z.infer<typeof GcpDeploymentSchema>;
export type K8sDeployment = z.infer<typeof K8sDeploymentSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type PersistenceConnection = z.infer<typeof PersistenceConnectionSchema>;
export type PersistenceConfig = z.infer<typeof PersistenceConfigSchema>;
export type EnvOverlayConfig = z.infer<typeof EnvOverlayConfigSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
export type ExecutionContexts = z.infer<typeof ExecutionContextsSchema>;
