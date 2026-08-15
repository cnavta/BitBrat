/**
 * Feature Flags for Gradual Rollout
 * Sprint 13: DX-013
 *
 * Provides feature flags for safe production deployment of the config-based
 * event registry and generic envelope builder. Flags default to false,
 * allowing gradual activation per environment.
 *
 * Usage:
 * ```typescript
 * import { getFeatureFlags, logFeatureFlagStatus } from './feature-flags';
 *
 * const flags = getFeatureFlags();
 * if (flags.ENABLE_CONFIG_REGISTRY) {
 *   // Use config-based registry
 * } else {
 *   // Fall back to code-based registry
 * }
 * ```
 *
 * Environment Variables:
 * - ENABLE_CONFIG_REGISTRY: Enable YAML-based event registry (default: false)
 * - ENABLE_GENERIC_BUILDER: Enable generic envelope builder (default: false)
 *
 * @since Sprint 13
 */

import { logger } from '../../../common/logging';

/**
 * Feature flags for ingress event processing
 */
export interface FeatureFlags {
  /**
   * Enable YAML-based config registry instead of code-based registry
   * @default false
   */
  ENABLE_CONFIG_REGISTRY: boolean;

  /**
   * Enable generic envelope builder instead of platform-specific builders
   * @default false
   */
  ENABLE_GENERIC_BUILDER: boolean;
}

/**
 * Parse boolean environment variable
 * Accepts: true, yes, 1, on (case-insensitive)
 */
function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'on';
}

/**
 * Get current feature flags from environment variables
 *
 * @returns Feature flags object
 *
 * @example
 * ```typescript
 * const flags = getFeatureFlags();
 * console.log(flags.ENABLE_CONFIG_REGISTRY); // false (default)
 * ```
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    ENABLE_CONFIG_REGISTRY: parseBooleanEnv(process.env.ENABLE_CONFIG_REGISTRY, false),
    ENABLE_GENERIC_BUILDER: parseBooleanEnv(process.env.ENABLE_GENERIC_BUILDER, false),
  };
}

/**
 * Log feature flag status for observability
 *
 * Should be called during service initialization to provide visibility
 * into which features are enabled.
 *
 * @param context - Optional context string (e.g., 'TranslationEngine', 'ingress-egress-service')
 *
 * @example
 * ```typescript
 * // In service initialization
 * logFeatureFlagStatus('TranslationEngine');
 * ```
 */
export function logFeatureFlagStatus(context?: string): void {
  const flags = getFeatureFlags();

  const logData: any = {
    ENABLE_CONFIG_REGISTRY: flags.ENABLE_CONFIG_REGISTRY,
    ENABLE_GENERIC_BUILDER: flags.ENABLE_GENERIC_BUILDER,
  };

  if (context) {
    logData.context = context;
  }

  logger.info('feature-flags.status', logData);
}

/**
 * Validate feature flag configuration
 *
 * Checks for invalid combinations or missing dependencies.
 * Currently, ENABLE_GENERIC_BUILDER requires ENABLE_CONFIG_REGISTRY
 * because the generic builder depends on config-based field mappings.
 *
 * @throws Error if configuration is invalid
 *
 * @example
 * ```typescript
 * try {
 *   validateFeatureFlags();
 * } catch (err) {
 *   logger.error('Invalid feature flag configuration', err);
 *   process.exit(1);
 * }
 * ```
 */
export function validateFeatureFlags(): void {
  const flags = getFeatureFlags();

  // Generic builder requires config registry
  if (flags.ENABLE_GENERIC_BUILDER && !flags.ENABLE_CONFIG_REGISTRY) {
    throw new Error(
      'Invalid feature flag configuration: ENABLE_GENERIC_BUILDER=true requires ENABLE_CONFIG_REGISTRY=true'
    );
  }
}

/**
 * Check if all new features are enabled
 *
 * Useful for determining if the service is running in "new mode"
 * vs "legacy mode".
 *
 * @returns true if all feature flags are enabled
 */
export function isFullyMigrated(): boolean {
  const flags = getFeatureFlags();
  return flags.ENABLE_CONFIG_REGISTRY && flags.ENABLE_GENERIC_BUILDER;
}

/**
 * Check if running in legacy mode (all flags disabled)
 *
 * @returns true if all feature flags are disabled
 */
export function isLegacyMode(): boolean {
  const flags = getFeatureFlags();
  return !flags.ENABLE_CONFIG_REGISTRY && !flags.ENABLE_GENERIC_BUILDER;
}
