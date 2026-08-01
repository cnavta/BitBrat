/**
 * Docker Compose File Merger
 *
 * Utility for merging service-specific Docker Compose overrides into generated
 * base compose files, with support for secureFiles volume mount injection.
 *
 * **Use Case:**
 * When deploying with `brat bit deploy`, generated compose files (docker-compose.staging.yaml)
 * need to be merged with service-specific overrides (services/llm-bot.compose.yaml) to include
 * volume mounts from architecture.yaml secureFiles definitions.
 *
 * **Merge Precedence:**
 * Service-specific values always override generated file values.
 * Arrays (volumes, depends_on) are merged by appending and deduplicating.
 *
 * @module orchestration/docker/compose-merger
 * @since Sprint 375
 */

import yaml from 'js-yaml';
import type { SecureFile } from '../../config/types';

/**
 * Docker Compose service definition (partial types for merge operations)
 */
export interface ComposeService {
  image?: string;
  build?: {
    context?: string;
    dockerfile?: string;
    args?: Record<string, string>;
  };
  environment?: Record<string, string> | string[];
  volumes?: string[];
  depends_on?: Record<string, { condition?: string }> | string[];
  networks?: Record<string, { aliases?: string[] }> | string[];
  ports?: string[];
  healthcheck?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Docker Compose file structure
 */
export interface ComposeFile {
  version?: string;
  services: Record<string, ComposeService>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional top-level properties
}

/**
 * Options for merge operations
 */
export interface MergeOptions {
  /** Service name to merge (must exist in both files) */
  serviceName: string;

  /** Whether to preserve comments (best-effort, not guaranteed) */
  preserveComments?: boolean;

  /** Validation mode: 'strict' throws on missing service, 'lenient' returns base unchanged */
  validationMode?: 'strict' | 'lenient';
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Merged YAML content as string */
  yaml: string;

  /** Parsed merged compose file */
  parsed: ComposeFile;

