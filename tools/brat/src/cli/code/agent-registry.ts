import type { CodingAgentPlugin } from './plugins/base-plugin';

/**
 * Singleton registry for coding agent plugins.
 *
 * Manages registration, retrieval, and validation of all coding agent plugins
 * (Claude Code, Aider, Continue, etc.). Plugins are registered at module load time.
 *
 * Usage:
 * ```typescript
 * // Register a plugin
 * AgentRegistry.register(new ClaudeCodePlugin());
 *
 * // Get all plugins
 * const plugins = AgentRegistry.getAllPlugins();
 *
 * // Get plugin by ID
 * const plugin = AgentRegistry.getPlugin('claude-code');
 * ```
 */
export class AgentRegistry {
  private static instance: AgentRegistry;
  private plugins: Map<string, CodingAgentPlugin> = new Map();

  /**
   * Private constructor for singleton pattern.
   */
  private constructor() {}

  /**
   * Get the singleton registry instance.
   */
  public static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * Register a coding agent plugin.
   *
   * Validates the plugin and adds it to the registry. If a plugin with the same ID
   * already exists, it will be replaced (useful for testing).
   *
   * @param plugin - Plugin instance to register
   * @throws Error if plugin is invalid (missing required properties)
   */
  public static register(plugin: CodingAgentPlugin): void {
    const instance = AgentRegistry.getInstance();

    // Validate plugin
    if (!plugin.id) {
      throw new Error('Plugin must have an id property');
    }
    if (!plugin.name) {
      throw new Error(`Plugin ${plugin.id} must have a name property`);
    }
    if (!plugin.minVersion) {
      throw new Error(`Plugin ${plugin.id} must have a minVersion property`);
    }
    if (typeof plugin.detect !== 'function') {
      throw new Error(`Plugin ${plugin.id} must implement detect() method`);
    }
    if (typeof plugin.prepareConfig !== 'function') {
      throw new Error(`Plugin ${plugin.id} must implement prepareConfig() method`);
    }
    if (typeof plugin.launch !== 'function') {
      throw new Error(`Plugin ${plugin.id} must implement launch() method`);
    }

    // Register plugin
    instance.plugins.set(plugin.id, plugin);
  }

  /**
   * Get a plugin by its unique ID.
   *
   * @param id - Plugin ID (e.g., 'claude-code', 'aider')
   * @returns Plugin instance or undefined if not found
   */
  public static getPlugin(id: string): CodingAgentPlugin | undefined {
    const instance = AgentRegistry.getInstance();
    return instance.plugins.get(id);
  }

  /**
   * Get a plugin by its name (case-insensitive).
   *
   * Useful when users specify agent by name rather than ID.
   *
   * @param name - Plugin name (e.g., 'Claude Code', 'Aider')
   * @returns Plugin instance or undefined if not found
   */
  public static getByName(name: string): CodingAgentPlugin | undefined {
    const instance = AgentRegistry.getInstance();
    const lowerName = name.toLowerCase();

    for (const plugin of instance.plugins.values()) {
      if (plugin.name.toLowerCase() === lowerName) {
        return plugin;
      }
    }

    return undefined;
  }

  /**
   * Get all registered plugins.
   *
   * @returns Array of all plugin instances
   */
  public static getAllPlugins(): CodingAgentPlugin[] {
    const instance = AgentRegistry.getInstance();
    return Array.from(instance.plugins.values());
  }

  /**
   * Get all registered plugin IDs.
   *
   * @returns Array of plugin IDs
   */
  public static getAllPluginIds(): string[] {
    const instance = AgentRegistry.getInstance();
    return Array.from(instance.plugins.keys());
  }

  /**
   * Check if a plugin is registered.
   *
   * @param id - Plugin ID to check
   * @returns True if plugin is registered
   */
  public static hasPlugin(id: string): boolean {
    const instance = AgentRegistry.getInstance();
    return instance.plugins.has(id);
  }

  /**
   * Unregister a plugin (primarily for testing).
   *
   * @param id - Plugin ID to remove
   * @returns True if plugin was removed, false if not found
   */
  public static unregister(id: string): boolean {
    const instance = AgentRegistry.getInstance();
    return instance.plugins.delete(id);
  }

  /**
   * Clear all registered plugins (primarily for testing).
   */
  public static clear(): void {
    const instance = AgentRegistry.getInstance();
    instance.plugins.clear();
  }

  /**
   * Get count of registered plugins.
   *
   * @returns Number of registered plugins
   */
  public static count(): number {
    const instance = AgentRegistry.getInstance();
    return instance.plugins.size;
  }
}
