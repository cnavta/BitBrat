/**
 * Sprint 352: Context-Aware Configuration Profiles
 *
 * Story S1.4: Apply context-specific adjustments to service configurations
 * based on deployment type and context name patterns.
 */

/**
 * Context profile type
 */
export type ContextProfile = 'dev' | 'staging' | 'prod';

/**
 * Context-specific configuration adjustments
 */
export interface ContextAdjustments {
  /** Log level appropriate for context */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';

  /** Enable external integrations by default? */
  enableExternalIntegrations: boolean;

  /** Enable feature flags by default? */
  enableFeatureFlags: boolean;

  /** Timeout values (milliseconds) */
  timeouts: {
    default: number;
    llm: number;
    http: number;
  };

  /** Retry configuration */
  retries: {
    default: number;
    llm: number;
  };

  /** Memory/cache limits */
  limits: {
    memoryMaxKeys: number;
    memoryMaxMessages: number;
    memoryMaxChars: number;
    memoryTtlMs: number;
  };

  /** Security settings */
  security: {
    /** Require explicit secrets (no placeholders in prod) */
    requireExplicitSecrets: boolean;
    /** Enable debug endpoints */
    enableDebugEndpoints: boolean;
  };
}

/**
 * Determine context profile from context name and type
 *
 * @param contextName - Context name (e.g., 'local', 'agent-dev', 'staging', 'prod')
 * @param contextType - Deployment type
 * @returns Context profile
 */
export function determineContextProfile(
  contextName: string,
  contextType: 'docker-compose' | 'cloud-run' | 'k8s'
): ContextProfile {
  const name = contextName.toLowerCase();

  // Production contexts (check first, most specific)
  if (name === 'prod' || name === 'production' || name.includes('production')) {
    return 'prod';
  }

  // Staging contexts (check before dev patterns that might match)
  if (name === 'staging' || name === 'stage' || name.includes('staging') || name.includes('stg')) {
    return 'staging';
  }

  // Development contexts (local, agent-dev, dev, test, etc.)
  if (
    name === 'local' ||
    name === 'dev' ||
    name.includes('agent-') ||
    name.includes('-dev') ||
    name.includes('test')
  ) {
    return 'dev';
  }

  // Default based on deployment type
  if (contextType === 'docker-compose') {
    return 'dev';
  } else if (contextType === 'cloud-run' || contextType === 'k8s') {
    return 'staging'; // Assume cloud deployments are at least staging
  }

  return 'dev';
}

/**
 * Get context-specific adjustments
 *
 * @param profile - Context profile
 * @returns Configuration adjustments
 */
export function getContextAdjustments(profile: ContextProfile): ContextAdjustments {
  switch (profile) {
    case 'dev':
      return {
        logLevel: 'debug',
        enableExternalIntegrations: false,
        enableFeatureFlags: true,
        timeouts: {
          default: 30000,
          llm: 300000, // 5 minutes for dev/testing
          http: 30000,
        },
        retries: {
          default: 2,
          llm: 2,
        },
        limits: {
          memoryMaxKeys: 1000,
          memoryMaxMessages: 32,
          memoryMaxChars: 16000,
          memoryTtlMs: 3600000, // 1 hour
        },
        security: {
          requireExplicitSecrets: false, // Allow placeholders
          enableDebugEndpoints: true,
        },
      };

    case 'staging':
      return {
        logLevel: 'info',
        enableExternalIntegrations: true,
        enableFeatureFlags: true,
        timeouts: {
          default: 30000,
          llm: 180000, // 3 minutes
          http: 30000,
        },
        retries: {
          default: 3,
          llm: 3,
        },
        limits: {
          memoryMaxKeys: 5000,
          memoryMaxMessages: 64,
          memoryMaxChars: 32000,
          memoryTtlMs: 7200000, // 2 hours
        },
        security: {
          requireExplicitSecrets: true,
          enableDebugEndpoints: false,
        },
      };

    case 'prod':
      return {
        logLevel: 'info',
        enableExternalIntegrations: true,
        enableFeatureFlags: false, // Conservative in prod
        timeouts: {
          default: 30000,
          llm: 120000, // 2 minutes (stricter)
          http: 30000,
        },
        retries: {
          default: 3,
          llm: 3,
        },
        limits: {
          memoryMaxKeys: 10000,
          memoryMaxMessages: 128,
          memoryMaxChars: 64000,
          memoryTtlMs: 14400000, // 4 hours
        },
        security: {
          requireExplicitSecrets: true,
          enableDebugEndpoints: false,
        },
      };
  }
}

