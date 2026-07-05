/**
 * Reflex Executor for Reflex Bit
 *
 * Orchestrates the complete execution of a reflex:
 * 1. Build parameters from template + event
 * 2. Execute MCP tool via tool-gateway
 * 3. Build candidate response (if template provided)
 * 4. Track latency and update statistics
 * 5. Return execution result
 *
 * This is the main orchestration component that ties together all
 * the reflex services.
 */

import { Reflex, ReflexExecutionResult } from '../../types/reflex.js';
import { logger } from '../../common/logging';
import { InternalEventV2, CandidateV1 } from '../../types/events.js';
import { buildParameters } from './parameter-builder.js';
import { executeTool, ToolExecutionTimeoutError, ToolExecutionError } from './tool-executor.js';
import { buildCandidate } from './candidate-builder.js';

/**
 * Executes a reflex: builds parameters, calls tool, generates candidate.
 *
 * Process:
 * 1. Build parameters using parameter builder
 * 2. Execute MCP tool using tool executor
 * 3. Build candidate if candidateTemplate is defined
 * 4. Track execution latency
 * 5. Return result with success/error status
 *
 * Note: Statistics updates (successCount, errorCount) are handled by
 * the caller to avoid tight coupling with storage layer.
 *
 * @param reflex - Reflex to execute
 * @param event - Event being processed
 * @param config - Execution configuration
 * @param config.authToken - MCP authentication token (override)
 * @param config.correlationId - Correlation ID for tracing
 * @returns Execution result with status, result, candidate, latency
 *
 * @example
 * const result = await executeReflex(reflex, event, {
 *   correlationId: event.correlationId
 * });
 *
 * if (result.status === 'success') {
 *   console.log('Tool result:', result.result);
 *   if (result.candidate) {
 *     console.log('Generated candidate:', result.candidate.text);
 *   }
 * }
 */
export async function executeReflex(
  reflex: Reflex,
  event: InternalEventV2,
  config: {
    authToken?: string;
    correlationId?: string;
  } = {}
): Promise<ReflexExecutionResult> {
  const startTime = Date.now();
  const { authToken, correlationId = event.correlationId } = config;

  try {
    logger.info('[reflex-executor] Starting reflex execution:', {
      reflexId: reflex.id,
      reflexName: reflex.name,
      tool: reflex.action.tool,
      correlationId,
    });

    // Step 1: Build parameters from template + event
    const parameters = buildParameters(reflex.action.parameters, event);

    logger.debug('[reflex-executor] Parameters built:', {
      reflexId: reflex.id,
      tool: reflex.action.tool,
      parameters,
    });

    // Step 2: Execute MCP tool
    const toolResult = await executeTool(reflex.action.tool, parameters, {
      authToken,
      timeout: reflex.action.timeout || 5000,
      correlationId,
    });

    // Step 3: Build candidate if template provided
    let candidate: CandidateV1 | undefined;
    if (reflex.candidateTemplate) {
      try {
        candidate = buildCandidate(reflex.candidateTemplate, reflex, event, toolResult);
        logger.debug('[reflex-executor] Candidate generated:', {
          reflexId: reflex.id,
          candidateText: candidate.text,
        });
      } catch (error) {
        // Log error but don't fail execution
        logger.warn('[reflex-executor] Failed to build candidate:', {
          reflexId: reflex.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // candidate remains undefined
      }
    }

    // Step 4: Calculate latency
    const latency = Date.now() - startTime;

    // Step 5: Log success
    logger.info('[reflex-executor] Reflex execution successful:', {
      reflexId: reflex.id,
      reflexName: reflex.name,
      tool: reflex.action.tool,
      latency: `${latency}ms`,
      candidateGenerated: !!candidate,
      correlationId,
    });

    // Return success result
    return {
      status: 'success',
      result: toolResult,
      candidate,
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;

    // Build error details
    let errorDetails: {
      message: string;
      code?: string;
      stack?: string;
    };

    if (error instanceof ToolExecutionTimeoutError) {
      errorDetails = {
        message: error.message,
        code: 'TIMEOUT',
      };
    } else if (error instanceof ToolExecutionError) {
      errorDetails = {
        message: error.message,
        code: error.statusCode ? `HTTP_${error.statusCode}` : 'TOOL_ERROR',
        stack: error.stack,
      };
    } else if (error instanceof Error) {
      errorDetails = {
        message: error.message,
        code: 'UNKNOWN_ERROR',
        stack: error.stack,
      };
    } else {
      errorDetails = {
        message: String(error),
        code: 'UNKNOWN_ERROR',
      };
    }

    // Log error
    logger.error('[reflex-executor] Reflex execution failed:', {
      reflexId: reflex.id,
      reflexName: reflex.name,
      tool: reflex.action.tool,
      error: errorDetails.message,
      code: errorDetails.code,
      latency: `${latency}ms`,
      correlationId,
    });

    // Return error result
    return {
      status: 'error',
      error: errorDetails,
      latency,
    };
  }
}

/**
 * Validates a reflex before execution.
 *
 * Checks that all required fields are present and valid.
 *
 * @param reflex - Reflex to validate
 * @returns Validation result
 */
export function validateReflexForExecution(reflex: Reflex): {
  isValid: boolean;
  errors?: string[];
} {
  const errors: string[] = [];

  // Check required fields
  if (!reflex.id) {
    errors.push('Missing reflex ID');
  }

  if (!reflex.name) {
    errors.push('Missing reflex name');
  }

  if (!reflex.action) {
    errors.push('Missing action configuration');
  } else {
    if (!reflex.action.tool) {
      errors.push('Missing tool name in action');
    }

    if (!reflex.action.parameters) {
      errors.push('Missing parameters in action');
    }

    if (reflex.action.timeout !== undefined && reflex.action.timeout <= 0) {
      errors.push('Action timeout must be greater than 0');
    }
  }

  // Check match configuration
  if (!reflex.match) {
    errors.push('Missing match configuration');
  } else {
    if (!reflex.match.type) {
      errors.push('Missing match type');
    }

    if (!reflex.match.pattern) {
      errors.push('Missing match pattern');
    }

    if (!reflex.match.field) {
      errors.push('Missing match field');
    }
  }

  return {
    isValid: errors.length === 0,
    ...(errors.length > 0 && { errors }),
  };
}

/**
 * Estimates the execution time for a reflex.
 *
 * Based on configured timeout and average execution times.
 *
 * @param reflex - Reflex to estimate
 * @returns Estimated execution time in milliseconds
 */
export function estimateExecutionTime(reflex: Reflex): number {
  // Use configured timeout if available, otherwise default
  const timeout = reflex.action.timeout || 5000;

  // Add overhead for parameter building, candidate building, etc. (estimated 50ms)
  const overhead = 50;

  // Estimate is timeout + overhead (worst case)
  // In practice, most tools will complete much faster
  return timeout + overhead;
}

/**
 * Gets human-readable execution status description.
 *
 * @param result - Execution result
 * @returns Status description
 */
export function getExecutionStatusDescription(result: ReflexExecutionResult): string {
  if (result.status === 'success') {
    const parts = ['Execution successful'];
    if (result.candidate) {
      parts.push('candidate generated');
    }
    parts.push(`(${result.latency}ms)`);
    return parts.join(', ');
  } else {
    return `Execution failed: ${result.error?.message} (${result.latency}ms)`;
  }
}
