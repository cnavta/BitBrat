/**
 * Utility Service Types
 * Sprint 27: Platform Utilities - Counters & Bidding
 *
 * Shared types and interfaces for counter and bidding functionality.
 */

import type { InternalEventV2 } from '../../types';

// ============================================================================
// SCOPE TYPES
// ============================================================================

/**
 * Scope type for counters and bidding sessions
 */
export type ScopeType = 'global' | 'stream' | 'user' | 'session' | 'custom';

/**
 * Resolved scope with type and value
 */
export interface ScopeResult {
  scopeType: ScopeType;
  scopeValue: string;
}

/**
 * Scope resolution parameters
 */
export interface ScopeParams {
  scopeType?: ScopeType;
  scopeValue?: string;
  event?: InternalEventV2; // For auto-inference from event context
}

// ============================================================================
// COUNTER TYPES
// ============================================================================

/**
 * Counter definition stored in DocumentStore
 * Collection: counter_definitions
 */
export interface CounterDefinition {
  id: string; // Format: {scopeType}:{scopeValue}:{name}
  name: string;
  scopeType: ScopeType;
  scopeValue: string;
  ttlSeconds?: number; // Optional expiration
  metadata: {
    description?: string;
    category?: string;
    icon?: string;
    displayFormat?: 'number' | 'currency' | 'percentage';
    tags?: string[];
    [key: string]: any; // Extensible metadata
  };
  createdAt: string; // ISO 8601
  expiresAt?: string; // ISO 8601 (computed from createdAt + ttlSeconds)
  createdBy: string; // User/service that created it
}

/**
 * Counter snapshot stored in DocumentStore
 * Collection: counter_snapshots
 */
export interface CounterSnapshot {
  id: string; // Auto-generated UUID
  counterId: string; // Reference to counter definition ID
  value: number;
  snapshotAt: string; // ISO 8601
  trigger: 'periodic' | 'manual' | 'expiration' | 'stream_end';
}

/**
 * Parameters for creating a counter
 */
export interface CreateCounterParams extends ScopeParams {
  name: string;
  initialValue?: number;
  ttlSeconds?: number;
  metadata?: Record<string, any>;
  createdBy?: string;
}

/**
 * Result of counter creation
 */
export interface CounterResult {
  success: boolean;
  counterId: string; // The generated ID
  key: string; // The Redis key
}

/**
 * Parameters for incrementing a counter
 */
export interface IncrementParams extends ScopeParams {
  name?: string; // Required if key not provided
  key?: string; // Direct key override
  delta?: number; // Default: 1
}

/**
 * Result of increment operation
 */
export interface IncrementResult {
  success: boolean;
  newValue: number;
  key: string;
}

/**
 * Parameters for decrementing a counter
 */
export interface DecrementParams extends ScopeParams {
  name?: string;
  key?: string;
  delta?: number; // Default: 1
}

/**
 * Result of decrement operation
 */
export interface DecrementResult {
  success: boolean;
  newValue: number;
  key: string;
}

/**
 * Parameters for getting a counter value
 */
export interface GetCounterParams extends ScopeParams {
  name?: string;
  key?: string;
}

/**
 * Result of get operation
 */
export interface GetCounterResult {
  success: boolean;
  value: number;
  key: string;
  metadata?: Record<string, any>;
}

/**
 * Parameters for setting a counter value
 */
export interface SetCounterParams extends ScopeParams {
  name?: string;
  key?: string;
  value: number;
}

/**
 * Result of set operation
 */
export interface SetCounterResult {
  success: boolean;
  value: number;
  key: string;
}

/**
 * Parameters for deleting a counter
 */
export interface DeleteCounterParams extends ScopeParams {
  name?: string;
  key?: string;
}

/**
 * Result of delete operation
 */
export interface DeleteCounterResult {
  success: boolean;
  key: string;
}

/**
 * Parameters for listing counters
 */
export interface ListCountersParams {
  scopeType?: ScopeType;
  scopeValue?: string;
  includeExpired?: boolean;
}

/**
 * Parameters for snapshotting a counter
 */
export interface SnapshotCounterParams extends ScopeParams {
  name?: string;
  key?: string;
  trigger?: 'periodic' | 'manual' | 'expiration' | 'stream_end';
}

/**
 * Result of snapshot operation
 */
export interface SnapshotCounterResult {
  success: boolean;
  snapshotId: string;
  value: number;
  snapshotAt: string;
}

// ============================================================================
// BIDDING TYPES (Phase 2 - Future)
// ============================================================================

/**
 * Bid session metadata stored in DocumentStore
 * Collection: bid_sessions
 */
export interface BidSession {
  id: string; // Format: {scopeType}:{scopeValue}:{name}
  name: string;
  scopeType: ScopeType;
  scopeValue: string;
  targetValue?: number; // Optional target for "closest" queries
  ttlSeconds?: number;
  metadata: {
    description?: string;
    rules?: string;
    prize?: string;
    [key: string]: any;
  };
  createdAt: string; // ISO 8601
  expiresAt?: string; // ISO 8601
  closedAt?: string; // ISO 8601 (when session was manually closed)
  createdBy: string;
}

/**
 * Bid entry (user submission)
 * Stored in Redis Hash during active session
 * Moved to DocumentStore in bid_results on session close
 */
export interface BidEntry {
  sessionId: string;
  userId: string;
  userName?: string;
  value: number;
  submittedAt: string; // ISO 8601
  metadata?: {
    platform?: string;
    correlationId?: string;
    [key: string]: any;
  };
}

/**
 * Bid results stored in DocumentStore after session close
 * Collection: bid_results
 */
export interface BidResult {
  id: string; // Format: {sessionId}:{timestamp}
  sessionId: string;
  closedAt: string; // ISO 8601
  totalEntries: number;
  winner?: string; // User ID of winner (if applicable)
  winningValue?: number;
  allEntries: Array<{
    user: string;
    value: number;
  }>;
}

/**
 * Parameters for creating a bid session
 */
export interface CreateBidSessionParams extends ScopeParams {
  name: string;
  targetValue?: number;
  ttlSeconds?: number;
  metadata?: Record<string, any>;
  createdBy?: string;
}

/**
 * Result of bid session creation
 */
export interface BidSessionResult {
  success: boolean;
  sessionId: string;
  sessionKey: string; // Redis hash key
}

/**
 * Parameters for submitting a bid
 */
export interface SubmitBidParams {
  session: string; // Session ID
  user: string; // User ID
  value: number;
}

/**
 * Result of bid submission
 */
export interface SubmitBidResult {
  success: boolean;
  entryId: string; // Format: {sessionId}:{userId}
  previousValue?: number; // Previous bid value if user is updating
}

/**
 * Parameters for getting max bid
 */
export interface GetMaxBidParams {
  session: string;
}

/**
 * Parameters for getting min bid
 */
export interface GetMinBidParams {
  session: string;
}

/**
 * Parameters for getting closest bid
 */
export interface GetClosestBidParams {
  session: string;
  target?: number; // Override session target
}

/**
 * Parameters for closing a bid session
 */
export interface CloseBidSessionParams {
  session: string;
}

/**
 * Result of session close
 */
export interface CloseBidSessionResult {
  success: boolean;
  closedAt: string;
  finalCount: number;
}