/**
 * Apply context-specific adjustments to a config object
 *
 * @param config - Configuration object to modify
 * @param profile - Context profile
 * @param serviceName - Service name (for service-specific adjustments)
 */
export function applyContextAdjustments(
  config: Record<string, any>,
  profile: ContextProfile,
  serviceName: string
): void {
  const adjustments = getContextAdjustments(profile);

  // Apply log level if not explicitly set
  if (config.LOG_LEVEL === undefined) {
    config.LOG_LEVEL = adjustments.logLevel;
  }

  // Apply timeout defaults
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.includes('${') && value.includes('TIMEOUT')) {
      // Replace placeholder timeouts with actual values
      if (key.includes('LLM') || key.includes('OPENAI')) {
        config[key] = adjustments.timeouts.llm;
      } else if (key.includes('HTTP')) {
        config[key] = adjustments.timeouts.http;
      } else {
        config[key] = adjustments.timeouts.default;
      }
    }
  }

  // Apply retry defaults
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.includes('${') && key.includes('RETRIES')) {
      if (key.includes('LLM') || key.includes('OPENAI')) {
        config[key] = adjustments.retries.llm;
      } else {
        config[key] = adjustments.retries.default;
      }
    }
  }

  // Apply memory/cache limits for LLM services
  if (serviceName === 'llm-bot' || serviceName.includes('llm')) {
    if (config.LLM_BOT_INSTANCE_MEM_MAX_KEYS === undefined) {
      config.LLM_BOT_INSTANCE_MEM_MAX_KEYS = adjustments.limits.memoryMaxKeys;
    }
    if (config.LLM_BOT_INSTANCE_MEM_MAX_MSGS === undefined) {
      config.LLM_BOT_INSTANCE_MEM_MAX_MSGS = adjustments.limits.memoryMaxMessages;
    }
    if (config.LLM_BOT_INSTANCE_MEM_MAX_CHARS === undefined) {
      config.LLM_BOT_INSTANCE_MEM_MAX_CHARS = adjustments.limits.memoryMaxChars;
    }
    if (config.LLM_BOT_INSTANCE_MEM_TTL_MS === undefined) {
      config.LLM_BOT_INSTANCE_MEM_TTL_MS = adjustments.limits.memoryTtlMs;
    }
  }

  // Apply external integration flags
  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith('_ENABLED') && typeof value === 'boolean') {
      // Only override if it's a default false (dev context)
      if (value === false && adjustments.enableExternalIntegrations) {
        config[key] = true;
      }
    }
  }

  // Apply feature flag defaults
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('FF_') || key.includes('_FF_')) {
      if (value === undefined || (typeof value === 'string' && value.includes('${'))) {
        config[key] = adjustments.enableFeatureFlags;
      }
    }
  }
}

/**
 * Get a human-readable summary of context adjustments
 *
 * @param profile - Context profile
 * @returns Summary string
 */
export function getContextAdjustmentsSummary(profile: ContextProfile): string {
  const adj = getContextAdjustments(profile);

  return `Context Profile: ${profile.toUpperCase()}
  Log Level: ${adj.logLevel}
  External Integrations: ${adj.enableExternalIntegrations ? 'enabled' : 'disabled'}
  Feature Flags: ${adj.enableFeatureFlags ? 'enabled' : 'disabled'}
  LLM Timeout: ${adj.timeouts.llm / 1000}s
  Retries: ${adj.retries.default}
  Debug Endpoints: ${adj.security.enableDebugEndpoints ? 'enabled' : 'disabled'}`;
}