  /** Merge statistics */
  stats: {
    volumesAdded: number;
    environmentAdded: number;
    dependenciesAdded: number;
    secureFilesMounted: number;
  };
}

/**
 * Docker Compose file merger with secureFiles support.
 *
 * **Example Usage:**
 * ```typescript
 * const merger = new ComposeMerger();
 *
 * // Merge service-specific compose file
 * const result = merger.merge(
 *   generatedYaml,
 *   serviceOverrideYaml,
 *   { serviceName: 'llm-bot' }
 * );
 *
 * // Inject secureFiles volume mounts
 * const finalYaml = merger.injectSecureFiles(
 *   result.yaml,
 *   'llm-bot',
 *   ['/opt/secrets/gcp.json:/var/secrets/gcp.json:ro'],
 *   { GOOGLE_APPLICATION_CREDENTIALS: '/var/secrets/gcp.json' }
 * );
 * ```
 */
export class ComposeMerger {
  /**
   * Merge service-specific compose file into base compose file.
   *
   * **Merge Rules:**
   * - **volumes** (service-level): Arrays are merged (base + service), duplicates removed
   * - **volumes** (top-level): Named volumes from override merged into base
   * - **environment**: Objects merged, service values override base
   * - **depends_on**: Objects merged (union of dependencies)
   * - **networks**: Objects merged, service aliases appended
   * - **Other fields**: Service value replaces base value
   *
   * @param baseYaml - Generated compose file content (e.g., docker-compose.staging.yaml)
   * @param serviceYaml - Service-specific compose file content (e.g., services/llm-bot.compose.yaml)
   * @param options - Merge options including service name
   * @returns Merged YAML content with statistics
   * @throws Error if YAML parsing fails or service not found (in strict mode)
   *
   * @example
   * ```typescript
   * const merger = new ComposeMerger();
   * const result = merger.merge(
   *   fs.readFileSync('docker-compose.staging.yaml', 'utf-8'),
   *   fs.readFileSync('services/llm-bot.compose.yaml', 'utf-8'),
   *   { serviceName: 'llm-bot' }
   * );
   * console.log(result.stats); // { volumesAdded: 2, environmentAdded: 3, ... }
   * ```
   */
  merge(baseYaml: string, serviceYaml: string, options: MergeOptions): MergeResult {
    const { serviceName, validationMode = 'strict' } = options;

    // Parse YAML files
    let baseCompose: ComposeFile;
    let serviceCompose: ComposeFile;

    try {
      baseCompose = yaml.load(baseYaml) as ComposeFile;
    } catch (error: any) {
      throw new Error(`Failed to parse base compose YAML: ${error.message}`);
    }

    try {
      serviceCompose = yaml.load(serviceYaml) as ComposeFile;
    } catch (error: any) {
      throw new Error(`Failed to parse service compose YAML: ${error.message}`);
    }

    // Validate service exists in service override file
    const baseService = baseCompose.services[serviceName];
    const serviceOverride = serviceCompose.services[serviceName];

    if (!baseService) {
      // Service doesn't exist in base - add it from override (Sprint 378)
      // This handles bulk deployments where base is infrastructure-only
      const errorMsg = `Service '${serviceName}' not found in base compose file`;
      if (validationMode === 'strict') {
        throw new Error(errorMsg);
      }
      // Lenient mode: ADD service from override to base
      if (!serviceOverride) {
        // Service missing from both base and override - return base unchanged
        return {
          yaml: baseYaml,
          parsed: baseCompose,
          stats: {
            volumesAdded: 0,
            environmentAdded: 0,
            dependenciesAdded: 0,
            secureFilesMounted: 0,
          },
        };
      }
      // Add service from override to base
      baseCompose.services[serviceName] = serviceOverride;

      // Sprint 378: Also merge additional services and top-level volumes
      this.mergeAdditionalServices(baseCompose, serviceCompose, serviceName);
      this.mergeTopLevelVolumes(baseCompose, serviceCompose);

      // Convert back to YAML
      const mergedYaml = yaml.dump(baseCompose, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });

      return {
        yaml: mergedYaml,
        parsed: baseCompose,
        stats: {
          volumesAdded: serviceOverride.volumes?.length || 0,
          environmentAdded: Array.isArray(serviceOverride.environment)
            ? serviceOverride.environment.length
            : Object.keys(serviceOverride.environment || {}).length,
          dependenciesAdded: typeof serviceOverride.depends_on === 'object' && !Array.isArray(serviceOverride.depends_on)
            ? Object.keys(serviceOverride.depends_on).length
            : Array.isArray(serviceOverride.depends_on)
            ? serviceOverride.depends_on.length
            : 0,
          secureFilesMounted: 0,
        },
      };
    }

    if (!serviceOverride) {
      const errorMsg = `Service '${serviceName}' not found in service-specific compose file`;
      if (validationMode === 'strict') {
        throw new Error(errorMsg);
      }
      // Lenient mode: return base unchanged
      return {
        yaml: baseYaml,
        parsed: baseCompose,
        stats: {
          volumesAdded: 0,
          environmentAdded: 0,
          dependenciesAdded: 0,
          secureFilesMounted: 0,
        },
      };
    }

    // Perform merge
    const stats = {
      volumesAdded: 0,
      environmentAdded: 0,
      dependenciesAdded: 0,
      secureFilesMounted: 0,
    };

    const mergedService = this.mergeServiceDefinitions(
      baseService,
      serviceOverride,
      stats
    );

    // Update base compose with merged service
    baseCompose.services[serviceName] = mergedService;

    // Sprint 378: Merge additional services from service-specific compose file
    // Service-specific compose files may define additional services (e.g., ollama in query-analyzer.compose.yaml)
    // that are dependencies of the main service. These must be included in the merged file.
    this.mergeAdditionalServices(baseCompose, serviceCompose, serviceName);

    // Sprint 375: Merge top-level volumes from service override file
    this.mergeTopLevelVolumes(baseCompose, serviceCompose);

