/**
 * Sprint 352 S2.1: Parse Service Dependencies
 *
 * Extracts service dependencies from architecture.yaml and determines
 * infrastructure dependencies (postgres, nats, firestore) based on
 * service configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ServiceMetadata } from './parse-services';

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
 * @param repoRoot - Repository root directory
 * @param metadata - Service metadata from parse-services
 * @returns Service dependency information
 */
export function parseServiceDependencies(
  repoRoot: string,
  metadata: ServiceMetadata
): ServiceDependencies {
  const archPath = path.join(repoRoot, 'architecture.yaml');
  const archContent = fs.readFileSync(archPath, 'utf-8');
  const arch = yaml.parse(archContent);

  const serviceName = metadata.name;
  const serviceConfig = arch.services?.[serviceName] || {};

  // Infrastructure dependencies
  const infrastructure: string[] = [];

  // All services need NATS for messaging
  infrastructure.push('nats');

  // Check for persistence driver
  const persistenceDriver = getPersistenceDriver(serviceConfig, metadata);
  if (persistenceDriver === 'postgres') {
    infrastructure.push('postgres');
  } else if (persistenceDriver === 'firestore') {
    infrastructure.push('firebase-emulator');
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
 * Determine persistence driver for a service
 *
 * @param serviceConfig - Service configuration from architecture.yaml
 * @param metadata - Service metadata
 * @returns Persistence driver ('postgres', 'firestore', or 'none')
 */
function getPersistenceDriver(
  serviceConfig: any,
  metadata: ServiceMetadata
): 'postgres' | 'firestore' | 'none' {
  // Check if service explicitly declares persistence needs
  if (metadata.envKeys.includes('PERSISTENCE_DRIVER')) {
    return 'postgres'; // Default to postgres as per Sprint 344
  }

  // Services that publish to persistence topics need persistence
  const publishesTopics = serviceConfig.topics?.publishes || [];
  if (publishesTopics.some((t: string) => t.includes('persistence'))) {
    return 'postgres';
  }

  // Services with stateful: true need persistence
  if (serviceConfig.stateful === true) {
    return 'postgres';
  }

  // Otherwise no persistence needed
  return 'none';
}

/**
 * Get all infrastructure services needed for a context
 *
 * @param repoRoot - Repository root directory
 * @param activeServices - Array of active service metadata
 * @returns Set of required infrastructure service names
 */
export function getRequiredInfrastructure(
  repoRoot: string,
  activeServices: ServiceMetadata[]
): Set<string> {
  const infrastructure = new Set<string>();

  // Always need nats for messaging
  infrastructure.add('nats');

  // Check if any service needs postgres
  const needsPostgres = activeServices.some(metadata => {
    const deps = parseServiceDependencies(repoRoot, metadata);
    return deps.infrastructure.includes('postgres');
  });

  if (needsPostgres) {
    infrastructure.add('postgres');
  }

  // Check if any service needs firestore (legacy support)
  const needsFirestore = activeServices.some(metadata => {
    const deps = parseServiceDependencies(repoRoot, metadata);
    return deps.infrastructure.includes('firebase-emulator');
  });

  if (needsFirestore) {
    infrastructure.add('firebase-emulator');
  }

  // Add nats-box for debugging
  infrastructure.add('nats-box');

  return infrastructure;
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
