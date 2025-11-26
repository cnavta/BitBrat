/**
 * Subscriber Options Defaults (Pub/Sub oriented)
 *
 * Purpose:
 * - Provide a small helper to load sane default subscription options from environment variables.
 * - Keep this module transport-agnostic: it returns a plain object that drivers may interpret.
 *
 * Notes for LLM agents:
 * - These defaults are primarily tuned for GCP Pub/Sub. NATS JetStream exposes similar controls but via different APIs.
 * - If you need different defaults per service, prefer overriding via env rather than hardcoding in code.
 */

export interface SubscribeOptions {
  subscription: string;
  ackDeadlineSeconds?: number;     // default 30
  maxMessages?: number;            // flow control
  maxOutstandingBytes?: number;    // flow control
  parallelHandlers?: number;       // concurrency
  retryAttempts?: number;          // before DLQ
  backoffMs?: number[];            // e.g., [1000,2000,4000,8000]
}

export type Env = Record<string, string | undefined>;

/** Parse a number from string with fallback and basic validation. */
function parseNumber(v: string | undefined, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a comma-separated list of integers into a number[] with fallback. */
function parseNumberArray(v: string | undefined, fallback: number[]): number[] {
  if (!v) return fallback;
  const arr = v.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
  return arr.length ? arr : fallback;
}

export interface DefaultSet {
  ackDeadlineSeconds: number;
  maxMessages: number;
  maxOutstandingBytes: number;
  parallelHandlers: number;
  retryAttempts: number;
  backoffMs: number[];
}

export const DEFAULTS: DefaultSet = {
  ackDeadlineSeconds: 30,
  maxMessages: 10,
  maxOutstandingBytes: 10 * 1024 * 1024, // 10 MiB
  parallelHandlers: 1,
  retryAttempts: 5,
  backoffMs: [1000, 2000, 4000, 8000],
};

/**
 * Load subscriber options from environment variables.
 * Recognized variables (numeric unless noted):
 * - PUBSUB_ACK_DEADLINE_SECONDS
 * - PUBSUB_MAX_MESSAGES
 * - PUBSUB_MAX_OUTSTANDING_BYTES
 * - PUBSUB_PARALLEL_HANDLERS
 * - PUBSUB_RETRY_ATTEMPTS
 * - PUBSUB_BACKOFF_MS (comma-separated list of milliseconds)
 */
/**
 * Load and clamp subscription options from environment variables.
 *
 * Recognized environment variables (numeric unless noted):
 * - PUBSUB_ACK_DEADLINE_SECONDS
 * - PUBSUB_MAX_MESSAGES
 * - PUBSUB_MAX_OUTSTANDING_BYTES
 * - PUBSUB_PARALLEL_HANDLERS
 * - PUBSUB_RETRY_ATTEMPTS
 * - PUBSUB_BACKOFF_MS (comma-separated list of milliseconds)
 */
export function loadSubscriberOptionsFromEnv(subscription: string, env: Env = process.env): SubscribeOptions {
  const opts: SubscribeOptions = {
    subscription,
    ackDeadlineSeconds: parseNumber(env.PUBSUB_ACK_DEADLINE_SECONDS, DEFAULTS.ackDeadlineSeconds),
    maxMessages: parseNumber(env.PUBSUB_MAX_MESSAGES, DEFAULTS.maxMessages),
    maxOutstandingBytes: parseNumber(env.PUBSUB_MAX_OUTSTANDING_BYTES, DEFAULTS.maxOutstandingBytes),
    parallelHandlers: parseNumber(env.PUBSUB_PARALLEL_HANDLERS, DEFAULTS.parallelHandlers),
    retryAttempts: parseNumber(env.PUBSUB_RETRY_ATTEMPTS, DEFAULTS.retryAttempts),
    backoffMs: parseNumberArray(env.PUBSUB_BACKOFF_MS, DEFAULTS.backoffMs),
  };

  // Basic bounds to avoid dangerous configs
  if (opts.ackDeadlineSeconds! < 10) opts.ackDeadlineSeconds = 10;
  if (opts.ackDeadlineSeconds! > 600) opts.ackDeadlineSeconds = 600;
  if (opts.maxMessages! < 1) opts.maxMessages = 1;
  if (opts.maxMessages! > 1000) opts.maxMessages = 1000;
  if (opts.parallelHandlers! < 1) opts.parallelHandlers = 1;
  if (opts.retryAttempts! < 0) opts.retryAttempts = 0;

  return opts;
}
