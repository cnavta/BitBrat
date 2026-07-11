/**
 * Event Context - AsyncLocalStorage-based context propagation
 *
 * Provides automatic context propagation throughout async operations without
 * requiring manual parameter passing. This is the foundation for agent-centric
 * logging where correlationId and other context fields are automatically
 * injected into every log entry.
 *
 * @module event-context
 * @see documentation/technical-architecture/agent-centric-logging-v1.md
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Event context that flows with async operations.
 *
 * This context is automatically propagated through async/await chains,
 * promises, and callbacks using Node.js AsyncLocalStorage.
 *
 * Core fields:
 * - correlationId: Unique identifier for the event/request (required for tracing)
 * - traceId: OpenTelemetry trace ID (for Cloud Logging correlation)
 * - sessionId: User session identifier
 * - userId: User identifier from identity.user
 * - requestId: HTTP request identifier
 * - stage: Reactive agent loop stage (attention, analysis, reaction, etc.)
 *
 * Additional fields can be added dynamically via the index signature.
 *
 * @example
 * ```typescript
 * // Set context at the entry point
 * await runWithEventContext({ correlationId: 'abc-123' }, async () => {
 *   // Context automatically available in nested calls
 *   const ctx = getEventContext();
 *   console.log(ctx?.correlationId); // 'abc-123'
 *
 *   await someAsyncOperation(); // Context propagates automatically
 * });
 * ```
 */
export interface EventContext {
  /** Unique identifier for the event/request (enables distributed tracing) */
  correlationId?: string;

  /** OpenTelemetry trace ID (for Cloud Logging correlation) */
  traceId?: string;

  /** User session identifier */
  sessionId?: string;

  /** User identifier from identity.user */
  userId?: string;

  /** HTTP request identifier (x-request-id header) */
  requestId?: string;

  /** Reactive agent loop stage (attention, contextualization, analysis, reaction, introspection, learning) */
  stage?: string;

  /** Allow additional context fields */
  [key: string]: unknown;
}

/**
 * Async-local storage for event context.
 *
 * AsyncLocalStorage provides a way to store data throughout the lifetime of
 * an async operation without passing it through function parameters. It's
 * similar to thread-local storage in multi-threaded environments.
 *
 * @internal
 */
const eventContextStore = new AsyncLocalStorage<EventContext>();

/**
 * Run a function with event context.
 *
 * Creates a new async-local context and runs the provided function within it.
 * The context is automatically available to all async operations initiated
 * within the function, including nested async calls and callbacks.
 *
 * Context is isolated per async call chain - concurrent operations each get
 * their own independent context.
 *
 * @param context - The event context to propagate
 * @param fn - The function to run with the context
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * await runWithEventContext({ correlationId: 'req-123' }, async () => {
 *   // All async operations here have access to the context
 *   await processMessage();
 *   await sendResponse();
 * });
 * ```
 */
export function runWithEventContext<T>(
  context: EventContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return eventContextStore.run(context, fn);
}

/**
 * Get the current event context.
 *
 * Returns the EventContext associated with the current async operation,
 * or undefined if not running within a context (outside runWithEventContext).
 *
 * This function is safe to call anywhere and will never throw. It returns
 * undefined when called outside of an event context.
 *
 * @returns The current event context, or undefined if not in context
 *
 * @example
 * ```typescript
 * function someDeepFunction() {
 *   const ctx = getEventContext();
 *   if (ctx?.correlationId) {
 *     console.log('CorrelationId:', ctx.correlationId);
 *   }
 * }
 * ```
 */
export function getEventContext(): EventContext | undefined {
  return eventContextStore.getStore();
}

/**
 * Get a specific field from the event context.
 *
 * Convenience function to retrieve a single field from the context.
 * Returns undefined if the context doesn't exist or the field is not set.
 *
 * @param key - The context field to retrieve
 * @returns The field value, or undefined if not found
 *
 * @example
 * ```typescript
 * const correlationId = getContextField('correlationId');
 * const userId = getContextField('userId');
 * ```
 */
export function getContextField(key: keyof EventContext): unknown {
  const ctx = eventContextStore.getStore();
  return ctx?.[key];
}

/**
 * Update the current event context.
 *
 * Merges the provided updates into the existing context. This is useful for
 * adding additional context as processing progresses (e.g., adding userId
 * after authentication, adding stage as routing advances).
 *
 * Updates only affect the current async context and do not propagate to
 * parent or sibling contexts.
 *
 * **Important:** This only works when called within an active context.
 * If called outside of runWithEventContext, it will silently do nothing.
 *
 * @param updates - Partial context to merge with existing context
 *
 * @example
 * ```typescript
 * await runWithEventContext({ correlationId: 'req-123' }, async () => {
 *   // Initial context has only correlationId
 *
 *   const user = await authenticate();
 *   updateEventContext({ userId: user.id }); // Add userId
 *
 *   await processWithAuth(); // Now has both correlationId and userId
 *
 *   updateEventContext({ stage: 'analysis' }); // Add stage
 * });
 * ```
 */
export function updateEventContext(updates: Partial<EventContext>): void {
  const current = eventContextStore.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}

/**
 * Check if currently running within an event context.
 *
 * @returns true if inside a runWithEventContext block, false otherwise
 *
 * @example
 * ```typescript
 * if (hasEventContext()) {
 *   console.log('Running with context');
 * } else {
 *   console.log('No context available');
 * }
 * ```
 */
export function hasEventContext(): boolean {
  return eventContextStore.getStore() !== undefined;
}
