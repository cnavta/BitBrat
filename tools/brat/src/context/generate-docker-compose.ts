/**
 * Sprint 5 I3.3: Generate Docker Compose from Architecture.yaml v2
 *
 * Dynamically generates Docker Compose configuration from architecture.yaml
 * infrastructure specifications instead of hardcoded service definitions.
 *
 * Generates service-specific Docker Compose fragments for active services
 * and merges them into a context-specific docker-compose file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ServiceMetadata } from './parse-services';
import { ServiceDependencies, parseServiceDependencies } from './parse-dependencies';
import { InfrastructureRegistry } from '../infrastructure/registry';
import { loadArchitecture } from '../config/loader';

/**
 * Docker Compose service definition
 */
export interface ComposeServiceDef {
  env_file?: string[];
  build?: {
    context: string;
    dockerfile: string;
    args?: Record<string, string>;
  };
  image?: string;
  environment?: Record<string, string>;
  ports?: string[];
  depends_on?: string[] | Record<string, { condition: string }>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
  networks?: Record<string, { aliases?: string[] }>;
  command?: string[];
  volumes?: string[];
  user?: string;
  profiles?: string[];
  entrypoint?: string[];
}

/**
 * Full Docker Compose configuration
 */
export interface ComposeConfig {
  services: Record<string, ComposeServiceDef>;
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
}

/**
 * Generate Docker Compose service definition for a BitBrat service
 *
 * @param metadata - Service metadata
 * @param dependencies - Service dependencies
 * @param contextName - Context name
 * @returns Docker Compose service definition
 */
export function generateServiceCompose(
  metadata: ServiceMetadata,
  dependencies: ServiceDependencies,
  contextName: string
): ComposeServiceDef {
  const serviceName = metadata.name;

  // Build args from architecture.yaml metadata
  const buildArgs: Record<string, string> = {
    SERVICE_NAME: serviceName,
    SERVICE_ENTRY: metadata.entry.replace('src/', 'dist/').replace('.ts', '.js'),
    SERVICE_PORT: '3000', // Default port from architecture.yaml defaults
  };

  // Environment variables - reference context-specific env files
  const environment: Record<string, string> = {};

  // Add all env vars from metadata
  for (const envKey of metadata.envKeys) {
    environment[envKey] = `\${${envKey}}`;
  }

  // Add all secrets from metadata
  for (const secretKey of metadata.secrets) {
    environment[secretKey] = `\${${secretKey}}`;
  }

  // Port mapping (host:container)
  const hostPort = getHostPort(serviceName);
  const ports = [`\${${serviceName.toUpperCase().replace(/-/g, '_')}_HOST_PORT:-${hostPort}}:\${SERVICE_PORT:-3000}`];

  // depends_on with health check conditions
  const dependsOn: Record<string, { condition: string }> = {};

  for (const infra of dependencies.infrastructure) {
    dependsOn[infra] = { condition: 'service_healthy' };
  }

  for (const service of dependencies.services) {
    dependsOn[service] = { condition: 'service_started' }; // Services don't always have health checks
  }

  const serviceDef: ComposeServiceDef = {
    env_file: ['.env.brat'],
    build: {
      // Sprint 3: Use ../.. as build context because generated compose files are in infrastructure/docker-compose/
      // and need to reference Dockerfile.service at repo root. The orchestrator runs docker compose from remoteDir
      // without --project-directory for remote deployments, so paths are relative to the compose file location.
      context: '../..',
      dockerfile: 'Dockerfile.service',
      args: buildArgs,
    },
    environment,
    ports,
    depends_on: dependsOn,
    healthcheck: dependencies.healthCheck,
    networks: {
      'bitbrat-network': {
        aliases: dependencies.networkAliases,
      },
    },
  };

  return serviceDef;
}

/**
 * Get host port for a service (incremental from base 3001)
 *
 * @param serviceName - Service name
 * @returns Host port number
 */
