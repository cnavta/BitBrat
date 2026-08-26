/**
 * Infrastructure Registry - Central infrastructure knowledge management
 *
 * Replaces fragmented hardcoded infrastructure lists across:
 * - parse-dependencies.ts
 * - docker-compose-strategy.ts
 * - generate-docker-compose.ts
 *
 * Provides single source of truth from architecture.yaml v2.
 *
 * @module infrastructure/registry
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type {
  ArchitectureYaml,
  InfrastructureSpec,
  PlatformCapability,
  Provider,
  ProviderImplementation,
  ServiceMetadata,
  ValidationResult,
} from './types';

/**
 * Cache for loaded architecture.yaml to avoid repeated I/O
 */
const architectureCache = new Map<string, ArchitectureYaml>();

/**
 * InfrastructureRegistry - Central registry for infrastructure resolution
 *
 * Core responsibilities:
 * 1. Load and parse architecture.yaml
 * 2. Resolve capabilities to provider implementations
 * 3. Merge configuration (platform → provider → context)
 * 4. Validate constraints and dependencies
 *
 * @example
 * ```typescript
 * // Get all infrastructure required by active services
 * const specs = InfrastructureRegistry.getRequiredInfrastructure(
 *   '/path/to/repo',
 *   'local',
 *   activeServices
 * );
 *
 * // Get specific capability implementation
 * const natSpec = InfrastructureRegistry.getInfrastructureByCapability(
 *   '/path/to/repo',
 *   'local',
 *   'messaging'
 * );
 * ```
 */
export class InfrastructureRegistry {
  /**
   * Load architecture.yaml with caching and v2 schema detection
   *
   * @param repoRoot - Repository root directory
   * @returns Parsed architecture.yaml
   * @throws Error if architecture.yaml not found or invalid
   *
   * @example
   * ```typescript
   * const arch = InfrastructureRegistry.loadArchitecture('/path/to/repo');
   * console.log(arch.platform?.version); // "2.0"
   * ```
   */
  static loadArchitecture(repoRoot: string): ArchitectureYaml {
    // Check cache first
    if (architectureCache.has(repoRoot)) {
      return architectureCache.get(repoRoot)!;
    }

    const archPath = path.join(repoRoot, 'architecture.yaml');

    if (!fs.existsSync(archPath)) {
      throw new Error(
        `architecture.yaml not found at ${archPath}\n` +
          `Repository root: ${repoRoot}\n` +
          `Please ensure you are in the BitBrat repository root.`
      );
    }

    let architecture: ArchitectureYaml;
    try {
      const content = fs.readFileSync(archPath, 'utf-8');
      architecture = yaml.parse(content) as ArchitectureYaml;
    } catch (error) {
      throw new Error(
        `Failed to parse architecture.yaml: ${error instanceof Error ? error.message : String(error)}\n` +
          `File: ${archPath}\n` +
          `Please verify YAML syntax is correct.`
      );
    }

    // Validate required sections exist
    if (!architecture.platform) {
      throw new Error(
        'architecture.yaml missing "platform" section\n' +
          'This is required for architecture.yaml v2 schema.\n' +
          'See: planning/sprint-5-anrn33/schema-proposal.md'
      );
    }

    if (!architecture.infrastructure) {
      throw new Error(
        'architecture.yaml missing "infrastructure" section\n' +
          'This is required for architecture.yaml v2 schema.\n' +
          'See: planning/sprint-5-anrn33/schema-proposal.md'
      );
    }

    if (!architecture.services) {
      throw new Error(
        'architecture.yaml missing "services" section\n' +
          'This is required for architecture.yaml v2 schema.'
      );
    }

    if (!architecture.executionContexts) {
      throw new Error(
        'architecture.yaml missing "executionContexts" section\n' +
          'This is required for architecture.yaml v2 schema.'
      );
    }

    // Cache for future calls
    architectureCache.set(repoRoot, architecture);

    return architecture;
  }

