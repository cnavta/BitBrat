/**
 * Infrastructure Type Definitions for Architecture.yaml v2
 *
 * These types define the structure of infrastructure declarations in architecture.yaml v2,
 * supporting platform-agnostic capability definitions with provider-specific implementations.
 *
 * @module infrastructure/types
 */

/**
 * Health check configuration for infrastructure services
 *
 * Based on Docker Compose healthcheck syntax, supports various check types:
 * - CMD: Execute command directly
 * - CMD-SHELL: Execute command in shell
 * - NONE: Disable health check
 *
 * @example
 * ```typescript
 * const postgresCheck: HealthCheck = {
 *   test: ['CMD-SHELL', 'pg_isready -U bitbrat'],
 *   interval: '10s',
 *   timeout: '5s',
 *   retries: 10,
 *   startPeriod: '30s'
 * };
 * ```
 */
export interface HealthCheck {
  /** Health check command (e.g., ['CMD-SHELL', 'pg_isready -U bitbrat']) */
  test: string[];

  /** Interval between health checks (e.g., '10s') */
  interval?: string;

  /** Timeout for each health check (e.g., '5s') */
  timeout?: string;

  /** Number of consecutive failures before unhealthy (default: 3) */
  retries?: number;

  /** Grace period before health checks start (e.g., '30s') */
  startPeriod?: string;
}

/**
 * Volume configuration for infrastructure services
 *
 * Supports both named volumes and bind mounts.
 *
 * @example
 * ```typescript
 * // Named volume
 * const namedVol: VolumeConfig = {
 *   name: 'postgres-data',
 *   mount: '/var/lib/postgresql/data'
 * };
 *
 * // Bind mount
 * const bindMount: VolumeConfig = {
 *   source: './migrations',
 *   mount: '/docker-entrypoint-initdb.d',
 *   readOnly: true
 * };
 * ```
 */
export interface VolumeConfig {
  /** Volume name (for named volumes) */
  name?: string;

  /** Source path (for bind mounts, relative to repo root) */
  source?: string;

  /** Mount path inside container */
  mount: string;

  /** Mount as read-only (default: false) */
  readOnly?: boolean;
}

/**
 * Complete infrastructure specification after resolution
 *
 * This is the resolved result after merging:
 * - Platform capability requirements
 * - Provider implementation details
 * - Context-specific overrides
 *
 * @example
 * ```typescript
 * const natSpec: InfrastructureSpec = {
 *   capability: 'messaging',
 *   provider: 'docker',
 *   serviceName: 'nats',
 *   image: 'nats:2.10-alpine',
 *   config: {
 *     defaultTTL: 3600,        // From platform
 *     maxPayload: 10485760,    // From provider
 *     retention: 604800         // From provider
 *   },
 *   healthCheck: {
 *     test: ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:8222/healthz'],
 *     interval: '10s',
 *     timeout: '5s',
 *     retries: 10
 *   },
 *   intent: ['Lightweight message bus for development']
 * };
 * ```
 */
export interface InfrastructureSpec {
  /** Capability name (e.g., 'messaging', 'caching', 'persistence') */
  capability: string;

  /** Provider name (e.g., 'docker', 'gcp', 'aws', 'azure') */
  provider: string;

  /** Service name for Docker (e.g., 'nats', 'redis', 'postgres') */
  serviceName?: string;

  /** Service type for cloud providers (e.g., 'pubsub', 'memorystore', 'cloudsql') */
  type?: string;

  /** Docker image (Docker provider only) */
  image?: string;

  /** Port mappings (e.g., { client: '4222:4222', http: '8222:8222' }) */
  ports?: Record<string, string>;

  /** Volume configurations */
  volumes?: VolumeConfig[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Merged configuration (platform → provider → context) */
  config: Record<string, any>;

  /** Health check configuration */
  healthCheck?: HealthCheck;

  /** Intent/rationale for this implementation */
  intent?: string[];
}

/**
 * Platform capability definition from architecture.yaml
 *
 * Defines WHAT the platform needs, WHY it needs it, and HOW it should behave.
 *
 * @example
 * ```typescript
 * const messagingCap: PlatformCapability = {
 *   required: true,
 *   capabilities: ['publish-subscribe', 'stream-retention', 'dead-letter-queue'],
 *   config: {
 *     defaultTTL: 3600,
 *     deliveryGuarantee: 'at-least-once'
 *   },
 *   constraints: {
 *     minRetention: 86400,
 *     requireDurability: true
 *   },
 *   intent: [
 *     'Event-driven orchestration between services',
 *     'Asynchronous task processing with retry'
 *   ]
 * };
 * ```
 */
export interface PlatformCapability {
  /** Is this capability required for platform operation? */
  required: boolean;

  /** List of required capabilities (e.g., ['publish-subscribe', 'stream-retention']) */
  capabilities?: string[];

  /** Platform-level default configuration */
  config?: Record<string, any>;

  /** Constraints that provider implementations MUST satisfy */
  constraints?: Record<string, any>;

