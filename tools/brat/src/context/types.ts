/**
 * Sprint 349: Environment Unification - Context Resolution Types
 *
 * Defines types for resolved execution contexts used throughout the platform.
 */

import type {
  ExecutionContext,
  DockerDeployment,
  GcpDeployment,
  K8sDeployment,
} from '../config/execution-context-schema';

/**
 * Resolved gateway configuration
 * Gateway URL is always resolved (never undefined)
 */
export interface ResolvedGateway {
  /** Resolved gateway URL (auto-discovered or explicit) */
  url: string;
  /** Optional authentication token */
  authToken?: string;
}

/**
 * Resolved persistence configuration (PostgreSQL)
 */
export interface ResolvedPostgresConnection {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * Resolved persistence configuration
 */
export interface ResolvedPersistence {
  driver: 'postgres' | 'firestore';
  /** Connection details (postgres only) */
  connection?: ResolvedPostgresConnection;
}

/**
 * Resolved runtime configuration
 */
export interface ResolvedRuntime {
  /** Gateway configuration (always resolved) */
  gateway: ResolvedGateway;
  /** Persistence configuration */
  persistence: ResolvedPersistence;
  /** Merged environment variables from overlays */
  envVars: Record<string, string>;
}

/**
 * Resolved execution context
 * All optional fields from ExecutionContext are resolved to concrete values
 */
export interface ResolvedContext {
  /** Context name (e.g., 'local', 'staging', 'prod') */
  name: string;
  /** Optional description */
  description?: string;
  /** Deployment configuration */
  deployment: {
    type: 'docker-compose' | 'cloud-run' | 'k8s';
    docker?: DockerDeployment;
    gcp?: GcpDeployment;
    k8s?: K8sDeployment;
  };
  /** Runtime configuration (fully resolved) */
  runtime: ResolvedRuntime;
  /** Optional tags */
  tags?: string[];
}

/**
 * ~/.bratrc configuration file format
 */
export interface BratrcConfig {
  /** Current execution context (set by 'brat use') */
  current_context?: string;
  /** User preferences */
  preferences?: {
    auto_confirm_deploys?: boolean;
    default_log_level?: string;
  };
  /** Context history (for 'brat use' autocomplete) */
  history?: {
    last_contexts?: string[];
  };
}
