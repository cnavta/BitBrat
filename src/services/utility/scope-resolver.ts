/**
 * ScopeResolver - Scope resolution logic for counters and bidding sessions
 * Sprint 27: Platform Utilities - Counters & Bidding
 *
 * Resolves scope (scopeType + scopeValue) from:
 * 1. Explicit parameters (priority 1)
 * 2. Auto-inference from event context (priority 2)
 * 3. Global scope default (priority 3)
 */

import type { Logger } from '../../common/logging';
import type { InternalEventV2 } from '../../types';
import type { ScopeType, ScopeResult, ScopeParams } from './types';

/**
 * Valid scope types for validation
 */
const VALID_SCOPE_TYPES: ScopeType[] = ['global', 'stream', 'user', 'session', 'custom'];

/**
 * ScopeResolver handles scope resolution logic
 *
 * Resolution priority:
 * 1. Explicit scopeType + scopeValue parameters
 * 2. Auto-inference from event context:
 *    - stream: ingress.channel
 *    - user: identity.user.id or identity.external.id
 * 3. Default to global scope
 *
 * Examples:
 * ```typescript
 * // Explicit scope (priority 1)
 * resolver.resolve({ scopeType: 'stream', scopeValue: 'bitbrat' })
 * // => { scopeType: 'stream', scopeValue: 'bitbrat' }
 *
 * // Auto-infer from event (priority 2)
 * resolver.resolve({ event: ingressEvent })
 * // => { scopeType: 'stream', scopeValue: 'bitbrat' } (from event.ingress.channel)
 *
 * // Default to global (priority 3)
 * resolver.resolve({})
 * // => { scopeType: 'global', scopeValue: 'global' }
 * ```
 */
export class ScopeResolver {
  constructor(private logger: Logger) {}

  /**
   * Resolve scope from parameters and/or event context
   *
   * @param params Scope parameters (explicit or for auto-inference)
   * @returns Resolved scope with type and value
   * @throws Error if scopeType is invalid
   */
  public resolve(params: ScopeParams): ScopeResult {
    // Priority 1: Explicit scope parameters
    if (params.scopeType && params.scopeValue) {
      this.validateScopeType(params.scopeType);

      this.logger.debug('scope.resolve.explicit', {
        scopeType: params.scopeType,
        scopeValue: params.scopeValue,
      });

      return {
        scopeType: params.scopeType,
        scopeValue: params.scopeValue,
      };
    }

    // Priority 2: Explicit scopeType with auto-inferred scopeValue
    if (params.scopeType && !params.scopeValue && params.event) {
      this.validateScopeType(params.scopeType);

      const scopeValue = this.inferScopeValue(params.scopeType, params.event);

      this.logger.debug('scope.resolve.explicit_type_inferred_value', {
        scopeType: params.scopeType,
        scopeValue,
      });

      return {
        scopeType: params.scopeType,
        scopeValue,
      };
    }

    // Priority 3: Auto-infer both scopeType and scopeValue from event
    if (params.event) {
      const inferred = this.inferFromEvent(params.event);

      this.logger.debug('scope.resolve.auto_inferred', {
        scopeType: inferred.scopeType,
        scopeValue: inferred.scopeValue,
      });

      return inferred;
    }

    // Priority 4: Default to global scope
    this.logger.debug('scope.resolve.default_global');

    return {
      scopeType: 'global',
      scopeValue: 'global',
    };
  }

  /**
   * Auto-infer scope from event context
   * Priority order:
   * 1. Stream scope (if ingress.channel available)
   * 2. User scope (if identity.user.id or identity.external.id available)
   * 3. Global scope (fallback)
   *
   * @param event Event to infer scope from
   * @returns Inferred scope
   */
  private inferFromEvent(event: InternalEventV2): ScopeResult {
    // Try stream scope first (highest priority)
    if (event.ingress?.channel) {
      return {
        scopeType: 'stream',
        scopeValue: event.ingress.channel,
      };
    }

    // Try user scope second
    const userId = event.identity?.user?.id || event.identity?.external?.id;
    if (userId) {
      return {
        scopeType: 'user',
        scopeValue: userId,
      };
    }

    // Fallback to global
    this.logger.debug('scope.infer_from_event.fallback_global', {
      reason: 'No channel or user ID found in event',
    });

    return {
      scopeType: 'global',
      scopeValue: 'global',
    };
  }

  /**
   * Infer scopeValue from event for a specific scopeType
   *
   * @param scopeType The scope type to infer value for
   * @param event Event to extract scope value from
   * @returns Inferred scope value
   * @throws Error if scope value cannot be inferred for the given type
   */
  private inferScopeValue(scopeType: ScopeType, event: InternalEventV2): string {
    switch (scopeType) {
      case 'stream':
        if (event.ingress?.channel) {
          return event.ingress.channel;
        }
        throw new Error(
          'Cannot infer stream scope value: event.ingress.channel is missing'
        );

      case 'user':
        const userId = event.identity?.user?.id || event.identity?.external?.id;
        if (userId) {
          return userId;
        }
        throw new Error(
          'Cannot infer user scope value: event.identity.user.id and event.identity.external.id are both missing'
        );

      case 'session':
        // Session scope requires explicit value (cannot infer from event)
        throw new Error(
          'Cannot infer session scope value: session scope requires explicit scopeValue parameter'
        );

      case 'custom':
        // Custom scope requires explicit value (cannot infer from event)
        throw new Error(
          'Cannot infer custom scope value: custom scope requires explicit scopeValue parameter'
        );

      case 'global':
        return 'global';

      default:
        throw new Error(`Unknown scope type: ${scopeType}`);
    }
  }

  /**
   * Validate scope type against allowed values
   *
   * @param scopeType Scope type to validate
   * @throws Error if scope type is invalid
   */
  private validateScopeType(scopeType: ScopeType): void {
    if (!VALID_SCOPE_TYPES.includes(scopeType)) {
      throw new Error(
        `Invalid scope type: ${scopeType}. Must be one of: ${VALID_SCOPE_TYPES.join(', ')}`
      );
    }
  }

  /**
   * Helper: Build counter/bid ID from scope
   * Format: {scopeType}:{scopeValue}:{name}
   *
   * @param scope Resolved scope
   * @param name Counter or bid session name
   * @returns Formatted ID string
   */
  public buildId(scope: ScopeResult, name: string): string {
    return `${scope.scopeType}:${scope.scopeValue}:${name}`;
  }

  /**
   * Helper: Build Redis key from scope
   * Format: {prefix}:{scopeType}:{scopeValue}:{name}
   *
   * @param prefix Key prefix (e.g., 'counter', 'bid:session')
   * @param scope Resolved scope
   * @param name Counter or bid session name
   * @returns Formatted Redis key
   */
  public buildKey(prefix: string, scope: ScopeResult, name: string): string {
    return `${prefix}:${scope.scopeType}:${scope.scopeValue}:${name}`;
  }
}