    // Convert back to YAML
    const mergedYaml = yaml.dump(baseCompose, {
      indent: 2,
      lineWidth: 120,
      noRefs: true, // Don't use YAML anchors/aliases
    });

    return {
      yaml: mergedYaml,
      parsed: baseCompose,
      stats,
    };
  }

  /**
   * Merge additional services from service-specific compose file into base compose.
   *
   * **Sprint 378:** Service-specific compose files may define additional services
   * that are dependencies of the main service. For example, query-analyzer.compose.yaml
   * defines both the query-analyzer service and an ollama service that query-analyzer
   * depends on. This method ensures those additional services are included in the
   * merged compose file to prevent "undefined service" errors.
   *
   * **Merge Rules:**
   * - Additional services (not matching serviceName) are copied from override to base
   * - Services already present in base are NOT overridden (base takes precedence)
   * - This preserves infrastructure-defined services while adding service-specific dependencies
   *
   * @param baseCompose - Base compose file to modify
   * @param serviceCompose - Service override file with potential additional services
   * @param serviceName - Name of the main service being merged (skip this one)
   */
  private mergeAdditionalServices(
    baseCompose: ComposeFile,
    serviceCompose: ComposeFile,
    serviceName: string
  ): void {
    // Iterate over all services in the service-specific compose file
    for (const [name, config] of Object.entries(serviceCompose.services)) {
      // Skip the main service (already merged above)
      if (name === serviceName) {
        continue;
      }

      // Only add if not already in base (base takes precedence)
      if (!baseCompose.services[name]) {
        baseCompose.services[name] = config;
      }
    }
  }

  /**
   * Merge top-level volumes from service override file into base compose file.
   *
   * **Sprint 375:** Service-specific compose files may reference named volumes
   * (e.g., `bitbrat-storage`) that are defined in the service file but not in
   * the base infrastructure file. This method ensures those volume definitions
   * are added to the base file to prevent Docker Compose errors.
   *
   * **Merge Rules:**
   * - Named volumes from override are added to base if not already present
   * - Existing base volumes are never modified (no override)
   * - External volumes are preserved as-is
   *
   * @param baseCompose - Base compose file to modify
   * @param serviceCompose - Service override file with potential volume definitions
   */
  private mergeTopLevelVolumes(baseCompose: ComposeFile, serviceCompose: ComposeFile): void {
    // Skip if service file has no top-level volumes
    if (!serviceCompose.volumes || typeof serviceCompose.volumes !== 'object') {
      return;
    }

    // Initialize volumes section in base if missing
    if (!baseCompose.volumes) {
      baseCompose.volumes = {};
    }

    // Merge volumes from service file into base
    const baseVolumes = baseCompose.volumes as Record<string, unknown>;
    const serviceVolumes = serviceCompose.volumes as Record<string, unknown>;

    for (const [volumeName, volumeConfig] of Object.entries(serviceVolumes)) {
      // Only add if not already in base (base takes precedence)
      if (!baseVolumes[volumeName]) {
        baseVolumes[volumeName] = volumeConfig;
      }
    }
  }

