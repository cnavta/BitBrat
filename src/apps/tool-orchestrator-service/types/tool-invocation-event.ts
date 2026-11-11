/**
 * Tool Invocation Event Schema
 *
 * Structured event emitted on every tool invocation for observability.
 * Logged to stdout as JSON, scraped by Promtail, indexed by Loki.
 *
 * @module tool-orchestrator-service/types
 * @see planning/sprint-59-ig0sr1/execution-plan.md - Task 3
 * @see documentation/reference/tool-invocation-event-schema.md
 */

/**
 * Tool invocation event - logged on every tool execution
 *
 * **Loki Labels** (indexed for fast queries):
 * - service: "tool-orchestrator"
 * - level: "info" | "error"
 * - eventType: "tool.invocation"
 * - toolId: string (e.g., "get_weather")
 * - modelId: string (e.g., "gpt-4")
 * - status: "success" | "error" | "denied"
 * - correlationId: string (UUID)
 *
 * **Log Message Fields** (JSON body, not indexed):
 * - All other fields below
 *
 * **Cardinality considerations**:
 * - toolId: ~50-200 unique values (manageable)
 * - modelId: ~10-20 unique values (manageable)
 * - correlationId: HIGH cardinality (millions), but retention-limited
 * - Total label combinations: ~900K with 7-day retention (within Loki limits)
 */
export interface ToolInvocationEvent {
  // ========================================================================
  // Loki Labels (promoted by Promtail)
  // ========================================================================

  /**
   * Service name (always "tool-orchestrator")
   * @lokiLabel
   */
  service: 'tool-orchestrator';

  /**
   * Log level
   * - "info": Success or denial (expected behavior)
   * - "error": Execution failure
   * @lokiLabel
   */
  level: 'info' | 'error';

  /**
   * Event type discriminator (always "tool.invocation")
   * Allows filtering specific event types from log stream
   * @lokiLabel
   */
  eventType: 'tool.invocation';

  /**
   * Tool identifier (e.g., "get_weather", "search_code")
   * @lokiLabel
   */
  toolId: string;

  /**
   * Model identifier (e.g., "gpt-4", "claude-3-opus")
   * @lokiLabel
   */
  modelId: string;

  /**
   * Invocation status
   * - "success": Tool executed successfully
   * - "error": Tool execution failed
   * - "denied": RBAC denied execution
   * @lokiLabel
   */
  status: 'success' | 'error' | 'denied';

  /**
   * Correlation ID (links events in request lifecycle)
   * @lokiLabel (HIGH CARDINALITY - retention-limited)
   */
  correlationId: string;

  // ========================================================================
  // Log Message Fields (JSON body, queryable via LogQL `| json`)
  // ========================================================================

  /**
   * Event timestamp (ISO 8601)
   * Example: "2026-11-10T12:34:56.789Z"
   */
  timestamp: string;

  /**
   * Human-readable message
   * Example: "Tool invocation completed: get_weather (success)"
   */
  message: string;

  /**
   * Execution duration in milliseconds
   * Used for P50/P95/P99 latency calculations
   */
  durationMs: number;

  /**
   * Tool name (human-readable)
   * Example: "Get Weather"
   */
  toolName: string;

  /**
   * Model name (human-readable)
   * Example: "GPT-4"
   */
  modelName: string;

  /**
   * User ID (if available)
   * Optional, for user-level analytics
   */
  userId?: string;

  /**
   * Session ID (if available)
   * Optional, for session-level analytics
   */
  sessionId?: string;

  /**
   * Trace ID (distributed tracing identifier)
   * Optional, for cross-service tracing
   */
  traceId?: string;

  /**
   * Tool input preview (truncated to 500 chars max)
   * Useful for debugging without logging full payloads
   */
  inputPreview?: string;

  /**
   * Tool output preview (truncated to 500 chars max)
   * Useful for debugging without logging full responses
   */
  outputPreview?: string;

  /**
   * Error message (if status === 'error')
   * Only populated on failures
   */
  errorMessage?: string;

