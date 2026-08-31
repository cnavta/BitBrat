/**
 * feedback-middleware.ts
 *
 * Middleware for detecting long-running operations and emitting progress feedback.
 *
 * Sprint 377: Long-Running Task Feedback
 *
 * This middleware intercepts events before they are published via Bit.next() and:
 * 1. Detects operations with operation_context annotation
 * 2. Tracks elapsed time since operation started
 * 3. Emits progress events at configured thresholds
 * 4. Generates template or LLM-based progress messages
 *
 * Usage:
 * ```typescript
 * // In Bit subclass
 * const middleware = new FeedbackMiddleware(this, {
 *   initialThresholdMs: 2000,
 *   updateIntervalMs: 5000,
 *   timeoutThresholdMs: 30000,
 * });
 *
 * // Wrap next() to apply middleware
 * await middleware.beforeNext(event);
 * await this.next(event);
 * ```
 */

import type { InternalEventV2, AnnotationV1 } from '../../types/events';
import type { Logger } from '../logging';
import { createProgressEvent } from '../events/derived-event';
import { randomUUID } from 'crypto';

/**
 * Configuration for feedback middleware behavior.
 */
export interface FeedbackMiddlewareConfig {
  /**
   * Time threshold (ms) before sending initial progress message.
   * Default: 2000ms (2 seconds)
   */
  initialThresholdMs?: number;

  /**
   * Interval (ms) between subsequent progress updates.
   * Default: 5000ms (5 seconds)
   */
  updateIntervalMs?: number;

  /**
   * Time threshold (ms) before sending timeout warning.
   * Default: 30000ms (30 seconds)
   */
  timeoutThresholdMs?: number;

  /**
   * Enable progress feedback (feature flag).
   * Default: true
   */
  enabled?: boolean;

  /**
   * Use custom LLM-generated messages instead of templates.
   * If true, creates progress events with prompt annotations.
   * If false, sends template messages directly.
   * Default: false (Phase 1 uses templates, Phase 2+ uses LLM)
   */
  useCustomMessages?: boolean;

  /**
   * Custom prompt template for LLM-generated messages.
   * Available variables: {operation}, {elapsedMs}, {stage}, {originalMessage}
   * Default: Generic prompt
   */
  promptTemplate?: string;
}

/**
 * Progress stage for operation lifecycle.
 */
export type ProgressStage = 'initial' | 'update' | 'timeout' | 'completion';

/**
 * Template messages for different progress stages.
 */
const TEMPLATE_MESSAGES: Record<ProgressStage, string> = {
  initial: '🤔 Thinking about your request...',
  update: '⏳ Still working on it...',
  timeout: '⌛ This is taking longer than expected, please wait...',
  completion: '✅ Done!',
};

/**
 * Default prompt template for LLM-generated progress messages.
 */
const DEFAULT_PROMPT_TEMPLATE = `Generate a brief, encouraging progress message (max 100 chars) for the user.

Original request: {originalMessage}
Operation: {operation}
Elapsed time: {elapsedMs}ms
Stage: {stage}

Requirements:
- Be concise and friendly
- Reference the user's original intent if possible
- Use a relevant emoji
- Don't mention technical details
- Keep it under 100 characters`;

/**
 * Tracked operation state.
 */
interface OperationState {
  /** Original event correlationId */
  correlationId: string;

  /** Operation start timestamp */
  startedAt: Date;

  /** Last progress message sent timestamp */
  lastProgressAt?: Date;

  /** Current progress stage */
  stage: ProgressStage;

  /** Operation details from annotation */
  operationContext: {
    operation?: string;
    parameters?: Record<string, any>;
    [key: string]: any;
  };

  /** Original message text */
  originalMessage: string;

  /** Source event for routing context (ingress/egress/identity) */
  sourceEvent: InternalEventV2;

  /** Timer for initial progress message */
  initialTimer?: NodeJS.Timeout;

  /** Timer for periodic update messages */
  updateTimer?: NodeJS.Timeout;

  /** Timer for timeout warning */
  timeoutTimer?: NodeJS.Timeout;
}

/**
 * Middleware for long-running task feedback.
 */