  /**
   * Merge two service definitions with precedence rules.
   *
   * @param base - Base service definition
   * @param override - Service-specific overrides
   * @param stats - Statistics object to update
   * @returns Merged service definition
   */
  private mergeServiceDefinitions(
    base: ComposeService,
    override: ComposeService,
    stats: { volumesAdded: number; environmentAdded: number; dependenciesAdded: number }
  ): ComposeService {
    const merged: ComposeService = { ...base };

    // Merge volumes (array append + deduplicate)
    if (override.volumes) {
      const baseVolumes = base.volumes || [];
      const overrideVolumes = override.volumes;
      const allVolumes = [...baseVolumes, ...overrideVolumes];

      // Deduplicate volumes
      merged.volumes = Array.from(new Set(allVolumes));
      stats.volumesAdded = merged.volumes.length - baseVolumes.length;
    }

    // Merge environment (object merge or array append)
    if (override.environment) {
      if (Array.isArray(override.environment) && Array.isArray(base.environment)) {
        // Both arrays: append and deduplicate
        const allEnv = [...(base.environment || []), ...override.environment];
        merged.environment = Array.from(new Set(allEnv));
        stats.environmentAdded = merged.environment.length - (base.environment?.length || 0);
      } else if (
        typeof override.environment === 'object' &&
        !Array.isArray(override.environment) &&
        typeof base.environment === 'object' &&
        !Array.isArray(base.environment)
      ) {
        // Both objects: merge with override precedence
        const baseEnv = base.environment as Record<string, string>;
        const overrideEnv = override.environment as Record<string, string>;
        merged.environment = { ...baseEnv, ...overrideEnv };
        stats.environmentAdded = Object.keys(overrideEnv).length;
      } else {
        // Type mismatch: override wins
        merged.environment = override.environment;
        stats.environmentAdded = Array.isArray(override.environment)
          ? override.environment.length
          : Object.keys(override.environment as Record<string, string>).length;
      }
    }

    // Merge depends_on (object merge or array append)
    if (override.depends_on) {
      if (typeof override.depends_on === 'object' && !Array.isArray(override.depends_on)) {
        // Object form: merge dependencies
        const baseDeps = (base.depends_on as Record<string, { condition?: string }>) || {};
        const overrideDeps = override.depends_on as Record<string, { condition?: string }>;
        merged.depends_on = { ...baseDeps, ...overrideDeps };
        stats.dependenciesAdded = Object.keys(overrideDeps).length;
      } else if (Array.isArray(override.depends_on)) {
        // Array form: append and deduplicate
        const baseDeps = (base.depends_on as string[]) || [];
        const overrideDeps = override.depends_on as string[];
        merged.depends_on = Array.from(new Set([...baseDeps, ...overrideDeps]));
        stats.dependenciesAdded = (merged.depends_on as string[]).length - baseDeps.length;
      }
    }

    // Merge networks (object merge with alias append)
    if (override.networks) {
      if (typeof override.networks === 'object' && !Array.isArray(override.networks)) {
        const baseNets = (base.networks as Record<string, { aliases?: string[] }>) || {};
        const overrideNets = override.networks as Record<string, { aliases?: string[] }>;

        merged.networks = { ...baseNets };
        for (const [netName, netConfig] of Object.entries(overrideNets)) {
          if (merged.networks[netName] && netConfig.aliases) {
            // Merge aliases
            const baseAliases = (merged.networks[netName] as { aliases?: string[] }).aliases || [];
            const overrideAliases = netConfig.aliases;
            (merged.networks[netName] as { aliases: string[] }).aliases =
              Array.from(new Set([...baseAliases, ...overrideAliases]));
          } else {
            merged.networks[netName] = netConfig;
          }
        }
      } else {
        // Array form: override wins
        merged.networks = override.networks;
      }
    }

    // For other fields, override completely replaces base
    const simpleOverrideFields = ['build', 'image', 'ports', 'healthcheck', 'command', 'entrypoint'];
    for (const field of simpleOverrideFields) {
      if (override[field] !== undefined) {
        merged[field] = override[field];
      }
    }

    return merged;
  }

