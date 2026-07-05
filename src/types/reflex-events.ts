/**
 * Sprint 332 — Reflex Execution Event Type Definitions
 *
 * Defines event schemas published when reflexes execute or fail.
 * These events allow other systems to react to reflex executions
 * (e.g., schedule follow-up actions, analytics, error tracking).
 *
 * Topics:
 * - internal.reflex.executed.v1 - Published on successful reflex execution
 * - internal.reflex.failed.v1 - Published on reflex execution failure
 */

/**
 * Context information about what triggered the reflex execution.
 * Links the reflex execution back to the original event.
 */
export interface ReflexTriggeredBy {
  /** Original event correlationId for tracing */
  correlationId: string;

  /** Original event type (e.g., 'chat.message.v1') */
  eventType: string;

  /** User who triggered the event (if applicable) */
  user?: {
    id: string;
    displayName: string;
  };

  /** Channel where event occurred (if applicable) */
  channel?: string;

  /** Platform where event occurred (if applicable) */
  platform?: string;
}

/**
 * Event published when a reflex successfully executes.
 *
 * Published to: internal.reflex.executed.v1
 *
 * Use cases:
 * - Schedule follow-up actions after reflex execution
 * - Track reflex usage analytics
 * - Chain reflexes together (future)
 *
 * @example
 * {
 *   v: '1',
 *   reflexId: 'obs-fail-toggle',
 *   reflexName: 'OBS Fail Source Toggle',
 *   tool: 'obs.set_source_visibility',
 *   parameters: { sourceName: 'FailOverlay', visible: true },
 *   result: { success: true, visible: true },
 *   latency: 45,
 *   triggeredBy: {
 *     correlationId: '123e4567-e89b-12d3-a456-426614174000',
 *     eventType: 'chat.message.v1',
 *     user: { id: 'user123', displayName: 'JohnDoe' },
 *     channel: '#my-channel',
 *     platform: 'twitch'
 *   },
 *   timestamp: '2026-07-04T12:00:00.000Z'
 * }
 */
export interface ReflexExecutedEvent {
  /** Event schema version */
  v: '1';

  /** ID of the reflex that was executed */
  reflexId: string;

  /** Name of the reflex (for human readability) */
  reflexName: string;

  /** MCP tool that was called */
  tool: string;

  /** Resolved parameters after template interpolation */
  parameters: Record<string, any>;

  /** Tool execution result */
  result: any;

  /** Execution time in milliseconds */
  latency: number;

  /** Context about what triggered this reflex */
  triggeredBy: ReflexTriggeredBy;

  /** Execution timestamp (ISO 8601) */
  timestamp: string;
}

/**
 * Event published when a reflex execution fails.
 *
 * Published to: internal.reflex.failed.v1
 *
 * Use cases:
 * - Error tracking and alerting
 * - Automatic retry logic (future)
 * - Fallback actions on failure
 *
 * @example
 * {
 *   v: '1',
 *   reflexId: 'obs-fail-toggle',
 *   reflexName: 'OBS Fail Source Toggle',
 *   tool: 'obs.set_source_visibility',
 *   parameters: { sourceName: 'FailOverlay', visible: true },
 *   error: {
 *     message: 'Tool gateway timeout after 5000ms',
 *     code: 'TIMEOUT',
 *     stack: '...'
 *   },
 *   latency: 5001,
 *   triggeredBy: {
 *     correlationId: '123e4567-e89b-12d3-a456-426614174000',
 *     eventType: 'chat.message.v1',
 *     user: { id: 'user123', displayName: 'JohnDoe' },
 *     channel: '#my-channel',
 *     platform: 'twitch'
 *   },
 *   timestamp: '2026-07-04T12:00:00.000Z'
 * }
 */
export interface ReflexFailedEvent {
  /** Event schema version */
  v: '1';

  /** ID of the reflex that failed */
  reflexId: string;

  /** Name of the reflex (for human readability) */
  reflexName: string;

  /** MCP tool that was called */
  tool: string;

  /** Resolved parameters after template interpolation */
  parameters: Record<string, any>;

  /** Error details */
  error: {
    /** Error message */
    message: string;

    /** Error code (if available) */
    code?: string;

    /** Stack trace (if available) */
    stack?: string;
  };

  /** Time spent before failure in milliseconds */
  latency: number;

  /** Context about what triggered this reflex */
  triggeredBy: ReflexTriggeredBy;

  /** Failure timestamp (ISO 8601) */
  timestamp: string;
}