  /**
   * Error stack trace (if status === 'error')
   * Only in dev/staging environments (not production)
   */
  errorStack?: string;

  /**
   * RBAC decision details
   * Always populated, provides observability into access control
   */
  rbacDecision: {
    /**
     * Whether access was granted
     */
    allowed: boolean;

    /**
     * Denial reason (if allowed === false)
     * Example: "Model tier insufficient: requires tier-2, model has tier-1"
     */
    reason?: string;

    /**
     * User roles (if available)
     * Example: ["user", "developer"]
     */
    userRoles?: string[];

    /**
     * Model tier (if available)
     * Example: "tier-2"
     */
    modelTier?: string;

    /**
     * Required roles for tool access (if denied)
     * Example: ["admin", "poweruser"]
     */
    requiredRoles?: string[];

    /**
     * Denied roles (if denied)
     * Example: ["guest"]
     */
    deniedRoles?: string[];
  };

  /**
   * Estimated cost for this invocation (if available)
   * Useful for cost tracking and budgeting
   */
  estimatedCost?: {
    /**
     * Estimated token count
     * Based on input/output length for LLM models
     */
    tokens?: number;

    /**
     * Estimated cost in USD
     * Based on model pricing from ModelRegistry
     */
    costUsd?: number;
  };
}

/**
 * Create a tool invocation event
 *
 * Helper function to construct properly formatted events with defaults.
 *
 * @param params - Event parameters
 * @returns Fully populated ToolInvocationEvent
 *
 * @example
 * const event = createToolInvocationEvent({
 *   toolId: 'get_weather',
 *   toolName: 'Get Weather',
 *   modelId: 'gpt-4',
 *   modelName: 'GPT-4',
 *   status: 'success',
 *   correlationId: 'abc-123',
 *   durationMs: 150,
 *   rbacDecision: { allowed: true },
 * });
 */
export function createToolInvocationEvent(
  params: {
    toolId: string;
    toolName: string;
    modelId: string;
    modelName: string;
    status: 'success' | 'error' | 'denied';
    correlationId: string;
    durationMs: number;
    rbacDecision: ToolInvocationEvent['rbacDecision'];
    userId?: string;
    sessionId?: string;
    traceId?: string;
    inputPreview?: string;
    outputPreview?: string;
    errorMessage?: string;
    errorStack?: string;
    estimatedCost?: ToolInvocationEvent['estimatedCost'];
  }
): ToolInvocationEvent {
  const level = params.status === 'error' ? 'error' : 'info';

  const message = params.status === 'denied'
    ? `Tool invocation denied: ${params.toolName} (${params.rbacDecision.reason || 'unknown reason'})`
    : params.status === 'error'
    ? `Tool invocation failed: ${params.toolName} (${params.errorMessage || 'unknown error'})`
    : `Tool invocation completed: ${params.toolName} (${params.status})`;

  return {
    // Loki labels
    service: 'tool-orchestrator',
    level,
    eventType: 'tool.invocation',
    toolId: params.toolId,
    modelId: params.modelId,
    status: params.status,
    correlationId: params.correlationId,

    // Log message fields
    timestamp: new Date().toISOString(),
    message,
    durationMs: params.durationMs,
    toolName: params.toolName,
    modelName: params.modelName,
    userId: params.userId,
    sessionId: params.sessionId,
    traceId: params.traceId,
    inputPreview: params.inputPreview,
    outputPreview: params.outputPreview,
    errorMessage: params.errorMessage,
    errorStack: params.errorStack,
    rbacDecision: params.rbacDecision,
    estimatedCost: params.estimatedCost,
  };
}

/**
 * Truncate string to max length with ellipsis
 *
 * @param value - String to truncate
 * @param maxLength - Maximum length (default: 500)
 * @returns Truncated string with "..." appended if truncated
 */
export function truncatePreview(value: string, maxLength = 500): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.substring(0, maxLength) + '...';
}
