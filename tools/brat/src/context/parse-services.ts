/**
 * Sprint 352: Parse architecture.yaml for Active Services
 *
 * Story S1.1: Extract active services with their required environment variables
 * and secrets to enable auto-generation of service-specific YAML configs.
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

/**
 * Service metadata extracted from architecture.yaml
 */
export interface ServiceMetadata {
  /** Service name (key in services object) */
  name: string;
  /** Is service active (deployable)? */
  active: boolean;
  /** Service description */
  description?: string;
  /** Service category (platform, domain) */
  category: 'platform' | 'domain';
  /** Capability profile (core, gateway, llm, mcp-server) */
  profile: 'core' | 'gateway' | 'llm' | 'mcp-server';
  /** Service kind (pipeline-service, gateway, mcp-server) */
  kind: string;
  /** Entry point path */
  entry: string;
  /** Required environment variables (from architecture.yaml) */
  envKeys: string[];
  /** Required secrets (from architecture.yaml) */
  secrets: string[];
  /** External services this service depends on */
  external?: string[];
  /** Scaling configuration */
  scaling?: {
    min: number;
    max: number;
  };
}

/**
 * Parse architecture.yaml and extract service metadata
 *
 * @param repoRoot - Repository root directory
 * @returns Map of service name → metadata
 */
export function parseActiveServices(repoRoot: string): Map<string, ServiceMetadata> {
  const archPath = path.join(repoRoot, 'architecture.yaml');

  if (!fs.existsSync(archPath)) {
    throw new Error(`architecture.yaml not found at ${archPath}`);
  }

  const content = fs.readFileSync(archPath, 'utf8');
  const arch = yaml.load(content) as any;

  if (!arch.services || typeof arch.services !== 'object') {
    throw new Error('architecture.yaml missing services section');
  }

  const services = new Map<string, ServiceMetadata>();

  for (const [name, svc] of Object.entries<any>(arch.services)) {
    // Only include active services
    if (svc.active !== true) {
      continue;
    }

    const metadata: ServiceMetadata = {
      name,
      active: svc.active,
      description: svc.description,
      category: svc.category || 'domain',
      profile: svc.profile || 'core',
      kind: svc.kind || 'pipeline-service',
      entry: svc.entry || `src/apps/${name}-service.ts`,
      envKeys: Array.isArray(svc.env) ? svc.env : [],
      secrets: Array.isArray(svc.secrets) ? svc.secrets : [],
      external: Array.isArray(svc.external) ? svc.external : undefined,
      scaling: svc.scaling ? {
        min: svc.scaling.min ?? 1,
        max: svc.scaling.max ?? 1,
      } : undefined,
    };

    services.set(name, metadata);
  }

  return services;
}

/**
 * Get all active services as an array
 *
 * @param repoRoot - Repository root directory
 * @returns Array of service metadata
 */
export function getActiveServicesArray(repoRoot: string): ServiceMetadata[] {
  const servicesMap = parseActiveServices(repoRoot);
  return Array.from(servicesMap.values());
}

/**
 * Get a specific service's metadata
 *
 * @param repoRoot - Repository root directory
 * @param serviceName - Name of the service
 * @returns Service metadata or undefined if not found/inactive
 */
export function getServiceMetadata(repoRoot: string, serviceName: string): ServiceMetadata | undefined {
  const servicesMap = parseActiveServices(repoRoot);
  return servicesMap.get(serviceName);
}

/**
 * Get all required environment variables across all active services
 *
 * @param repoRoot - Repository root directory
 * @returns Set of all required env var names
 */
export function getAllRequiredEnvVars(repoRoot: string): Set<string> {
  const services = getActiveServicesArray(repoRoot);
  const envVars = new Set<string>();

  for (const svc of services) {
    for (const envKey of svc.envKeys) {
      envVars.add(envKey);
    }
  }

  return envVars;
}

/**
 * Get all required secrets across all active services
 *
 * @param repoRoot - Repository root directory
 * @returns Set of all required secret names
 */
export function getAllRequiredSecrets(repoRoot: string): Set<string> {
  const services = getActiveServicesArray(repoRoot);
  const secrets = new Set<string>();

  for (const svc of services) {
    for (const secret of svc.secrets) {
      secrets.add(secret);
    }
  }

  return secrets;
}

/**
 * Log discovered services (for verification)
 *
 * @param repoRoot - Repository root directory
 */
export function logDiscoveredServices(repoRoot: string): void {
  const services = getActiveServicesArray(repoRoot);

  console.log(`\nDiscovered ${services.length} active services:\n`);

  for (const svc of services) {
    console.log(`  ${svc.name}:`);
    console.log(`    Category: ${svc.category}`);
    console.log(`    Profile: ${svc.profile}`);
    console.log(`    Kind: ${svc.kind}`);
    console.log(`    Env vars: ${svc.envKeys.length}`);
    console.log(`    Secrets: ${svc.secrets.length}`);
    if (svc.external && svc.external.length > 0) {
      console.log(`    External: ${svc.external.join(', ')}`);
    }
    console.log();
  }
}
