/**
 * Config-Based Event Registry
 *
 * YAML-driven event registry that eliminates hard-coded TypeScript event definitions.
 *
 * **Key Innovation**: Event types, platform mappings, and field extraction rules are now
 * declarative YAML configs instead of procedural TypeScript code.
 *
 * **Benefits**:
 * - Add new event types without writing code
 * - Platform integration teams can contribute YAML instead of TypeScript
 * - Centralized event type catalog
 * - Runtime reconfiguration (no restart needed)
 * - Easy to version, review, and audit
 *
 * Sprint 13: DM Capability Implementation (EP-01: Developer Experience Foundation)
 *
 * @example
 * ```typescript
 * const registry = new ConfigRegistry();
 * await registry.load('./config');
 *
 * // Query by internal event type
 * const dmDef = registry.findByType('dm.message.v1');
 *
 * // Query by platform event
 * const discordDmMapping = registry.findByPlatformEvent('discord', 'MESSAGE_CREATE');
 *
 * // List all DM-capable platforms
 * const platforms = registry.listPlatforms('dm.message.v1');
 * // => ['discord', 'slack', 'twitch']
 * ```
 *
 * @since Sprint 13
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { GenericFieldMapping } from './generic-envelope-builder';
import { logger } from '../../../common/logging';

// json-logic-js does not ship perfect TS types; use a safe import
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsonLogic: any = require('json-logic-js');

/**
 * Event definition from config/events/*.yaml
 *
 * Describes a single internal event type (e.g., dm.message.v1).
 */
export interface EventDefinition {
  /** Event type identifier (e.g., 'dm.message.v1') */
  type: string;

  /** Human-readable description */
  description: string;

  /** Version number (e.g., 1) */
  version: number;

  /** Category: ingress, egress, or bidirectional */
  category: 'ingress' | 'egress' | 'bidirectional';

  /**
   * Platforms that support this event type
   * (derived from platform mapping files)
   */
  supportedPlatforms?: string[];

  /**
   * Whether this event type is deprecated
   */
  deprecated?: boolean;

  /**
   * Metadata for observability
   */
  metadata?: {
    createdBy?: string;
    createdAt?: string;
    lastModified?: string;
  };
}

/**
 * Platform event mapping from config/platforms/{platform}/*.yaml
 *
 * Maps a platform-specific event (e.g., Discord MESSAGE_CREATE) to an internal event type.
 */
export interface PlatformEventMapping {
  /** Platform name (e.g., 'discord') */
  platform: string;

  /** Platform event name (e.g., 'MESSAGE_CREATE', 'message', 'PRIVMSG') */
  platformEvent: string;

  /** Internal event type this maps to */
  internalEventType: string;

  /** Field mapping configuration for generic builder */
  fieldMapping: GenericFieldMapping;

  /**
   * Optional filter to conditionally apply this mapping
   *
   * Uses JSONLogic format. The event payload is the data context.
   *
   * @example
   * ```yaml
   * # Only DMs (Discord channel type 1)
   * filter:
   *   "==": [{ "var": "channel.type" }, 1]
   * ```
   */
  filter?: any;

  /**
   * Compiled filter function (generated at load time)
   * @internal
   */
  filterFn?: (evt: any) => boolean;

  /**
   * Priority for disambiguation when multiple mappings match
   *
   * Higher priority = checked first. Default: 0.
   * Use for variants (e.g., DM vs regular message both from MESSAGE_CREATE).
   */
  priority?: number;
}

/**
 * Registry loading options
 */
export interface RegistryOptions {
  /** Base config directory path */
  configPath: string;

  /** Whether to watch for file changes and auto-reload */
  watch?: boolean;

  /** Whether to validate configs against JSON Schema (default: true) */
  validateSchema?: boolean;

  /** Logger instance */
  logger?: any;
}

/**
 * Config-based event registry
 *
 * Loads event definitions and platform mappings from YAML files.
 */
