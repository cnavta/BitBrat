/**
 * Reflex Matcher for Reflex Bit
 *
 * Determines if a single reflex matches an event by combining:
 * 1. Condition evaluation (filters based on eventType, channel, platform, etc.)
 * 2. Pattern matching (checks if the field value matches the pattern)
 *
 * Early exit optimization: If conditions don't match, skip pattern matching.
 */

import { Reflex } from '../../types/reflex.js';
import { logger } from '../../common/logging';
import { InternalEventV2 } from '../../types/events.js';
import { evaluateConditions } from './condition-evaluator.js';
import { matchPattern } from './pattern-matcher.js';
import { getFieldValue } from './field-accessor.js';

/**
 * Determines if a reflex matches an event.
 *
 * Process:
 * 1. Early exit: Check if conditions match (fast filter)
 * 2. Extract field value from event
 * 3. Apply pattern matching to field value
 *
 * @param event - Event to test
 * @param reflex - Reflex rule to match against
 * @returns true if reflex matches the event
 *
 * @example
 * const reflex = {
 *   match: { type: 'exact', pattern: '!fail', field: 'message.text' },
 *   conditions: { eventTypes: ['chat.message.v1'], platforms: ['twitch'] }
 * };
 *
 * matchReflex(event, reflex) // true if all conditions and pattern match
 */
export function matchReflex(event: InternalEventV2, reflex: Reflex): boolean {
  const startTime = performance.now();

  try {
    // Step 1: Evaluate conditions first (early exit if they don't match)
    const conditionsMatch = evaluateConditions(event, reflex.conditions);

    if (!conditionsMatch) {
      logMatchAttempt(reflex, event, false, performance.now() - startTime, 'conditions_failed');
      return false;
    }

    // Step 2: Extract field value from event
    const fieldValue = getFieldValue(event, reflex.match.field);

    // If field doesn't exist or isn't a string, no match
    if (fieldValue === undefined || fieldValue === null) {
      logMatchAttempt(
        reflex,
        event,
        false,
        performance.now() - startTime,
        'field_missing',
        reflex.match.field
      );
      return false;
    }

    // Convert to string for pattern matching
    const stringValue = String(fieldValue);

    // Step 3: Apply pattern matching
    const patternMatches = matchPattern(stringValue, reflex.match.pattern, reflex.match.type, {
      caseSensitive: reflex.match.caseSensitive,
      flags: reflex.match.flags,
    });

    const latency = performance.now() - startTime;

    if (patternMatches) {
      logMatchAttempt(reflex, event, true, latency, 'success');
    } else {
      logMatchAttempt(reflex, event, false, latency, 'pattern_mismatch');
    }

    return patternMatches;
  } catch (error) {
    // Log error but don't throw - gracefully return false
    logger.error('reflex.matcher.error', {
      reflexId: reflex.id,
      reflexName: reflex.name,
      error: error instanceof Error ? error.message : String(error)
    });
    logMatchAttempt(
      reflex,
      event,
      false,
      performance.now() - startTime,
      'error',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Logs a match attempt for debugging and monitoring.
 *
 * Uses debug level for normal operations, warn for slow matches.
 *
 * @param reflex - Reflex being evaluated
 * @param event - Event being matched
 * @param matched - Whether the reflex matched
 * @param latency - Time taken in milliseconds
 * @param reason - Reason for match/no-match
 * @param details - Additional details
 */
function logMatchAttempt(
  reflex: Reflex,
  event: InternalEventV2,
  matched: boolean,
  latency: number,
  reason: string,
  details?: string
): void {
  const logData = {
    reflexId: reflex.id,
    reflexName: reflex.name,
    eventType: event.type,
    correlationId: event.correlationId,
    matched,
    reason,
    latency: `${latency.toFixed(2)}ms`,
    ...(details && { details }),
  };

  // Warn if matching is slow (>10ms is our target)
  if (latency > 10) {
    logger.warn('[reflex-matcher] Slow match evaluation:', logData);
  } else {
    logger.debug('[reflex-matcher] Match evaluation:', logData);
  }
}

/**
 * Checks if a reflex would match an event, without logging.
 *
 * Useful for testing or dry-run scenarios.
 *
 * @param event - Event to test
 * @param reflex - Reflex rule to match against
 * @returns true if reflex matches the event
 */
export function matchReflexSilent(event: InternalEventV2, reflex: Reflex): boolean {
  try {
    // Evaluate conditions
    if (!evaluateConditions(event, reflex.conditions)) {
      return false;
    }

    // Extract and validate field value
    const fieldValue = getFieldValue(event, reflex.match.field);
    if (fieldValue === undefined || fieldValue === null) {
      return false;
    }

    // Apply pattern matching
    return matchPattern(String(fieldValue), reflex.match.pattern, reflex.match.type, {
      caseSensitive: reflex.match.caseSensitive,
      flags: reflex.match.flags,
    });
  } catch {
    return false;
  }
}