  /**
   * Get infrastructure implementation by capability for a given context
   *
   * Resolution process:
   * 1. Load architecture.yaml
   * 2. Get execution context and extract provider
   * 3. Get platform capability config
   * 4. Get provider implementation
   * 5. Merge config (platform → provider → context)
   * 6. Validate constraints
   * 7. Return InfrastructureSpec
   *
   * @param repoRoot - Repository root directory
   * @param context - Execution context name (e.g., 'local', 'staging')
   * @param capability - Capability name (e.g., 'messaging', 'caching')
   * @returns Infrastructure spec or null if not found
   * @throws Error if capability or provider implementation missing
   *
   * @example
   * ```typescript
   * const natSpec = InfrastructureRegistry.getInfrastructureByCapability(
   *   '/path/to/repo',
   *   'local',
   *   'messaging'
   * );
   * // Returns: { capability: 'messaging', provider: 'docker', serviceName: 'nats', ... }
   * ```
   */
  static getInfrastructureByCapability(
    repoRoot: string,
    context: string,
    capability: string
  ): InfrastructureSpec | null {
    const architecture = this.loadArchitecture(repoRoot);

    // Sprint 25: Agent-dev contexts are ephemeral and inherit infrastructure from 'local'
    // Fall back to 'local' context for infrastructure resolution
    const effectiveContext = context.startsWith('agent-dev-') ? 'local' : context;

    // Get execution context
    const executionContext = architecture.executionContexts![effectiveContext];
    if (!executionContext) {
      throw new Error(
        `Execution context "${effectiveContext}" not found in architecture.yaml\n` +
          `Available contexts: ${Object.keys(architecture.executionContexts!).join(', ')}\n` +
          `Original context: "${context}"`
      );
    }

    // Get provider name from context
    const providerName = executionContext.infrastructure?.provider;
    if (!providerName) {
      throw new Error(
        `Execution context "${context}" missing infrastructure.provider\n` +
          `Context infrastructure section: ${JSON.stringify(executionContext.infrastructure, null, 2)}`
      );
    }

    // Get platform capability
    const platformCap = architecture.platform!.infrastructure?.[capability];
    if (!platformCap) {
      throw new Error(
        `Unknown capability "${capability}"\n` +
          `Available capabilities: ${Object.keys(architecture.platform!.infrastructure || {}).join(', ')}\n` +
          `Please check platform.infrastructure section in architecture.yaml`
      );
    }

    // Get provider
    const provider = architecture.infrastructure![providerName];
    if (!provider) {
      throw new Error(
        `Provider "${providerName}" not found in architecture.yaml\n` +
          `Available providers: ${Object.keys(architecture.infrastructure!).join(', ')}\n` +
          `Context "${context}" specifies provider "${providerName}" but it is not defined.`
      );
    }

    // Get provider implementation for this capability
    const providerImpl = provider[capability] as ProviderImplementation | undefined;
    if (!providerImpl) {
      throw new Error(
        `Provider "${providerName}" does not implement capability "${capability}"\n` +
          `Provider capabilities: ${Object.keys(provider).filter(k => !['config', 'constraints', 'intent'].includes(k)).join(', ')}\n` +
          `Please add infrastructure.${providerName}.${capability} to architecture.yaml`
      );
    }

    // Merge config (platform → provider → context)
    const mergedConfig = {
      ...platformCap.config,
      ...providerImpl.config,
      ...executionContext.infrastructure?.[capability]?.config,
    };

    // Validate constraints
    this.validateConstraints(platformCap, providerImpl, capability, providerName);

    // Build InfrastructureSpec
    const spec: InfrastructureSpec = {
      capability,
      provider: providerName,
      serviceName: providerImpl.service,
      type: providerImpl.type,
      image: providerImpl.image,
      ports: providerImpl.ports,
      volumes: providerImpl.volumes,
      env: providerImpl.env,
      config: mergedConfig,
      healthCheck: providerImpl.healthCheck,
      intent: providerImpl.intent,
    };

    return spec;
  }