export class ConfigRegistry {
  private eventDefinitions = new Map<string, EventDefinition>();
  private platformMappings = new Map<string, PlatformEventMapping[]>();
  private options: RegistryOptions;
  private log: any;
  private ajv?: Ajv;
  private eventDefSchema?: any;
  private platformMappingSchema?: any;

  constructor(options?: Partial<RegistryOptions>) {
    this.options = {
      configPath: options?.configPath || './config',
      watch: options?.watch || false,
      validateSchema: options?.validateSchema !== false, // Default true
      logger: options?.logger || logger,
    };
    this.log = this.options.logger;

    // Initialize JSON Schema validator if enabled
    if (this.options.validateSchema) {
      this.ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(this.ajv);
    }
  }

  /**
   * Load event registry from config directory
   *
   * Scans:
   * - config/events/*.yaml → EventDefinitions
   * - config/platforms/{platform}/*.yaml → PlatformEventMappings
   * - config/schemas/*.schema.json → JSON Schemas for validation
   *
   * @throws Error if config directory doesn't exist or contains invalid YAML
   */
  async load(): Promise<void> {
    const configPath = this.options.configPath;

    this.log.info('config-registry.loading', { configPath });

    // Load JSON schemas for validation
    if (this.options.validateSchema && this.ajv) {
      await this.loadSchemas();
    }

    // Load event definitions
    const eventsPath = path.join(configPath, 'events');
    await this.loadEventDefinitions(eventsPath);

    // Load platform mappings
    const platformsPath = path.join(configPath, 'platforms');
    await this.loadPlatformMappings(platformsPath);

    // Build reverse index (platforms → event types)
    this.buildPlatformIndex();

    this.log.info('config-registry.loaded', {
      eventCount: this.eventDefinitions.size,
      platformCount: this.platformMappings.size,
      totalMappings: Array.from(this.platformMappings.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
    });
  }

  /**
   * Load JSON schemas for validation
   */
  private async loadSchemas(): Promise<void> {
    try {
      const schemasPath = path.join(this.options.configPath, 'schemas');

      // Load event definition schema
      const eventDefSchemaPath = path.join(schemasPath, 'event-definition.schema.json');
      const eventDefSchemaContent = await fs.readFile(eventDefSchemaPath, 'utf-8');
      this.eventDefSchema = JSON.parse(eventDefSchemaContent);

      // Load platform mapping schema
      const platformMappingSchemaPath = path.join(schemasPath, 'platform-mapping.schema.json');
      const platformMappingSchemaContent = await fs.readFile(platformMappingSchemaPath, 'utf-8');
      this.platformMappingSchema = JSON.parse(platformMappingSchemaContent);

      this.log.debug('config-registry.schemas-loaded');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.log.warn('config-registry.schemas-missing', {
          message: 'JSON schemas not found, validation disabled',
        });
        this.options.validateSchema = false;
      } else {
        throw error;
      }
    }
  }

