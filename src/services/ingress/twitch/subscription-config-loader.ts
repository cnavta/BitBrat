import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';
import { logger } from '../../../common/logging';

/**
 * SubscriptionConfigLoader - Loads EventSub subscription config from YAML.
 *
 * Responsibilities:
 * - Load YAML config from file system
 * - Validate config structure
 * - Cache loaded config for performance
 * - Provide default config if file not found
 * - Support config reload without service restart
 *
 * @example
 * const loader = new SubscriptionConfigLoader();
 * const config = await loader.load();
 * console.log(config.subscriptions['channel.follow'].enabled);
 */
export class SubscriptionConfigLoader {
  private readonly configPath: string;
  private cachedConfig: SubscriptionConfig | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(
      process.cwd(),
      'config/twitch-eventsub/subscriptions.yaml'
    );
  }

  /**
   * Load subscription config (with caching).
   *
   * @returns Subscription configuration
   * @throws Error if config is invalid (after logging)
   */
  async load(): Promise<SubscriptionConfig> {
    if (this.cachedConfig) {
      logger.debug('eventsub.config.cache_hit', { path: this.configPath });
      return this.cachedConfig;
    }

    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const config = yaml.load(content) as SubscriptionConfig;

      // Validate config structure
      this.validate(config);

      this.cachedConfig = config;
      logger.info('eventsub.config.loaded', {
        path: this.configPath,
        subscriptions: Object.keys(config.subscriptions).length,
        channelOverrides: Object.keys(config.channelOverrides || {}).length
      });

      return config;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        logger.warn('eventsub.config.not_found', {
          path: this.configPath,
          fallback: 'using default config'
        });
        return this.getDefaultConfig();
      }

      logger.error('eventsub.config.load_failed', {
        path: this.configPath,
        error: err.message,
        stack: err.stack
      });
      throw err;
    }
  }

  /**
   * Validate config structure.
   * Throws error if config is invalid.
   *
   * @param config - Config to validate
   * @throws Error if validation fails
   */
  private validate(config: SubscriptionConfig): void {
    // Validate version
    if (!config.version || config.version !== 1) {
      throw new Error('eventsub_config_invalid_version: expected version 1');
    }

    // Validate subscriptions exists
    if (!config.subscriptions || typeof config.subscriptions !== 'object') {
      throw new Error('eventsub_config_missing_subscriptions: subscriptions object required');
    }

    // Validate each subscription
    for (const [eventType, eventConfig] of Object.entries(config.subscriptions)) {
      if (typeof eventConfig.enabled !== 'boolean') {
        throw new Error(`eventsub_config_invalid_enabled: ${eventType}.enabled must be boolean`);
      }

      if (!eventConfig.builder || typeof eventConfig.builder !== 'string') {
        throw new Error(`eventsub_config_missing_builder: ${eventType}.builder is required`);
      }

      if (!eventConfig.internalType || typeof eventConfig.internalType !== 'string') {
        throw new Error(`eventsub_config_missing_internal_type: ${eventType}.internalType is required`);
      }

      // Validate builder naming convention
      if (!eventConfig.builder.match(/^build[A-Z][a-zA-Z0-9]*$/)) {
        throw new Error(`eventsub_config_invalid_builder_name: ${eventType}.builder must start with 'build' followed by CamelCase`);
      }

      // Validate internalType format (allow lowercase letters, numbers, dots, and underscores)
      if (!eventConfig.internalType.match(/^(system|chat)\.[a-z0-9._]+$/)) {
        throw new Error(`eventsub_config_invalid_internal_type: ${eventType}.internalType must start with 'system.' or 'chat.'`);
      }

      // Validate priority if present
      if (eventConfig.priority && !['critical', 'high', 'medium', 'low'].includes(eventConfig.priority)) {
        throw new Error(`eventsub_config_invalid_priority: ${eventType}.priority must be critical, high, medium, or low`);
      }

      // Validate mutation if present
      if (eventConfig.mutation) {
        if (!eventConfig.mutation.key || typeof eventConfig.mutation.key !== 'string') {
          throw new Error(`eventsub_config_invalid_mutation: ${eventType}.mutation.key is required`);
        }
        if (eventConfig.mutation.value === undefined) {
          throw new Error(`eventsub_config_invalid_mutation: ${eventType}.mutation.value is required`);
        }
        if (eventConfig.mutation.ttl !== undefined &&
            (typeof eventConfig.mutation.ttl !== 'number' || eventConfig.mutation.ttl < 1 || eventConfig.mutation.ttl > 86400)) {
          throw new Error(`eventsub_config_invalid_mutation: ${eventType}.mutation.ttl must be 1-86400 seconds`);
        }
      }
    }

    logger.debug('eventsub.config.validated', {
      subscriptions: Object.keys(config.subscriptions).length
    });
  }

  /**
   * Get default config (fallback if YAML not found).
   * Returns minimal config with 4 existing events enabled.
   *
   * @returns Default subscription configuration
   */
  private getDefaultConfig(): SubscriptionConfig {
    const defaultConfig: SubscriptionConfig = {
      version: 1,
      subscriptions: {
        'channel.follow': {
          enabled: true,
          version: 2,
          scope: 'moderator:read:followers',
          priority: 'high',
          builder: 'buildFollow',
          internalType: 'system.twitch.follow',
          description: 'New follower event'
        },
        'channel.update': {
          enabled: true,
          version: 2,
          priority: 'high',
          builder: 'buildUpdate',
          internalType: 'system.twitch.update',
          description: 'Channel metadata changes'
        },
        'stream.online': {
          enabled: true,
          version: 1,
          priority: 'critical',
          builder: 'buildStreamOnline',
          internalType: 'system.stream.online',
          description: 'Stream goes live',
          mutation: {
            key: 'stream.state',
            value: 'on',
            ttl: 21600
          }
        },
        'stream.offline': {
          enabled: true,
          version: 1,
          priority: 'critical',
          builder: 'buildStreamOffline',
          internalType: 'system.stream.offline',
          description: 'Stream goes offline',
          mutation: {
            key: 'stream.state',
            value: 'off',
            ttl: 21600
          }
        }
      },
      channelOverrides: {}
    };

    // Cache default config
    this.cachedConfig = defaultConfig;

    logger.info('eventsub.config.default_loaded', {
      subscriptions: Object.keys(defaultConfig.subscriptions).length
    });

    return defaultConfig;
  }

  /**
   * Reload config (clears cache and loads fresh).
   * Useful for runtime config updates without service restart.
   *
   * @returns Reloaded subscription configuration
   */
  async reload(): Promise<SubscriptionConfig> {
    logger.info('eventsub.config.reloading', { path: this.configPath });
    this.cachedConfig = null;
    return this.load();
  }
}

/**
 * Subscription configuration schema.
 */
export interface SubscriptionConfig {
  /** Schema version (must be 1) */
  version: number;

  /** Map of event types to subscription config */
  subscriptions: Record<string, EventSubscriptionConfig>;

  /** Per-channel overrides (optional) */
  channelOverrides?: Record<string, Record<string, Partial<EventSubscriptionConfig>>>;
}

/**
 * Individual event subscription configuration.
 */
export interface EventSubscriptionConfig {
  /** Whether this subscription is active */
  enabled: boolean;

  /** EventSub API version (default: 1) */
  version?: number;

  /** Required OAuth scope (if any) */
  scope?: string;

  /** Event priority classification */
  priority?: 'critical' | 'high' | 'medium' | 'low';

  /** Builder method name in EventSubEnvelopeBuilder */
  builder: string;

  /** Internal event type for InternalEventV2 */
  internalType: string;

  /** Human-readable description */
  description?: string;

  /** Optional state mutation to publish */
  mutation?: {
    key: string;
    value: string | number | boolean;
    ttl?: number;
  };
}