  /**
   * Validate that provider implementation satisfies platform constraints
   *
   * @param platformCap - Platform capability with constraints
   * @param providerImpl - Provider implementation
   * @param capability - Capability name (for error messages)
   * @param provider - Provider name (for error messages)
   * @throws Error if constraints violated
   *
   * @internal
   */
  private static validateConstraints(
    platformCap: PlatformCapability,
    providerImpl: ProviderImplementation,
    capability: string,
    provider: string
  ): void {
    if (!platformCap.constraints) {
      return; // No constraints to validate
    }

    const constraints = platformCap.constraints;
    const config = providerImpl.config || {};

    // Example: Check minMemory constraint for caching
    if (constraints.minMemory && config.maxmemory) {
      const minMemoryBytes = this.parseMemoryString(constraints.minMemory);
      const maxMemoryBytes = this.parseMemoryString(config.maxmemory);

      if (maxMemoryBytes < minMemoryBytes) {
        throw new Error(
          `Provider "${provider}" violates constraint "minMemory" for capability "${capability}":\n` +
            `  Platform requires: ${constraints.minMemory}\n` +
            `  Provider provides: ${config.maxmemory}\n` +
            `Please increase maxmemory in infrastructure.${provider}.${capability}.config`
        );
      }
    }

    // Example: Check requireDurability constraint
    if (constraints.requireDurability && !config.appendonly && !config.persistence) {
      throw new Error(
        `Provider "${provider}" violates constraint "requireDurability" for capability "${capability}":\n` +
          `  Platform requires: durable storage\n` +
          `  Provider provides: no persistence configured\n` +
          `Please enable persistence in infrastructure.${provider}.${capability}.config`
      );
    }

    // Example: Check requirePersistence constraint (same validation logic as requireDurability)
    if (constraints.requirePersistence && !config.appendonly && !config.persistence) {
      throw new Error(
        `Provider "${provider}" violates constraint "requirePersistence" for capability "${capability}":\n` +
          `  Platform requires: durable storage\n` +
          `  Provider provides: no persistence configured\n` +
          `Please enable persistence in infrastructure.${provider}.${capability}.config`
      );
    }

    // More constraint validations can be added here as needed
  }

  /**
   * Parse memory string (e.g., "256mb", "1gb") to bytes
   *
   * @param memStr - Memory string (e.g., "256mb")
   * @returns Memory in bytes
   * @internal
   */
  private static parseMemoryString(memStr: string): number {
    const match = memStr.match(/^(\d+)(kb|mb|gb|tb)?$/i);
    if (!match) {
      throw new Error(`Invalid memory string: ${memStr}`);
    }

    const value = parseInt(match[1], 10);
    const unit = (match[2] || 'b').toLowerCase();

    const multipliers: Record<string, number> = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
      tb: 1024 * 1024 * 1024 * 1024,
    };