function getHostPort(serviceName: string): number {
  // Standard port mappings
  const portMap: Record<string, number> = {
    'ingress-egress': 3001,
    'event-router': 3002,
    'llm-bot': 3003,
    'query-analyzer': 3004,
    'disposition-service': 3005,
    'reflex': 3006,
    'auth': 3007,
    'tool-gateway': 3008,
    'api-gateway': 3009,
    'context-pack': 3010,
    'persistence': 3011,
    'scheduler': 3012,
    'oauth-flow': 3013,
    'state-engine': 3014,
    'obs-mcp': 3015,
    'image-gen-mcp': 3016,
    'story-engine-mcp': 3017,
    'dev-mcp': 3018,
  };

  return portMap[serviceName] || 3100; // Default fallback
}

/**
 * Generate infrastructure Docker Compose services from architecture.yaml v2
 * Sprint 5 I3.3: Dynamically generates from infrastructure.{provider} specifications
 *
 * @param repoRoot - Repository root directory
 * @param infrastructure - Set of required infrastructure services
 * @param contextName - Execution context name (for applying overrides)
 * @returns Docker Compose services for infrastructure
 */
export function generateInfrastructureCompose(
  repoRoot: string,
  infrastructure: Set<string>,
  contextName: string = 'local'
): Record<string, ComposeServiceDef> {
  const services: Record<string, ComposeServiceDef> = {};

  // Sprint 3: Always include bitbrat-base service (required for building application services)
  // The bitbrat-base service has profiles: [build-only] and is used as the base image
  // for all BitBrat application services (via BASE_IMAGE build arg in Dockerfile.service).
  // This service is defined in docker-compose.local.yaml and is not part of infrastructure specs.
  const baseComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/docker-compose.local.yaml'
  );
  if (fs.existsSync(baseComposePath)) {
    const baseComposeContent = fs.readFileSync(baseComposePath, 'utf-8');
    const baseCompose = yaml.parse(baseComposeContent) as ComposeConfig;
    if (baseCompose.services['bitbrat-base']) {
      services['bitbrat-base'] = baseCompose.services['bitbrat-base'];
    }
  }

  // Get infrastructure specs from architecture.yaml v2
  try {
    const allSpecs = InfrastructureRegistry.getAllInfrastructureSpecs(repoRoot, contextName);

    // For each required infrastructure service, find its spec and convert to ComposeServiceDef
    for (const infraName of infrastructure) {
      const spec = allSpecs.find(s => s.serviceName === infraName);
      if (!spec) {
        console.warn(`[generate-docker-compose] No infrastructure spec found for '${infraName}'`);
        continue;
      }

      // Convert InfrastructureSpec to ComposeServiceDef
      const composeDef: ComposeServiceDef = {
        image: spec.image,
        environment: spec.env || {},
        healthcheck: spec.healthCheck ? {
          test: spec.healthCheck.test,
          interval: spec.healthCheck.interval || '5s',
          timeout: spec.healthCheck.timeout || '3s',
          retries: spec.healthCheck.retries || 10,
        } : undefined,
        networks: {
          'bitbrat-network': {},
        },
      };

      // Add ports if defined
      if (spec.ports && Object.keys(spec.ports).length > 0) {
        composeDef.ports = Object.values(spec.ports);
      }

      // Add volumes if defined (convert VolumeConfig[] to string[])
      if (spec.volumes && spec.volumes.length > 0) {
        composeDef.volumes = spec.volumes.map(vol => {
          // Sprint 25: Support both 'mount' and 'target' (architecture.yaml uses 'target')
          const mountPath = (vol as any).target || vol.mount;

          if (vol.name) {
            // Named volume: "volume-name:/mount/path[:ro]"
            return `${vol.name}:${mountPath}${vol.readOnly ? ':ro' : ''}`;
          } else if (vol.source) {
            // Bind mount: "source:/mount/path[:ro]"
            return `${vol.source}:${mountPath}${vol.readOnly ? ':ro' : ''}`;
          } else {
            // Fallback: just the mount path (anonymous volume)
            return mountPath;
          }
        });
      }

      services[infraName] = composeDef;
    }
  } catch (error) {
    console.error(`[generate-docker-compose] Failed to load infrastructure specs: ${error instanceof Error ? error.message : String(error)}`);
    // Fall back to empty services - caller should handle this
  }

  return services;
}

