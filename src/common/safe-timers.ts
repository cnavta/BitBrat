/**
 * safe-timers
 *
 * Mitigates Node's TimeoutNegativeWarning by clamping negative/invalid delays
 * passed to setTimeout/setInterval to a minimum of 1ms.
 *
 * This module patches the global timer functions when imported.
 */

import { logger } from './logging';

let warned = false;

export function normalizeDelay(ms: any): number {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 1;
  // Round up fractional delays to the nearest millisecond
  return Math.ceil(n);
}

function warnOnce(original: any) {
  if (!warned) {
    warned = true;
    try {
      logger.warn('safe_timers.negative_delay_detected', { note: 'Clamping to 1ms to avoid TimeoutNegativeWarning' });
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[safe-timers] Clamped negative/invalid delay to 1ms to avoid TimeoutNegativeWarning');
    }
  }
  return original;
}

function install() {
  // Capture current references to allow restoration if needed, but maintain compatibility with Jest by
  // skipping installation under test environments.
  const _setTimeout = global.setTimeout.bind(global);
  const _setInterval = global.setInterval.bind(global);

  // Patch global setTimeout
  (global as any).setTimeout = (handler: any, timeout?: any, ...args: any[]) => {
    const isBad = !(Number.isFinite(Number(timeout)) && Number(timeout) > 0);
    const ms = normalizeDelay(timeout);
    if (isBad) warnOnce(_setTimeout);
    return _setTimeout(handler as any, ms, ...args);
  };

  // Patch global setInterval
  (global as any).setInterval = (handler: any, timeout?: any, ...args: any[]) => {
    const isBad = !(Number.isFinite(Number(timeout)) && Number(timeout) > 0);
    const ms = normalizeDelay(timeout);
    if (isBad) warnOnce(_setInterval);
    return _setInterval(handler as any, ms, ...args);
  };
}

// Only install in non-test environments to avoid conflicts with Jest fake timers
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  install();
}

// Note: setImmediate does not take a delay and does not need patching.

export default null;
