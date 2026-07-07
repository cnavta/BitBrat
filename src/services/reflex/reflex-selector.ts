/**
 * Reflex Selector for Reflex Bit
 *
 * Selects the highest-priority matching reflex from a list of candidates.
 *
 * Process:
 * 1. Filter to only active reflexes
 * 2. Sort by priority (lower number = higher priority)
 * 3. Find first match using reflex matcher
 * 4. Return first match (Phase 1 behavior)
 *
 * Phase 1 limitation: Returns only the first match. Future phases may
 * support multiple matches or chaining.
 */

import { Reflex } from '../../types/reflex.js';
import { logger } from '../../common/logging';
import { InternalEventV2 } from '../../types/events.js';
import { matchReflex } from './reflex-matcher.js';

/**
 * Selects matching reflexes from a list, prioritized by priority field.
 *
 * Phase 1 behavior: Returns at most one reflex (the highest priority match).
 * Empty array if no match found.
 *
 * @param event - Event to match against
 * @param reflexes - List of all available reflexes
 * @returns Array containing the first matching reflex, or empty array
 *
 * @example
 * const reflexes = [
 *   { id: 'r1', priority: 10, active: true, ... },
 *   { id: 'r2', priority: 20, active: true, ... },
 *   { id: 'r3', priority: 5, active: false, ... }
 * ];
 *
 * selectReflexes(event, reflexes) // [r1] if matches, [] if no match
 */
export function selectReflexes(event: InternalEventV2, reflexes: Reflex[]): Reflex[] {
  const startTime = performance.now();

  try {
    // Step 1: Filter to only active reflexes
    const activeReflexes = reflexes.filter(reflex => reflex.active);

    if (activeReflexes.length === 0) {
      logSelection(event, reflexes.length, 0, 0, performance.now() - startTime);
      return [];
    }

    // Step 2: Sort by priority (ascending - lower number = higher priority)
    const sortedReflexes = activeReflexes.sort((a, b) => a.priority - b.priority);

    // Step 3: Find first match
    for (const reflex of sortedReflexes) {
      if (matchReflex(event, reflex)) {
        const latency = performance.now() - startTime;
        logSelection(
          event,
          reflexes.length,
          activeReflexes.length,
          1,
          latency,
          reflex.id,
          reflex.name
        );
        return [reflex]; // Phase 1: Return only first match
      }
    }

    // No matches found
    logSelection(event, reflexes.length, activeReflexes.length, 0, performance.now() - startTime);
    return [];
  } catch (error) {
    logger.error('reflex.selector.error', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Logs reflex selection results for monitoring and debugging.
 *
 * @param event - Event being processed
 * @param totalCount - Total number of reflexes considered
 * @param activeCount - Number of active reflexes
 * @param matchCount - Number of matches found (0 or 1 in Phase 1)
 * @param latency - Time taken in milliseconds
 * @param matchedId - ID of matched reflex (if any)
 * @param matchedName - Name of matched reflex (if any)
 */
function logSelection(
  event: InternalEventV2,
  totalCount: number,
  activeCount: number,
  matchCount: number,
  latency: number,
  matchedId?: string,
  matchedName?: string
): void {
  const logData = {
    eventType: event.type,
    correlationId: event.correlationId,
    totalReflexes: totalCount,
    activeReflexes: activeCount,
    matchCount,
    latency: `${latency.toFixed(2)}ms`,
    ...(matchedId && { matchedReflexId: matchedId }),
    ...(matchedName && { matchedReflexName: matchedName }),
  };

  if (matchCount > 0) {
    logger.info('[reflex-selector] Reflex matched:', logData);
  } else if (activeCount === 0) {
    logger.debug('[reflex-selector] No active reflexes:', logData);
  } else {
    logger.debug('[reflex-selector] No reflex matched:', logData);
  }
}

/**
 * Gets the count of active reflexes from a list.
 *
 * Useful for monitoring and health checks.
 *
 * @param reflexes - List of reflexes
 * @returns Number of active reflexes
 */
export function getActiveReflexCount(reflexes: Reflex[]): number {
  return reflexes.filter(reflex => reflex.active).length;
}

/**
 * Gets statistics about a reflex list.
 *
 * Useful for monitoring and debugging.
 *
 * @param reflexes - List of reflexes
 * @returns Statistics object
 *
 * @example
 * getReflexStats(reflexes)
 * // {
 * //   total: 100,
 * //   active: 85,
 * //   inactive: 15,
 * //   byPriority: { '10': 5, '20': 10, ... }
 * // }
 */
export function getReflexStats(reflexes: Reflex[]): {
  total: number;
  active: number;
  inactive: number;
  byPriority: Record<number, number>;
} {
  const stats = {
    total: reflexes.length,
    active: 0,
    inactive: 0,
    byPriority: {} as Record<number, number>,
  };

  for (const reflex of reflexes) {
    if (reflex.active) {
      stats.active++;
    } else {
      stats.inactive++;
    }

    const priority = reflex.priority;
    stats.byPriority[priority] = (stats.byPriority[priority] || 0) + 1;
  }

  return stats;
}
