/**
 * Sprint 5 I3.1: Parse Service Dependencies (Architecture.yaml v2)
 *
 * Extracts service dependencies from architecture.yaml using the v2 schema.
 * Infrastructure dependencies are read from services.*.dependencies.infrastructure
 * and resolved via InfrastructureRegistry instead of hardcoded lists.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ServiceMetadata } from './parse-services';
import { InfrastructureRegistry } from '../infrastructure/registry';

/**
 * Service dependency information
 */
export interface ServiceDependencies {
  /** Service name */
  name: string;
  /** Infrastructure dependencies (postgres, nats, firestore, redis, etc.) */
  infrastructure: string[];
  /** Other BitBrat services this service depends on */
  services: string[];
  /** Network aliases for service discovery */
  networkAliases: string[];
  /** Health check configuration if available */
  healthCheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

/**
 * Parse service dependencies from architecture.yaml and service metadata
 *
 * Uses architecture.yaml v2 schema to read dependencies.infrastructure
 * from service configuration instead of hardcoded lists.
 *
 * @param repoRoot - Repository root directory
 * @param metadata - Service metadata from parse-services
 * @param context - Execution context (default: 'local')
 * @returns Service dependency information
 */
export function parseServiceDependencies(
  repoRoot: string,
  metadata: ServiceMetadata,
  context: string = 'local'
): ServiceDependencies {
  const archPath = path.join(repoRoot, 'architecture.yaml');
  const archContent = fs.readFileSync(archPath, 'utf-8');
  const arch = yaml.parse(archContent);

  const serviceName = metadata.name;
  const serviceConfig = arch.services?.[serviceName] || {};

  // Infrastructure dependencies from architecture.yaml v2
  const infrastructure: string[] = [];

  // Read from services.<name>.dependencies.infrastructure (added in S2.8)
  const infraCapabilities = serviceConfig.dependencies?.infrastructure || [];

  // Resolve each capability to actual service name using InfrastructureRegistry
  for (const capability of infraCapabilities) {
    try {
      const spec = InfrastructureRegistry.getInfrastructureByCapability(
        repoRoot,
        context,
        capability
      );
      if (spec && spec.serviceName) {
        infrastructure.push(spec.serviceName);
      } else {
        // Fall back to capability name if serviceName not available
        infrastructure.push(capability);
      }
    } catch (error) {
      // Fall back to capability name if resolution fails (backward compatibility)
      console.warn(`[parse-dependencies] Failed to resolve capability '${capability}' for service '${serviceName}': ${error instanceof Error ? error.message : String(error)}`);
      infrastructure.push(capability);
    }
  }

  // Service-to-service dependencies
  const services: string[] = [];

  // Gateway services typically depend on auth (except event-router which doesn't need it)
  if (metadata.profile === 'gateway' && serviceName !== 'auth' && serviceName !== 'event-router') {
    services.push('auth');
  }

  // Services that consume events depend on event-router (except auth which doesn't need it)
  if (serviceConfig.topics?.consumes?.length > 0 && serviceName !== 'event-router' && serviceName !== 'auth') {
    services.push('event-router');
  }

  // Services that use MCP tools depend on tool-gateway
  if (metadata.profile === 'llm' && serviceName !== 'tool-gateway') {
    services.push('tool-gateway');
  }

  // Network aliases for service discovery
  const networkAliases = [`${serviceName}.bitbrat.local`];

  // Health check configuration
  const healthCheck = {
    test: ['CMD', 'curl', '-sf', 'http://localhost:3000/healthz'],
    interval: '5s',
    timeout: '3s',
    retries: 10,
  };

  return {
    name: serviceName,
    infrastructure,
    services,
    networkAliases,
    healthCheck,
  };
}

/**
 * Get all infrastructure services needed for a context
 *
 * Uses InfrastructureRegistry.getRequiredInfrastructure() to collect
 * all infrastructure needed by active services from architecture.yaml v2.
 *
 * @param repoRoot - Repository root directory
 * @param activeServices - Array of active service metadata
 * @param context - Execution context (default: 'local')
 * @returns Set of required infrastructure service names
 */
export function getRequiredInfrastructure(
  repoRoot: string,
  activeServices: ServiceMetadata[],
  context: string = 'local'
): Set<string> {
  // Use InfrastructureRegistry to get required infrastructure from architecture.yaml
  const serviceMetadata = activeServices.map(svc => ({
    name: svc.name,
    active: true,
    dependencies: undefined, // Will be read from architecture.yaml by registry
  }));

  try {
    const specs = InfrastructureRegistry.getRequiredInfrastructure(
      repoRoot,
      context,
      serviceMetadata
    );

    // Return set of service names (filter out specs without serviceName)
    return new Set(
      specs
        .filter(spec => spec.serviceName)
        .map(spec => spec.serviceName!)
    );
  } catch (error) {
    console.warn(`[parse-dependencies] Failed to get required infrastructure from registry: ${error instanceof Error ? error.message : String(error)}`);
    // Fall back to empty set - callers should handle this gracefully
    return new Set<string>();
  }
}

/**
 * Get dependency graph for all active services
 *
 * @param repoRoot - Repository root directory
 * @param activeServices - Array of active service metadata
 * @returns Map of service name to dependencies
 */
export function getDependencyGraph(
  repoRoot: string,
  activeServices: ServiceMetadata[]
): Map<string, ServiceDependencies> {
  const graph = new Map<string, ServiceDependencies>();

  for (const metadata of activeServices) {
    const deps = parseServiceDependencies(repoRoot, metadata);
    graph.set(metadata.name, deps);
  }

  return graph;
}

/**
 * Validate that all service dependencies can be satisfied
 *
 * @param graph - Dependency graph from getDependencyGraph
 * @param activeServiceNames - Set of active service names
 * @returns Array of validation errors (empty if valid)
 */
export function validateDependencies(
  graph: Map<string, ServiceDependencies>,
  activeServiceNames: Set<string>
): string[] {
  const errors: string[] = [];

  for (const [serviceName, deps] of graph.entries()) {
    // Check that all service dependencies are active
    for (const depService of deps.services) {
      if (!activeServiceNames.has(depService)) {
        errors.push(
          `Service '${serviceName}' depends on '${depService}' but it is not active`
        );
      }
    }
  }

  return errors;
}