  /**
   * Inject secureFiles volume mounts into a compose file.
   *
   * **Use Case:**
   * After merging service-specific overrides, inject volume mounts from
   * architecture.yaml secureFiles definitions.
   *
   * @param composeYaml - Compose YAML content (base or already-merged)
   * @param serviceName - Service to inject mounts into
   * @param volumeMounts - Array of volume mount strings (e.g., "/host/path:/container/path:ro")
   * @param envVars - Environment variables to set (e.g., { GOOGLE_APPLICATION_CREDENTIALS: "/var/secrets/gcp.json" })
   * @returns Updated YAML content with injected mounts
   * @throws Error if YAML parsing fails or service not found
   *
   * @example
   * ```typescript
   * const merger = new ComposeMerger();
   * const updatedYaml = merger.injectSecureFiles(
   *   composeYaml,
   *   'image-gen-mcp',
   *   ['/opt/secrets/gcp.json:/var/secrets/gcp.json:ro'],
   *   { GOOGLE_APPLICATION_CREDENTIALS: '/var/secrets/gcp.json' }
   * );
   * ```
   */
  injectSecureFiles(
    composeYaml: string,
    serviceName: string,
    volumeMounts: string[],
    envVars: Record<string, string> = {}
  ): string {
    // Parse YAML
    let compose: ComposeFile;
    try {
      compose = yaml.load(composeYaml) as ComposeFile;
    } catch (error: any) {
      throw new Error(`Failed to parse compose YAML for secureFiles injection: ${error.message}`);
    }

    // Validate service exists
    const service = compose.services[serviceName];
    if (!service) {
      throw new Error(
        `Service '${serviceName}' not found in compose file. ` +
        `Cannot inject secureFiles volume mounts.`
      );
    }

    // Inject volume mounts
    if (volumeMounts.length > 0) {
      const existingVolumes = service.volumes || [];

      // Append new mounts and deduplicate
      const allVolumes = [...existingVolumes, ...volumeMounts];
      service.volumes = Array.from(new Set(allVolumes));
    }

    // Inject environment variables
    if (Object.keys(envVars).length > 0) {
      if (Array.isArray(service.environment)) {
        // Array form: convert key-value pairs to "KEY=value" strings
        const envArray = service.environment as string[];
        for (const [key, value] of Object.entries(envVars)) {
          // Remove existing entry for this key (if any)
          const filtered = envArray.filter(entry => !entry.startsWith(`${key}=`));
          filtered.push(`${key}=${value}`);
          service.environment = filtered;
        }
      } else {
        // Object form: merge with override precedence
        const envObj = (service.environment || {}) as Record<string, string>;
        service.environment = { ...envObj, ...envVars };
      }
    }

    // Convert back to YAML
    return yaml.dump(compose, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });
  }

  /**
   * Generate volume mount strings from secureFiles definitions.
   *
   * **Format:** `{localPath}:{targetPath}:{mode}`
   *
   * @param secureFiles - SecureFile definitions from architecture.yaml
   * @param localPrefix - Prefix to add to local paths (e.g., "/opt/BitBratPlatform" for remote)
   * @returns Array of volume mount strings
   *
   * @example
   * ```typescript
   * const mounts = ComposeMerger.generateVolumeMounts(
   *   service.secureFiles,
   *   '/opt/BitBratPlatform'
   * );
   * // Returns: ['/opt/BitBratPlatform/.secure.staging/gcp.json:/var/secrets/gcp.json:ro']
   * ```
   */
  static generateVolumeMounts(
    secureFiles: SecureFile[],
    localPrefix: string = ''
  ): string[] {
    return secureFiles.map(file => {
      const localPath = localPrefix ? `${localPrefix}/${file.local}` : file.local;
      const mode = 'ro'; // Always read-only for security
      return `${localPath}:${file.target}:${mode}`;
    });
  }

  /**
   * Extract environment variables from secureFiles definitions.
   *
   * @param secureFiles - SecureFile definitions from architecture.yaml
   * @returns Map of environment variable names to target paths
   *
   * @example
   * ```typescript
   * const envVars = ComposeMerger.extractEnvVars(service.secureFiles);
   * // Returns: { GOOGLE_APPLICATION_CREDENTIALS: '/var/secrets/gcp.json' }
   * ```
   */
  static extractEnvVars(secureFiles: SecureFile[]): Record<string, string> {
    const envVars: Record<string, string> = {};

    for (const file of secureFiles) {
      if (file.env) {
        envVars[file.env] = file.target;
      }
    }

    return envVars;
  }
}
