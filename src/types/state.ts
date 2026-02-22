/**
 * Sprint 254 — Agent State Memory Types
 * Defines the core schemas for the Graph + Mutation Event model.
 */

export type MutationOp = 'set' | 'delete' | 'increment' | 'push';

/**
 * MutationProposal
 * Represents a request to change a specific state key.
 * Published to NATS internal.state.mutation.v1.
 */
export interface MutationProposal {
  id: string;              // uuid-v4
  op: MutationOp;          // operation type
  key: string;             // e.g., "stream.state"
  value: any;              // new value
  actor: string;           // e.g., "ingress-egress:twitch", "llm-bot"
  reason: string;          // human/agent-readable reason for the change
  expectedVersion?: number; // for optimistic concurrency control
  ts: string;              // ISO8601 timestamp
  ttl?: number;            // optional expiration in seconds
  metadata?: Record<string, any>;
}

/**
 * StateSnapshot
 * Represents the current authoritative truth for a state key.
 * Stored in Firestore 'state' collection.
 */
export interface StateSnapshot {
  value: any;
  updatedAt: string;       // ISO8601
  updatedBy: string;       // actor name
  version: number;         // incremented on every change
  ttl?: number | null;     // null if no expiration
  metadata?: {
    source: string;
    [key: string]: any;
  };
}

/**
 * MutationLogEntry
 * Represents a committed mutation in the history.
 * Stored in Firestore 'mutation_log' collection.
 */
export interface MutationLogEntry extends MutationProposal {
  committedAt: string;     // ISO8601
  status: 'accepted' | 'rejected';
  error?: string;          // error message if rejected
  resultingVersion?: number;
}

// Topic/Subject constants
export const INTERNAL_STATE_MUTATION_V1 = 'internal.state.mutation.v1';
