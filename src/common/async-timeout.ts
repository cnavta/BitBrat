/**
 * Small async helpers for bounding best-effort operations.
 *
 * Motivation: best-effort lookups in a request hot path (e.g. Firestore reads that
 * are already wrapped in try/catch and degrade gracefully on error) must not be
 * allowed to hang indefinitely when the backing service is slow or unreachable.
 * A bounded timeout converts an unbounded hang into the existing degraded path.
 */

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Resolve/reject with the underlying promise, but reject with a TimeoutError if it
 * does not settle within `ms` milliseconds. A non-positive `ms` disables the bound.
 *
 * The internal timer is unref'd so a pending timeout never keeps the process alive.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  if (!(ms > 0)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
