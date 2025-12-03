/**
 * Retry helpers with exponential backoff and jitter
 * Sprint 74 (prompt-id: 2025-10-15-s74-continue)
 */

export type RetryOptions = {
  attempts?: number; // max attempts including first
  baseDelayMs?: number; // initial backoff
  maxDelayMs?: number; // cap
  jitter?: boolean; // true => randomize delay, false => deterministic
  shouldRetry?: (err: any, attempt: number) => boolean; // return false to stop retrying
};

export type RetryAsyncOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number; // if 0, disable jitter for deterministic tests
  shouldRetry?: (err: any, attempt: number) => boolean;
};

function sleep(ms: number): Promise<void> {
  // Clamp to avoid Node TimeoutNegativeWarning and non-integer values
  const delay = Number.isFinite(ms) ? Math.max(1, Math.ceil(ms)) : 1;
  return new Promise((r) => setTimeout(r, delay));
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 5);
  const base = Math.max(1, opts.baseDelayMs ?? 250);
  const cap = Math.max(base, opts.maxDelayMs ?? 5000);
  const jitter = opts.jitter !== false; // default true

  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const attemptNum = i + 1;
      if (opts.shouldRetry && !opts.shouldRetry(e, attemptNum)) break;
      if (i === attempts - 1) break;
      let delay = Math.min(cap, base * Math.pow(2, i));
      if (jitter) {
        const rnd = 0.5 + Math.random(); // 0.5x to 1.5x
        delay = Math.min(cap, Math.floor(delay * rnd));
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function retryAsync<T>(fn: () => Promise<T>, opts: RetryAsyncOptions = {}): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs, jitterMs, shouldRetry } = opts;
  return withBackoff(fn, { attempts, baseDelayMs, maxDelayMs, jitter: !(jitterMs === 0), shouldRetry });
}

export function isTransientError(err: any): boolean {
  try {
    const status = Number(err?.status || err?.statusCode || err?.response?.status || err?.httpStatus);
    if (!Number.isNaN(status)) {
      if (status === 429) return true;
      if (status >= 500) return true;
    }
    const code = String(err?.code || '').toUpperCase();
    const name = String(err?.name || '').toUpperCase();
    const msg = String(err?.message || '');
    const transientCodes = ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNABORTED', 'EPIPE'];
    if (transientCodes.includes(code)) return true;
    if (/TIMEOUT/i.test(name) || /TIMEOUT/i.test(code)) return true;
    if (/timeout/i.test(msg)) return true;
    if (/temporar(y|ily) unavailable/i.test(msg)) return true;
    if (/rate limit/i.test(msg)) return true;
    const rType = String(err?.type || err?.error?.type || '').toLowerCase();
    if (['server_error', 'temporary_unavailable', 'throttled'].includes(rType)) return true;
  } catch {
    // ignore classifier errors
  }
  return false;
}

/**
 * Compute an exponential backoff schedule with optional jitter and cap. Pure function for testing.
 * attempts: number of delays to produce (e.g., 3 => [base, 2x, 4x])
 * baseDelayMs: starting delay in ms
 * maxDelayMs: optional cap; values won't exceed this
 * jitterRatio: 0..1, where 0 means deterministic, 0.2 means ±20% randomization
 */
export function computeBackoffSchedule(
  attempts: number,
  baseDelayMs = 250,
  maxDelayMs = 5000,
  jitterRatio = 0.5,
): number[] {
  const out: number[] = [];
  const count = Math.max(0, Math.floor(attempts));
  const base = Math.max(1, Math.floor(baseDelayMs));
  const cap = Math.max(base, Math.floor(maxDelayMs));
  const jr = Math.max(0, Math.min(1, Number(jitterRatio)));
  for (let i = 0; i < count; i++) {
    const ideal = Math.min(cap, base * Math.pow(2, i));
    if (jr === 0) {
      out.push(ideal);
    } else {
      const jitter = ideal * jr;
      const val = Math.min(cap, Math.floor(ideal + (Math.random() * 2 * jitter - jitter)));
      out.push(Math.max(1, val));
    }
  }
  return out;
}
