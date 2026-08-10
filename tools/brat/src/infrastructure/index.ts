/**
 * Infrastructure Module - Platform-agnostic infrastructure management
 *
 * This module provides the core abstractions for managing infrastructure
 * declarations in architecture.yaml v2. It replaces fragmented hardcoded
 * infrastructure lists across the codebase with a unified registry-based approach.
 *
 * @module infrastructure
 */

// Export all types
export type {
  HealthCheck,
  VolumeConfig,
  InfrastructureSpec,
  PlatformCapability,
  ProviderConfig,
  ProviderConstraints,
  ProviderImplementation,
  Provider,
  ValidationResult,
  ServiceMetadata,
  ArchitectureYaml,
} from './types';

// Export InfrastructureRegistry
export { InfrastructureRegistry } from './registry';

// Export HealthGate
export { HealthGate, type Logger, type WaitOptions } from './health-gate';