export class FeedbackMiddleware {
  private readonly config: Required<FeedbackMiddlewareConfig>;
  private readonly operationTracking = new Map<string, OperationState>();
  private readonly logger: Logger;
  private readonly publishFn: (topic: string, event: InternalEventV2) => Promise<void>;

  constructor(
    context: {
      getLogger: () => Logger;
      publish: (topic: string, event: InternalEventV2) => Promise<void>;
    },
    config?: FeedbackMiddlewareConfig
  ) {
    this.logger = context.getLogger();
    this.publishFn = context.publish.bind(context);

    // Merge with defaults
    this.config = {
      initialThresholdMs: config?.initialThresholdMs ?? 2000,
      updateIntervalMs: config?.updateIntervalMs ?? 5000,
      timeoutThresholdMs: config?.timeoutThresholdMs ?? 30000,
      enabled: config?.enabled ?? true,
      useCustomMessages: config?.useCustomMessages ?? false,
      promptTemplate: config?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE,
    };

    this.logger.debug('FeedbackMiddleware initialized', {
      config: this.config,
    });
  }

  /**
   * Process event before it's published via next().
   *
   * Detects operation_context annotation and starts proactive progress tracking.
   *
   * @param event - Event being published
   */
  async beforeNext(event: InternalEventV2): Promise<void> {
    this.logger.debug('FeedbackMiddleware.beforeNext called', {
      correlationId: event.correlationId,
      enabled: this.config.enabled,
    });

    if (!this.config.enabled) {
      return;
    }

    // Check for operation_context annotation
    const operationContext = this.extractOperationContext(event);
    if (!operationContext) {
      // No operation tracking requested
      this.logger.debug('FeedbackMiddleware.beforeNext: No operation_context annotation found', {
        correlationId: event.correlationId,
        annotationCount: event.annotations?.length || 0,
        annotationKinds: event.annotations?.map(a => a.kind).join(', ') || 'none',
      });
      return;
    }

    // Start tracking if not already tracked
    // getOrCreateState will set up timers for new operations
    this.getOrCreateState(event, operationContext);
  }

  /**
   * Clean up tracking for completed operation.
   *
   * Clears all active timers and removes tracking state.
   *
   * @param correlationId - Operation correlationId
   */
  completeOperation(correlationId: string): void {
    const state = this.operationTracking.get(correlationId);
    if (state) {
      // Clear all active timers
      if (state.initialTimer) {
        clearTimeout(state.initialTimer);
      }
      if (state.updateTimer) {
        clearInterval(state.updateTimer);
      }
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer);
      }