/**
 * Generate complete Docker Compose configuration for a context
 *
 * @param options - Generation options
 * @returns Complete Docker Compose configuration
 */
export interface GenerateComposeOptions {
  repoRoot: string;
  contextName: string;
  activeServices: ServiceMetadata[];
  infrastructure: Set<string>;
}

export function generateDockerCompose(options: GenerateComposeOptions): ComposeConfig {
  const { repoRoot, contextName, activeServices, infrastructure } = options;

  const config: ComposeConfig = {
    services: {},
    networks: {
      'bitbrat-network': {
        driver: 'bridge',
        name: `bitbrat-${contextName}-network`,
      },
    },
    volumes: {},
  };

  // Add infrastructure services (Sprint 5: now uses architecture.yaml v2)
  const infraServices = generateInfrastructureCompose(repoRoot, infrastructure, contextName);
  Object.assign(config.services, infraServices);

  // Add volumes for infrastructure (Sprint 5: dynamically extracted from infrastructure specs)
  const volumeNames = extractVolumeNames(infraServices);
  for (const volumeName of volumeNames) {
    config.volumes![volumeName] = {};
  }

  // Add application services
  for (const metadata of activeServices) {
    const dependencies = parseServiceDependencies(repoRoot, metadata);
    const serviceDef = generateServiceCompose(metadata, dependencies, contextName);
    config.services[metadata.name] = serviceDef;
  }

  return config;
}

/**
 * Extract volume names from infrastructure service definitions
 * Sprint 5 I3.3: Dynamically discovers volumes instead of hardcoded list
 *
 * @param infraServices - Infrastructure service definitions
 * @returns Set of volume names
 */
function extractVolumeNames(infraServices: Record<string, ComposeServiceDef>): Set<string> {
  const volumes = new Set<string>();

  for (const [serviceName, serviceDef] of Object.entries(infraServices)) {
    if (!serviceDef.volumes) continue;

    for (const volumeMount of serviceDef.volumes) {
      // Volume mounts are in format "volume-name:/container/path"
      // Extract the volume name (part before the colon)
      const parts = volumeMount.split(':');
      if (parts.length >= 2) {
        const volumeName = parts[0];
        // Only add named volumes (not bind mounts which start with ./ or /)
        if (!volumeName.startsWith('./') && !volumeName.startsWith('/')) {
          volumes.add(volumeName);
        }
      }
    }
  }

  return volumes;
}

/**
 * Write Docker Compose configuration to file
 *
 * @param config - Docker Compose configuration
 * @param outputPath - Output file path
 */
export function writeDockerCompose(config: ComposeConfig, outputPath: string): void {
  const content = yaml.stringify(config, {
    indent: 2,
    lineWidth: 100,
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
  });

  const header = `# Generated Docker Compose configuration
# DO NOT EDIT MANUALLY - regenerate with 'brat context create'
# Generated: ${new Date().toISOString()}

`;

  fs.writeFileSync(outputPath, header + content, 'utf-8');
  console.log(`✅ Wrote Docker Compose configuration to ${outputPath}`);
}

/**
 * Generate and write Docker Compose file for a context
 *
 * @param options - Generation options
 * @returns Path to generated file
 */
export function generateAndWriteDockerCompose(
  options: GenerateComposeOptions
): string {
  const { repoRoot, contextName } = options;

  const config = generateDockerCompose(options);

  const outputPath = path.join(
    repoRoot,
    'infrastructure/docker-compose',
    `docker-compose.${contextName}.yaml`
  );

  writeDockerCompose(config, outputPath);

  return outputPath;
}