    return value * (multipliers[unit] || 1);
  }

  /**
   * Get all infrastructure required by active services
   *
   * Replaces hardcoded lists in parse-dependencies.ts
   *
   * @param repoRoot - Repository root directory
   * @param context - Execution context name
   * @param services - List of active services
   * @returns Array of infrastructure specs (deduplicated)
   *
   * @example
   * ```typescript
   * const specs = InfrastructureRegistry.getRequiredInfrastructure(
   *   '/path/to/repo',
   *   'local',
   *   [{ name: 'llm-bot', dependencies: { infrastructure: ['messaging', 'caching', 'persistence'] } }]
   * );
   * // Returns: [natSpec, redisSpec, postgresSpec]
   * ```
   */
  static getRequiredInfrastructure(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): InfrastructureSpec[] {
    const architecture = this.loadArchitecture(repoRoot);

    // Collect unique capabilities from all services
    const capabilities = new Set<string>();

    for (const service of services) {
      // Get service config from architecture.yaml
      const serviceConfig = architecture.services![service.name];
      if (!serviceConfig) {
        console.warn(`Service "${service.name}" not found in architecture.yaml, skipping`);
        continue;
      }

      const deps = serviceConfig.dependencies?.infrastructure || [];
      deps.forEach((cap: string) => capabilities.add(cap));
    }

    // Resolve each capability to InfrastructureSpec
    const specs: InfrastructureSpec[] = [];

    for (const capability of Array.from(capabilities).sort()) {
      try {
        const spec = this.getInfrastructureByCapability(repoRoot, context, capability);
        if (spec) {
          specs.push(spec);
        }
      } catch (error) {
        throw new Error(
          `Failed to resolve infrastructure capability "${capability}":\n` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return specs;
  }

  /**
   * Get all infrastructure service names for Docker Compose generation
   *
   * Replaces hardcoded list in docker-compose-strategy.ts
   *
   * @param repoRoot - Repository root directory
   * @param context - Execution context name
   * @returns Array of infrastructure service names (e.g., ['nats', 'redis', 'postgres'])
   *
   * @example
   * ```typescript
   * const infraServices = InfrastructureRegistry.getInfrastructureServices('/path/to/repo', 'local');
   * // Returns: ['nats', 'redis', 'postgres']
   * ```
   */
  static getInfrastructureServices(repoRoot: string, context: string): string[] {
    const architecture = this.loadArchitecture(repoRoot);

    // Get execution context
    const executionContext = architecture.executionContexts![context];
    if (!executionContext) {
      throw new Error(`Execution context "${context}" not found in architecture.yaml`);
    }

    // Get provider name
    const providerName = executionContext.infrastructure?.provider;
    if (!providerName) {
      throw new Error(`Execution context "${context}" missing infrastructure.provider`);
    }

    // Get provider
    const provider = architecture.infrastructure![providerName];
    if (!provider) {
      throw new Error(`Provider "${providerName}" not found in architecture.yaml`);
    }

    // Extract service names from provider implementations
    const serviceNames: string[] = [];

    for (const [key, value] of Object.entries(provider)) {
      // Skip metadata fields
      if (['config', 'constraints', 'intent'].includes(key)) {
        continue;
      }

      const impl = value as ProviderImplementation;
      if (impl.service) {
        serviceNames.push(impl.service);
      }
    }

    return serviceNames.sort();
  }

  /**
   * Get all infrastructure specs for a given context
   *
   * Used by docker-compose generation to get full specs instead of just service names.
   * Sprint 5 I3.3: Replaces reading from docker-compose.local.yaml
   *
   * @param repoRoot - Repository root directory
   * @param context - Execution context name
   * @returns Array of infrastructure specs with full configuration
   *
   * @example
   * ```typescript
   * const specs = InfrastructureRegistry.getAllInfrastructureSpecs('/path/to/repo', 'local');
   * // Returns: [{ capability: 'messaging', serviceName: 'nats', image: 'nats:2.10-alpine', ... }, ...]
   * ```
   */
  static getAllInfrastructureSpecs(repoRoot: string, context: string): InfrastructureSpec[] {
    const architecture = this.loadArchitecture(repoRoot);

    // Get all platform capabilities
    const capabilities = Object.keys(architecture.platform!.infrastructure || {});

    // Get spec for each capability
    const specs: InfrastructureSpec[] = [];

    for (const capability of capabilities) {
      try {
        const spec = this.getInfrastructureByCapability(repoRoot, context, capability);
        if (spec) {
          specs.push(spec);
        }
      } catch (error) {
        console.warn(`[InfrastructureRegistry] Failed to get spec for capability '${capability}': ${error instanceof Error ? error.message : String(error)}`);
        // Continue with other capabilities
      }
    }

    return specs;
  }

  /**
   * Validate service dependencies can be satisfied
   *
   * Checks:
   * 1. All required capabilities have provider implementations
   * 2. Provider satisfies platform constraints
   * 3. Service-to-service dependencies are active
   *
   * @param repoRoot - Repository root directory
   * @param context - Execution context name
   * @param services - List of active services
   * @returns Validation result with errors and warnings
   *
   * @example
   * ```typescript
   * const result = InfrastructureRegistry.validateDependencies(
   *   '/path/to/repo',
   *   'local',
   *   activeServices
   * );
   * if (!result.valid) {
   *   console.error('Validation errors:', result.errors);
   * }
   * ```
   */
  static validateDependencies(
    repoRoot: string,
    context: string,
    services: ServiceMetadata[]
  ): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    const architecture = this.loadArchitecture(repoRoot);

    // Get execution context
    const executionContext = architecture.executionContexts![context];
    if (!executionContext) {
      result.valid = false;
      result.errors.push(`Execution context "${context}" not found in architecture.yaml`);
      return result;
    }

    // Get provider name
    const providerName = executionContext.infrastructure?.provider;
    if (!providerName) {
      result.valid = false;
      result.errors.push(`Execution context "${context}" missing infrastructure.provider`);
      return result;
    }

    // Validate each service
    for (const service of services) {
      const serviceConfig = architecture.services![service.name];
      if (!serviceConfig) {
        result.warnings.push(`Service "${service.name}" not found in architecture.yaml`);
        continue;
      }

      // Validate infrastructure dependencies
      const infraDeps = serviceConfig.dependencies?.infrastructure || [];
      for (const capability of infraDeps) {
        try {
          this.getInfrastructureByCapability(repoRoot, context, capability);
        } catch (error) {
          result.valid = false;
          result.errors.push(
            `Service "${service.name}" requires capability "${capability}" but it cannot be satisfied:\n` +
              `  ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Validate service-to-service dependencies
      const serviceDeps = serviceConfig.dependencies?.services || [];
      for (const depService of serviceDeps) {
        const depConfig = architecture.services![depService];
        if (!depConfig || !depConfig.active) {
          result.warnings.push(
            `Service "${service.name}" depends on "${depService}" but it is not active`
          );
        }
      }
    }

    return result;
  }

  /**
   * Clear the architecture cache (useful for testing)
   *
   * @internal
   */
  static clearCache(): void {
    architectureCache.clear();
  }
}