      // Remove from tracking
      this.operationTracking.delete(correlationId);
      this.logger.debug('Operation tracking completed and timers cleared', {
        correlationId,
      });
    }
  }

  /**
   * Extract operation_context annotation from event.
   */
  private extractOperationContext(
    event: InternalEventV2
  ): Record<string, any> | null {
    const annotation = event.annotations?.find((a) => a.kind === 'operation_context');
    if (!annotation || !annotation.value) {
      return null;
    }

    try {
      return typeof annotation.value === 'string'
        ? JSON.parse(annotation.value)
        : (annotation.value as Record<string, any>);
    } catch (err) {
      this.logger.warn('Failed to parse operation_context annotation', {
        correlationId: event.correlationId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Get or create operation tracking state.
   */
  private getOrCreateState(
    event: InternalEventV2,
    operationContext: Record<string, any>
  ): OperationState {
    const existing = this.operationTracking.get(event.correlationId);
    if (existing) {
      return existing;
    }

    // Extract startedAt from operation_context annotation (Sprint 21 fix)
    // Services like llm-bot provide the actual operation start time in the annotation
    let startedAt: Date;
    let startedAtSource: string;

    if (operationContext.startedAt) {
      // Handle number format (milliseconds since epoch)
      if (typeof operationContext.startedAt === 'number') {
        startedAt = new Date(operationContext.startedAt);
        startedAtSource = 'annotation_ms';
      }
      // Handle ISO string format
      else if (typeof operationContext.startedAt === 'string') {
        startedAt = new Date(operationContext.startedAt);
        startedAtSource = 'annotation_iso';
      }
      // Handle Date object (unlikely but defensive)
      else if (operationContext.startedAt instanceof Date) {
        startedAt = operationContext.startedAt;
        startedAtSource = 'annotation_date';
      }
      // Invalid format, fallback to current time
      else {
        startedAt = new Date();
        startedAtSource = 'current_time_invalid_annotation';
        this.logger.warn('Invalid startedAt format in operation_context', {
          correlationId: event.correlationId,
          startedAtType: typeof operationContext.startedAt,
          startedAtValue: operationContext.startedAt,
        });
      }
    } else {
      // No startedAt in annotation, use current time
      startedAt = new Date();
      startedAtSource = 'current_time_no_annotation';
    }

    const state: OperationState = {
      correlationId: event.correlationId,
      startedAt,
      stage: 'initial',
      operationContext,
      originalMessage: event.message?.text || '',
      sourceEvent: event, // Store for routing context in progress messages
    };

    this.operationTracking.set(event.correlationId, state);

    this.logger.debug('Operation tracking started', {
      correlationId: event.correlationId,
      operation: operationContext.operation,
      startedAt: startedAt.toISOString(),
      startedAtSource,
    });

    // Start proactive progress tracking with timers
    this.startTracking(state);

    return state;
  }

  /**
   * Start proactive progress tracking with timers.
   *
   * Sets up timers to send progress messages at configured thresholds.
   *
   * @param state - Operation state to track
   */
  private startTracking(state: OperationState): void {
    // Calculate time already elapsed (operation might have started before we saw it)
    const alreadyElapsedMs = Date.now() - state.startedAt.getTime();

    // Schedule initial progress message
    const initialDelayMs = Math.max(0, this.config.initialThresholdMs - alreadyElapsedMs);
    state.initialTimer = setTimeout(() => {
      this.sendTimedProgressMessage(state, 'initial').catch((err) => {
        this.logger.error('Failed to send initial progress', {
          correlationId: state.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // After initial message, start periodic updates
      state.updateTimer = setInterval(() => {
        this.sendTimedProgressMessage(state, 'update').catch((err) => {
          this.logger.error('Failed to send update progress', {
            correlationId: state.correlationId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, this.config.updateIntervalMs);
    }, initialDelayMs);

    // Schedule timeout warning
    const timeoutDelayMs = Math.max(0, this.config.timeoutThresholdMs - alreadyElapsedMs);
    state.timeoutTimer = setTimeout(() => {
      this.sendTimedProgressMessage(state, 'timeout').catch((err) => {
        this.logger.error('Failed to send timeout progress', {
          correlationId: state.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, timeoutDelayMs);

    this.logger.debug('Progress timers scheduled', {
      correlationId: state.correlationId,
      alreadyElapsedMs,
      initialDelayMs,
      timeoutDelayMs,
    });
  }

  /**
   * Send progress message from timer callback.
   *
   * Wrapper around sendProgressMessage for timer-triggered progress.
   *
   * @param state - Operation state
   * @param stage - Progress stage
   */
  private async sendTimedProgressMessage(
    state: OperationState,
    stage: ProgressStage
  ): Promise<void> {
    // Check if operation still tracked (might have completed)
    if (!this.operationTracking.has(state.correlationId)) {
      this.logger.debug('Operation no longer tracked, skipping progress message', {
        correlationId: state.correlationId,
        stage,
      });
      return;
    }

    const elapsedMs = Date.now() - state.startedAt.getTime();
    await this.sendProgressMessage(state.sourceEvent, state, stage, elapsedMs);

    // Update state
    state.stage = stage;
    state.lastProgressAt = new Date();
  }

  /**
   * Send progress message for operation.
   */
  private async sendProgressMessage(
    event: InternalEventV2,
    state: OperationState,
    stage: ProgressStage,
    elapsedMs: number
  ): Promise<void> {
    try {
      if (this.config.useCustomMessages) {
        // Phase 2+: Create progress event for LLM-based generation
        await this.sendLLMProgressMessage(event, state, stage, elapsedMs);
      } else {
        // Phase 1: Send template message directly
        await this.sendTemplateMessage(event, state, stage, elapsedMs);
      }
    } catch (err) {
      this.logger.error('Failed to send progress message', {
        correlationId: event.correlationId,
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't throw - progress failures should not block operation
    }
  }

  /**
   * Send template-based progress message (Phase 1).
   */
  private async sendTemplateMessage(
    event: InternalEventV2,
    state: OperationState,
    stage: ProgressStage,
    elapsedMs: number
  ): Promise<void> {
    const templateMessage = TEMPLATE_MESSAGES[stage];
    const timestamp = new Date().toISOString();

    this.logger.info('Sending template progress message', {
      correlationId: event.correlationId,
      stage,
      elapsedMs,
      message: templateMessage,
    });

    // Create candidate for progress message
    const candidate: import('../../types/events').CandidateV1 = {
      id: `progress-${randomUUID()}`,
      kind: 'text',
      source: 'feedback-middleware',
      createdAt: timestamp,
      status: 'proposed',
      priority: 0, // Highest priority - progress messages should be immediate
      confidence: 1.0, // Template-based, deterministic
      text: templateMessage,
      format: 'plain',
      reason: `Progress feedback: ${stage} (${elapsedMs}ms elapsed)`,
      metadata: {
        progressStage: stage,
        elapsedMs,
        originalCorrelationId: event.correlationId,
      },
    };

    // Create chat message event with candidate
    const progressEvent: InternalEventV2 = {
      v: '2',
      correlationId: randomUUID(),
      type: 'chat.message.v1', // Correct event type for chat messages
      ingress: event.ingress,
      identity: event.identity,
      egress: event.egress,
      candidates: [candidate], // Use candidates array, not message field
      payload: {
        type: 'chat.message.v1',
      },
      routing: {
        stage: 'response',
        slip: [],
        history: [],
      },
      annotations: [
        {
          kind: 'progress_feedback',
          value: JSON.stringify({
            originalCorrelationId: event.correlationId,
            stage,
            elapsedMs,
          }),
          source: 'feedback-middleware',
          id: randomUUID(),
          createdAt: timestamp,
        },
      ],
    };

    await this.publishFn('internal.egress.v1', progressEvent);
  }

  /**
   * Send LLM-based progress message (Phase 2+).
   */
  private async sendLLMProgressMessage(
    event: InternalEventV2,
    state: OperationState,
    stage: ProgressStage,
    elapsedMs: number
  ): Promise<void> {
    // Generate prompt from template
    const prompt = this.renderPromptTemplate(state, stage, elapsedMs);

    this.logger.info('Sending LLM progress message', {
      correlationId: event.correlationId,
      stage,
      elapsedMs,
      operation: state.operationContext.operation,
    });

    // Create progress event using derived event utility
    const progressEvent = createProgressEvent(
      event,
      stage,
      {
        operation: state.operationContext.operation || 'unknown',
        parameters: state.operationContext.parameters || {},
        elapsedMs,
        startedAt: state.startedAt.toISOString(),
      },
      prompt,
      'feedback-middleware'
    );

    // Publish to internal.ingress.v1 for event-router to route to llm-bot
    await this.publishFn('internal.ingress.v1', progressEvent);
  }

  /**
   * Render prompt template with operation context.
   */
  private renderPromptTemplate(
    state: OperationState,
    stage: ProgressStage,
    elapsedMs: number
  ): string {
    return this.config.promptTemplate
      .replace('{originalMessage}', state.originalMessage)
      .replace('{operation}', state.operationContext.operation || 'unknown')
      .replace('{elapsedMs}', String(elapsedMs))
      .replace('{stage}', stage);
  }

  /**
   * Get current operation tracking stats (for debugging/monitoring).
   */
  getStats(): {
    activeOperations: number;
    operations: Array<{
      correlationId: string;
      operation: string;
      elapsedMs: number;
      stage: ProgressStage;
    }>;
  } {
    const now = Date.now();
    const operations = Array.from(this.operationTracking.values()).map((state) => ({
      correlationId: state.correlationId,
      operation: state.operationContext.operation || 'unknown',
      elapsedMs: now - state.startedAt.getTime(),
      stage: state.stage,
    }));

    return {
      activeOperations: operations.length,
      operations,
    };
  }
}
