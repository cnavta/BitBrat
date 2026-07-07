/**
 * Sprint 332 — Reflex Bit Type Definitions
 *
 * Defines types for the Reflex bit, which handles deterministic event-driven behaviors
 * with minimal latency and cost. Reflexes match events against patterns and orchestrate
 * MCP tool invocations without requiring LLM inference.
 *
 * Key features:
 * - 5 pattern match types (exact, contains, regex, prefix, suffix)
 * - Conditional filtering (eventTypes, channels, platforms, userRoles, minAuthLevel)
 * - Template-based parameter interpolation
 * - Optional candidate response generation
 */

/**
 * Pattern matching type for reflex rules.
 *
 * @example
 * // Exact match
 * { type: 'exact', pattern: '!fail', field: 'message.text' }
 *
 * @example
 * // Regex match
 * { type: 'regex', pattern: '^!timer (\\d+)$', field: 'message.text' }
 */
export type PatternMatchType = 'exact' | 'contains' | 'regex' | 'prefix' | 'suffix';

/**
 * Pattern matching configuration for a reflex.
 */
export interface PatternMatch {
  /** Match type */
  type: PatternMatchType;

  /** Pattern to match against */
  pattern: string;

  /** JSONPath-like field accessor (e.g., 'message.text', 'identity.user.id') */
  field: string;

  /** Regex flags (i, m, s, etc.) - only used for regex type */
  flags?: string;

  /** Case sensitivity - applies to exact, contains, prefix, suffix */
  caseSensitive?: boolean;
}

/**
 * Optional conditions for filtering when a reflex should trigger.
 * All conditions use AND logic - all must match for the reflex to execute.
 *
 * @example
 * {
 *   eventTypes: ['chat.message.v1'],
 *   channels: ['#my-channel'],
 *   platforms: ['twitch'],
 *   userRoles: ['moderator', 'broadcaster']
 * }
 */
export interface ReflexCondition {
  /** Filter by event type (e.g., ['chat.message.v1', 'chat.command.v1']) */
  eventTypes?: string[];

  /** Filter by channel (e.g., ['#my-channel']) */
  channels?: string[];

  /** Filter by platform (e.g., ['twitch', 'discord']) */
  platforms?: string[];

  /** Require specific user roles (e.g., ['moderator', 'broadcaster']) */
  userRoles?: string[];

  /** Minimum auth level required (from auth service) */
  minAuthLevel?: number;
}

/**
 * MCP tool invocation configuration.
 * Parameters support template interpolation using {{field.path}} syntax.
 *
 * @example
 * {
 *   tool: 'mcp:obs.set_scene_item_enabled',
 *   parameters: {
 *     sceneName: 'MainScene',
 *     sceneItemId: 5,
 *     sceneItemEnabled: true
 *   },
 *   timeout: 3000
 * }
 */
export interface ToolInvocation {
  /** Fully qualified MCP tool ID (e.g., 'mcp:obs.set_scene_item_enabled') */
  tool: string;

  /**
   * Parameter template with {{field.path}} interpolation support.
   * String values are interpolated, non-string values are passed as-is.
   */
  parameters: Record<string, any>;

  /** Max execution time in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * Statistics tracking for reflex execution.
 */
export interface ReflexStats {
  /** Total number of times this reflex matched an event */
  matchCount: number;

  /** Number of successful tool executions */
  successCount: number;

  /** Number of failed executions */
  errorCount: number;

  /** Timestamp of last match (ISO 8601) */
  lastMatchedAt?: string;

  /** Timestamp of last execution (ISO 8601) */
  lastExecutedAt?: string;
}

/**
 * Complete reflex rule definition.
 *
 * A reflex defines a deterministic pattern-action mapping that executes
 * without LLM inference for fast, cost-effective event handling.
 *
 * @example
 * {
 *   id: 'obs-fail-toggle',
 *   name: 'OBS Fail Source Toggle',
 *   description: 'Shows OBS fail source when !fail is typed in chat',
 *   active: true,
 *   priority: 10,
 *   match: {
 *     type: 'exact',
 *     pattern: '!fail',
 *     field: 'message.text',
 *     caseSensitive: false
 *   },
 *   conditions: {
 *     eventTypes: ['chat.message.v1'],
 *     platforms: ['twitch']
 *   },
 *   action: {
 *     tool: 'obs.set_source_visibility',
 *     parameters: {
 *       sourceName: 'FailOverlay',
 *       visible: true
 *     },
 *     timeout: 3000
 *   },
 *   candidateTemplate: 'Fail overlay activated! Visibility set to {{result.visible}}.',
 *   createdAt: '2026-07-04T00:00:00Z',
 *   updatedAt: '2026-07-04T00:00:00Z',
 *   tags: ['obs', 'overlay', 'chat-command']
 * }
 */
export interface Reflex {
  // ===== Identity =====

  /** Firestore document ID (auto-generated or user-specified slug) */
  id: string;

  /** Human-readable name for the reflex */
  name: string;

  /** Optional description explaining what this reflex does */
  description?: string;

  // ===== State =====

  /** Enable/disable without deletion */
  active: boolean;

  /**
   * Execution order when multiple reflexes match.
   * Lower numbers = higher priority (executed first).
   * Default: 100
   */
  priority: number;

  // ===== Matching Configuration =====

  /** Pattern matching configuration */
  match: PatternMatch;

  /** Optional filtering conditions (AND logic) */
  conditions?: ReflexCondition;

  // ===== Action Configuration =====

  /**
   * Optional MCP tool invocation configuration.
   * If omitted, the reflex will only generate a candidate response without tool execution.
   * At least one of action or candidateTemplate must be provided.
   */
  action?: ToolInvocation;

  // ===== Response Configuration =====

  /**
   * Optional template(s) for generating candidate responses.
   * Can be a single string or an array of strings.
   *
   * When an array is provided, all templates will be interpolated and added as candidates,
   * allowing the egress to randomly select one from the set.
   *
   * Supports dual-context interpolation:
   * - {{event.field.path}} - Access event data
   * - {{result.field.path}} - Access MCP tool call results
   *
   * @example Single template
   * "Fail overlay activated by {{event.identity.user.displayName}}! Status: {{result.visible}}"
   *
   * @example Multiple templates (random selection at egress)
   * [
   *   "Pong!",
   *   "Pong! {{event.identity.user.displayName}} is alive!",
   *   "🏓 Pong from the void!"
   * ]
   */
  candidateTemplate?: string | string[];

  // ===== Metadata =====

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Last update timestamp (ISO 8601) */
  updatedAt: string;

  /** User ID who created this reflex (for LLM-created reflexes) */
  createdBy?: string;

  /** Searchable tags */
  tags?: string[];

  // ===== Statistics =====

  /** Execution statistics (updated by reflex service) */
  stats?: ReflexStats;
}

/**
 * Result of reflex execution (returned by executeReflex).
 */
export interface ReflexExecutionResult {
  /** Execution status */
  status: 'success' | 'error';

  /** Tool execution result (on success) */
  result?: any;

  /**
   * Generated candidate(s) (if candidateTemplate was provided).
   * When candidateTemplate is an array, multiple candidates are generated.
   */
  candidates?: any[]; // Array of InternalCandidate from events.ts

  /** Error details (on failure) */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };

  /** Execution time in milliseconds */
  latency: number;
}
