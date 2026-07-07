/**
 * Condition Evaluator for Reflex Bit
 *
 * Evaluates filtering conditions for reflexes using AND logic.
 * All specified conditions must match for the reflex to be eligible.
 *
 * Supported conditions:
 * - eventTypes: Filter by event type
 * - channels: Filter by channel
 * - platforms: Filter by platform
 * - userRoles: Require specific user roles
 * - minAuthLevel: Require minimum authentication level
 */

import { ReflexCondition } from '../../types/reflex.js';
import { InternalEventV2 } from '../../types/events.js';

/**
 * Evaluates all conditions for a reflex against an event.
 *
 * Uses AND logic: ALL specified conditions must match.
 * If no conditions are specified, returns true (matches all events).
 *
 * @param event - Event to evaluate
 * @param conditions - Conditions to check (all must match)
 * @returns true if all conditions match (or no conditions specified)
 *
 * @example
 * const conditions = {
 *   eventTypes: ['chat.message.v1'],
 *   channels: ['#my-channel'],
 *   platforms: ['twitch']
 * };
 *
 * evaluateConditions(event, conditions) // true if all match
 */
export function evaluateConditions(
  event: InternalEventV2,
  conditions?: ReflexCondition
): boolean {
  // No conditions = match all
  if (!conditions) {
    return true;
  }

  // Check each condition type (AND logic)
  return (
    checkEventTypes(event, conditions.eventTypes) &&
    checkChannels(event, conditions.channels) &&
    checkPlatforms(event, conditions.platforms) &&
    checkUserRoles(event, conditions.userRoles) &&
    checkMinAuthLevel(event, conditions.minAuthLevel)
  );
}

/**
 * Checks if the event type matches one of the allowed types.
 *
 * @param event - Event to check
 * @param eventTypes - Allowed event types (undefined = no filter)
 * @returns true if event type matches or no filter specified
 *
 * @example
 * checkEventTypes(event, ['chat.message.v1', 'chat.command.v1'])
 */
function checkEventTypes(event: InternalEventV2, eventTypes?: string[]): boolean {
  if (!eventTypes || eventTypes.length === 0) {
    return true;
  }

  return eventTypes.includes(event.type);
}

/**
 * Checks if the event channel matches one of the allowed channels.
 *
 * @param event - Event to check
 * @param channels - Allowed channels (undefined = no filter)
 * @returns true if channel matches or no filter specified
 *
 * @example
 * checkChannels(event, ['#my-channel', '#other-channel'])
 */
function checkChannels(event: InternalEventV2, channels?: string[]): boolean {
  if (!channels || channels.length === 0) {
    return true;
  }

  const eventChannel = event.ingress?.channel;
  if (!eventChannel) {
    return false; // No channel in event, but channel filter specified
  }

  return channels.includes(eventChannel);
}

/**
 * Checks if the event platform matches one of the allowed platforms.
 *
 * @param event - Event to check
 * @param platforms - Allowed platforms (undefined = no filter)
 * @returns true if platform matches or no filter specified
 *
 * @example
 * checkPlatforms(event, ['twitch', 'discord'])
 */
function checkPlatforms(event: InternalEventV2, platforms?: string[]): boolean {
  if (!platforms || platforms.length === 0) {
    return true;
  }

  const eventPlatform = event.ingress?.connector;
  if (!eventPlatform) {
    return false; // No platform in event, but platform filter specified
  }

  return platforms.includes(eventPlatform);
}

/**
 * Checks if the user has at least one of the required roles.
 *
 * Checks both identity.user.roles (from auth service) and
 * identity.external.roles (from ingress/platform).
 *
 * @param event - Event to check
 * @param userRoles - Required roles (user must have at least one)
 * @returns true if user has any required role or no filter specified
 *
 * @example
 * checkUserRoles(event, ['moderator', 'broadcaster'])
 */
function checkUserRoles(event: InternalEventV2, userRoles?: string[]): boolean {
  if (!userRoles || userRoles.length === 0) {
    return true;
  }

  // Check authenticated user roles (from auth service)
  const authRoles = event.identity?.user?.roles || [];

  // Check platform-provided roles (from ingress)
  const externalRoles = event.identity?.external?.roles || [];

  // Combine both role sources
  const allRoles = [...authRoles, ...externalRoles];

  // User must have at least one of the required roles
  return userRoles.some(requiredRole => allRoles.includes(requiredRole));
}

/**
 * Checks if the user meets the minimum authentication level.
 *
 * Auth levels (conceptual mapping):
 * - 0: Anonymous/unauthenticated
 * - 1: External identity only (from platform)
 * - 2: Matched internal user (auth service enrichment)
 * - 3: Matched internal user with roles
 *
 * @param event - Event to check
 * @param minAuthLevel - Minimum required auth level (undefined = no filter)
 * @returns true if auth level meets minimum or no filter specified
 *
 * @example
 * checkMinAuthLevel(event, 2) // Requires matched internal user
 */
function checkMinAuthLevel(event: InternalEventV2, minAuthLevel?: number): boolean {
  if (minAuthLevel === undefined) {
    return true;
  }

  const currentLevel = getAuthLevel(event);
  return currentLevel >= minAuthLevel;
}

/**
 * Determines the current authentication level of an event.
 *
 * @param event - Event to analyze
 * @returns Auth level (0-3)
 */
function getAuthLevel(event: InternalEventV2): number {
  // Level 0: No identity
  if (!event.identity) {
    return 0;
  }

  // Level 1: Has external identity (from platform)
  if (event.identity.external && !event.identity.user) {
    return 1;
  }

  // Level 2: Has matched internal user (auth service enrichment)
  if (event.identity.user) {
    const hasRoles =
      (event.identity.user.roles && event.identity.user.roles.length > 0) ||
      (event.identity.external?.roles && event.identity.external.roles.length > 0);

    // Level 3: Has matched user with roles
    if (hasRoles) {
      return 3;
    }

    // Level 2: Has matched user but no roles
    return 2;
  }

  // Default: Level 0
  return 0;
}

/**
 * Gets a human-readable description of an auth level.
 *
 * @param level - Auth level (0-3)
 * @returns Description string
 */
export function getAuthLevelDescription(level: number): string {
  switch (level) {
    case 0:
      return 'Anonymous';
    case 1:
      return 'External identity only';
    case 2:
      return 'Matched internal user';
    case 3:
      return 'Matched internal user with roles';
    default:
      return `Unknown (${level})`;
  }
}

/**
 * Gets the current auth level for an event.
 * Exported for testing and debugging purposes.
 *
 * @param event - Event to analyze
 * @returns Auth level (0-3)
 */
export function getEventAuthLevel(event: InternalEventV2): number {
  return getAuthLevel(event);
}