  /** Why this capability exists, current use cases */
  intent?: string[];
}

/**
 * Provider configuration metadata
 *
 * Describes characteristics and limitations of a provider.
 *
 * @example
 * ```typescript
 * const dockerConfig: ProviderConfig = {
 *   scope: 'local',
 *   scalability: 'vertical',
 *   costModel: 'zero-cost'
 * };
 * ```
 */
export interface ProviderConfig {
  /** Deployment scope (e.g., 'local', 'regional', 'global') */
  scope?: string;

  /** Scalability model (e.g., 'vertical', 'horizontal', 'serverless') */
  scalability?: string;

  /** Cost model (e.g., 'zero-cost', 'pay-per-use', 'reserved-capacity') */
  costModel?: string;
}

/**
 * Provider constraints and limitations
 *
 * @example
 * ```typescript
 * const dockerConstraints: ProviderConstraints = {
 *   maxInstances: 1,
 *   offlineCapable: true
 * };
 * ```
 */
export interface ProviderConstraints {
  /** Maximum number of instances (null = unlimited) */
  maxInstances?: number | null;

  /** Can run without internet connectivity? */
  offlineCapable?: boolean;

  /** Other provider-specific constraints */
  [key: string]: any;
}

/**
 * Provider implementation for a capability
 *
 * HOW a specific provider implements a capability.
 *
 * @example
 * ```typescript
 * const dockerMessaging: ProviderImplementation = {
 *   service: 'nats',
 *   image: 'nats:2.10-alpine',
 *   ports: { client: '4222:4222', http: '8222:8222' },
 *   config: { maxPayload: 10485760 },
 *   healthCheck: {
 *     test: ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:8222/healthz'],
 *     interval: '10s'
 *   },
 *   intent: ['Lightweight message bus for development']
 * };
 * ```
 */
export interface ProviderImplementation {
  /** Service name (Docker) or type (cloud providers) */
  service?: string;
  type?: string;

  /** Docker image (Docker provider only) */
  image?: string;

  /** Port mappings */
  ports?: Record<string, string>;

  /** Volume configurations */
  volumes?: VolumeConfig[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Provider-specific configuration */
  config?: Record<string, any>;

  /** Health check configuration */
  healthCheck?: HealthCheck;

  /** Why this implementation over alternatives */
  intent?: string[];
}

/**
 * Complete provider definition
 *
 * @example
 * ```typescript
 * const dockerProvider: Provider = {
 *   config: { scope: 'local', scalability: 'vertical', costModel: 'zero-cost' },
 *   constraints: { maxInstances: 1, offlineCapable: true },
 *   intent: ['Primary development environment', 'Self-hosted production'],
 *   messaging: { service: 'nats', image: 'nats:2.10-alpine', ... },
 *   caching: { service: 'redis', image: 'redis:7-alpine', ... },
 *   persistence: { service: 'postgres', image: 'postgres:15-alpine', ... }
 * };
 * ```
 */
export interface Provider {
  /** Provider metadata */
  config?: ProviderConfig;

  /** Provider constraints */
  constraints?: ProviderConstraints;

  /** Why this provider exists, migration path */
  intent?: string[];

  /** Capability implementations (indexed by capability name) */
  [capability: string]: ProviderImplementation | ProviderConfig | ProviderConstraints | string[] | undefined;
}

/**
 * Validation result for dependency checks
 *
 * @example
 * ```typescript
 * const result: ValidationResult = {
 *   valid: false,
 *   errors: [
 *     'Service "llm-bot" requires capability "messaging" but provider "docker" does not implement it'
 *   ],
 *   warnings: [
 *     'Provider "docker" maxmemory (128mb) is below platform constraint minMemory (256mb) for "caching"'
 *   ]
 * };
 * ```
 */
export interface ValidationResult {
  /** Are all dependencies satisfied? */
  valid: boolean;

  /** Critical errors (deployment will fail) */
  errors: string[];

  /** Warnings (deployment may have issues) */
  warnings: string[];
}

/**
 * Service metadata from architecture.yaml
 *
 * Minimal interface for service information needed by InfrastructureRegistry.
 */
export interface ServiceMetadata {
  /** Service name (e.g., 'llm-bot', 'auth', 'tool-gateway') */
  name: string;

  /** Is service active (deployable)? */
  active?: boolean;

  /** Infrastructure capabilities required by this service */
  dependencies?: {
    infrastructure?: string[];
    services?: string[];
  };
}

/**
 * Architecture.yaml v2 schema structure (partial)
 *
 * This interface defines the minimal structure needed for infrastructure resolution.
 */
export interface ArchitectureYaml {
  /** Platform-level infrastructure requirements */
  platform?: {
    version?: string;
    infrastructure?: Record<string, PlatformCapability>;
  };

  /** Provider implementations (docker, gcp, aws, azure, k8s) */
  infrastructure?: Record<string, Provider>;

  /** Service definitions */
  services?: Record<string, ServiceMetadata & any>;

  /** Execution context definitions */
  executionContexts?: Record<string, {
    infrastructure?: {
      provider?: string;
      [capability: string]: any;
    };
    [key: string]: any;
  }>;
}