  /**
   * Load event definitions from config/events/*.yaml
   */
  private async loadEventDefinitions(eventsPath: string): Promise<void> {
    try {
      const files = await fs.readdir(eventsPath);
      const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const filePath = path.join(eventsPath, file);
        const def = await this.loadEventDefinition(filePath);
        this.eventDefinitions.set(def.type, def);
      }

      this.log.debug('config-registry.events-loaded', { count: this.eventDefinitions.size });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.log.warn('config-registry.events-dir-missing', { eventsPath });
        return;
      }
      throw error;
    }
  }

  /**
   * Load single event definition from YAML file
   */
  private async loadEventDefinition(filePath: string): Promise<EventDefinition> {
    const content = await fs.readFile(filePath, 'utf-8');
    const doc = yaml.load(content) as any;

    // Validate against JSON Schema
    if (this.options.validateSchema && this.ajv && this.eventDefSchema) {
      const validate = this.ajv.compile(this.eventDefSchema);
      const valid = validate(doc);
      if (!valid) {
        const errors = validate.errors
          ?.map((err) => `${err.instancePath} ${err.message}`)
          .join(', ');
        throw new Error(`Invalid event definition in ${filePath}: ${errors}`);
      }
    } else {
      // Fallback validation for required fields
      if (!doc.type || !doc.version || !doc.category) {
        throw new Error(
          `Invalid event definition in ${filePath}: missing required fields (type, version, category)`
        );
      }
    }

    return {
      type: doc.type,
      description: doc.description || '',
      version: doc.version,
      category: doc.category,
      deprecated: doc.deprecated || false,
      metadata: doc.metadata || {},
    };
  }

  /**
   * Load platform mappings from config/platforms/{platform}/*.yaml
   */
  private async loadPlatformMappings(platformsPath: string): Promise<void> {
    try {
      const platforms = await fs.readdir(platformsPath);

      for (const platform of platforms) {
        const platformPath = path.join(platformsPath, platform);
        const stat = await fs.stat(platformPath);

        if (stat.isDirectory()) {
          await this.loadPlatformDirectory(platform, platformPath);
        }
      }

      this.log.debug('config-registry.platforms-loaded', {
        count: this.platformMappings.size,
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.log.warn('config-registry.platforms-dir-missing', { platformsPath });
        return;
      }
      throw error;
    }
  }

  /**
   * Load all mapping files for a single platform
   */
  private async loadPlatformDirectory(platform: string, platformPath: string): Promise<void> {
    const files = await fs.readdir(platformPath);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    const mappings: PlatformEventMapping[] = [];

    for (const file of yamlFiles) {
      const filePath = path.join(platformPath, file);
      const mapping = await this.loadPlatformMapping(platform, filePath);
      mappings.push(mapping);
    }

    // Sort by priority (highest first)
    mappings.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    this.platformMappings.set(platform, mappings);
  }

  /**
   * Load single platform mapping from YAML file
   */
  private async loadPlatformMapping(
    platform: string,
    filePath: string
  ): Promise<PlatformEventMapping> {
    const content = await fs.readFile(filePath, 'utf-8');
    const doc = yaml.load(content) as any;

    // Validate against JSON Schema
    if (this.options.validateSchema && this.ajv && this.platformMappingSchema) {
      const validate = this.ajv.compile(this.platformMappingSchema);
      const valid = validate(doc);
      if (!valid) {
        const errors = validate.errors
          ?.map((err) => `${err.instancePath} ${err.message}`)
          .join(', ');
        throw new Error(`Invalid platform mapping in ${filePath}: ${errors}`);
      }
    } else {
      // Fallback validation for required fields
      if (!doc.platformEvent || !doc.internalEventType || !doc.fieldMapping) {
        throw new Error(
          `Invalid platform mapping in ${filePath}: missing required fields (platformEvent, internalEventType, fieldMapping)`
        );
      }
    }

    const mapping: PlatformEventMapping = {
      platform,
      platformEvent: doc.platformEvent,
      internalEventType: doc.internalEventType,
      fieldMapping: doc.fieldMapping,
      priority: doc.priority || 0,
    };

    // Compile JSONLogic filter if present
    if (doc.filter) {
      mapping.filter = doc.filter;
      mapping.filterFn = this.compileFilter(doc.filter);
    }

    // Include egress configuration if present (Sprint 13: DX-010)
    if (doc.egress) {
      (mapping as any).egress = doc.egress;
    }

    return mapping;
  }

  /**
   * Compile JSONLogic filter to JavaScript function
   *
   * @param filterConfig - JSONLogic filter configuration
   * @returns Function that evaluates the filter against an event
   */
  private compileFilter(filterConfig: any): (evt: any) => boolean {
    return (evt: any) => {
      try {
        return jsonLogic.apply(filterConfig, evt);
      } catch (error) {
        this.log.warn('config-registry.filter-eval-error', { error, filterConfig });
        return false;
      }
    };
  }

  /**
   * Build reverse index: which platforms support each event type
   */
  private buildPlatformIndex(): void {
    for (const [platform, mappings] of this.platformMappings.entries()) {
      for (const mapping of mappings) {
        const def = this.eventDefinitions.get(mapping.internalEventType);
        if (def) {
          def.supportedPlatforms = def.supportedPlatforms || [];
          if (!def.supportedPlatforms.includes(platform)) {
            def.supportedPlatforms.push(platform);
          }
        }
      }
    }
  }

  /**
   * Find event definition by internal type
   *
   * @param eventType - Internal event type (e.g., 'dm.message.v1')
   * @returns Event definition or undefined
   */
  findByType(eventType: string): EventDefinition | undefined {
    return this.eventDefinitions.get(eventType);
  }

  /**
   * Get event definition by type
   *
   * Alias for findByType() for API consistency with TranslationEngine.
   *
   * @param eventType - Internal event type (e.g., 'dm.message.v1')
   * @returns Event definition or undefined
   * @since Sprint 13 (DX-004)
   */
  getEventDefinition(eventType: string): EventDefinition | undefined {
    return this.findByType(eventType);
  }

  /**
   * Find platform mapping by platform event name
   *
   * Returns the highest priority mapping that matches the platform event.
   * If multiple mappings exist with filters, evaluates filters against the event payload.
   *
   * @param platform - Platform name (e.g., 'discord')
   * @param platformEvent - Platform event name (e.g., 'MESSAGE_CREATE')
   * @param eventPayload - Optional event payload for filter evaluation
   * @returns Platform event mapping or undefined
   */
  findByPlatformEvent(
    platform: string,
    platformEvent: string,
    eventPayload?: any
  ): PlatformEventMapping | undefined {
    const mappings = this.platformMappings.get(platform);
    if (!mappings) return undefined;

    // Find mappings for this platform event
    const candidates = mappings.filter((m) => m.platformEvent === platformEvent);
    if (candidates.length === 0) return undefined;

    // If only one mapping, return it
    if (candidates.length === 1) {
      const mapping = candidates[0];
      // Check filter if present
      if (mapping.filterFn && eventPayload) {
        return mapping.filterFn(eventPayload) ? mapping : undefined;
      }
      return mapping;
    }

    // Multiple mappings - evaluate filters
    if (eventPayload) {
      for (const mapping of candidates) {
        if (mapping.filterFn) {
          if (mapping.filterFn(eventPayload)) {
            return mapping;
          }
        } else {
          // No filter = matches all
          return mapping;
        }
      }
    }

    // No payload provided or no filters matched - return highest priority
    return candidates[0];
  }

  /**
   * List all platforms that support a given event type
   *
   * @param eventType - Internal event type
   * @returns Array of platform names
   */
  listPlatforms(eventType: string): string[] {
    const def = this.eventDefinitions.get(eventType);
    return def?.supportedPlatforms || [];
  }

  /**
   * List all event definitions
   *
   * @param filter - Optional filter function
   * @returns Array of event definitions
   */
  listEvents(filter?: (def: EventDefinition) => boolean): EventDefinition[] {
    const events = Array.from(this.eventDefinitions.values());
    return filter ? events.filter(filter) : events;
  }

  /**
   * Get all mappings for a platform
   *
   * @param platform - Platform name
   * @returns Array of platform event mappings
   */
  getPlatformMappings(platform: string): PlatformEventMapping[] {
    return this.platformMappings.get(platform) || [];
  }

  /**
   * Reload registry from disk
   *
   * Useful for runtime reconfiguration.
   */
  async reload(): Promise<void> {
    this.eventDefinitions.clear();
    this.platformMappings.clear();
    await this.load();
  }

  /**
   * Get registry stats for observability
   */
  getStats(): {
    eventCount: number;
    platformCount: number;
    totalMappings: number;
    platforms: string[];
  } {
    return {
      eventCount: this.eventDefinitions.size,
      platformCount: this.platformMappings.size,
      totalMappings: Array.from(this.platformMappings.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
      platforms: Array.from(this.platformMappings.keys()),
    };
  }
}
