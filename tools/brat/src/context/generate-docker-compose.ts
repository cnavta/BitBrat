/**
 * Sprint 352 S2.2: Generate Docker Compose Fragments
 *
 * Generates service-specific Docker Compose fragments for active services
 * and merges them into a context-specific docker-compose file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ServiceMetadata } from './parse-services';
import { ServiceDependencies, parseServiceDependencies } from './parse-dependencies';

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
      context: '.',
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
 * Generate infrastructure Docker Compose services (postgres, nats, etc.)
 *
 * @param repoRoot - Repository root directory
 * @param infrastructure - Set of required infrastructure services
 * @returns Docker Compose services for infrastructure
 */
export function generateInfrastructureCompose(
  repoRoot: string,
  infrastructure: Set<string>
): Record<string, ComposeServiceDef> {
  const services: Record<string, ComposeServiceDef> = {};

  // Read base docker-compose.local.yaml for infrastructure definitions
  const baseComposePath = path.join(
    repoRoot,
    'infrastructure/docker-compose/docker-compose.local.yaml'
  );
  const baseComposeContent = fs.readFileSync(baseComposePath, 'utf-8');
  const baseCompose = yaml.parse(baseComposeContent) as ComposeConfig;

  // Extract infrastructure services
  for (const infraName of infrastructure) {
    if (baseCompose.services[infraName]) {
      services[infraName] = baseCompose.services[infraName];
    }
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

  // Add infrastructure services
  const infraServices = generateInfrastructureCompose(repoRoot, infrastructure);
  Object.assign(config.services, infraServices);

  // Add volumes for infrastructure
  if (infrastructure.has('postgres')) {
    config.volumes!['postgres-data'] = {};
  }
  if (infrastructure.has('nats')) {
    config.volumes!['nats-data'] = {};
  }
  if (infrastructure.has('firebase-emulator')) {
    config.volumes!['firebase-data'] = {};
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
