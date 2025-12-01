import { DocumentReference } from 'firebase-admin/firestore';
import { CommandDoc, userCooldownRef, rateWindowRef } from './command-repo';
import { logger } from '../../common/logging';

export interface PolicyDecision {
  allowed: boolean;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  updatedRuntime?: { lastExecutionAt?: string };
}

/** Compute the effective global cooldown in ms given doc and default. 0 disables. */
export function effectiveGlobalCooldownMs(doc: CommandDoc, defaultMs: number): number {
  const ms = doc?.cooldowns?.globalMs ?? defaultMs ?? 0;
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** Compute the effective per-user cooldown in ms given doc and default. 0 disables. */
export function effectivePerUserCooldownMs(doc: CommandDoc, defaultMs: number): number {
  const ms = doc?.cooldowns?.perUserMs ?? defaultMs ?? 0;
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Enforce global cooldown using a Firestore transaction.
 * - If within cooldown window, returns allowed=false (no write performed)
 * - If outside window (or disabled), updates runtime.lastExecutionAt and returns allowed=true
 */
export async function checkAndUpdateGlobalCooldown(
  commandRef: DocumentReference,
  doc: CommandDoc,
  now: Date,
  defaultGlobalMs: number,
  chosenTemplateId?: string
): Promise<PolicyDecision> {
  const cooldownMs = effectiveGlobalCooldownMs(doc, defaultGlobalMs);
  if (!cooldownMs) {
    return { allowed: true, details: { cooldownMs } };
  }
  const nowMs = now.getTime();
  try {
    let result: PolicyDecision = { allowed: true, details: { cooldownMs } };
    await (commandRef.firestore as any).runTransaction(async (tx: any) => {
      const snap = await tx.get(commandRef);
      const data = snap?.exists ? (snap.data() as any) : {};
      const lastIso: string | undefined = data?.runtime?.lastExecutionAt ? String(data.runtime.lastExecutionAt) : undefined;
      const lastMs = lastIso ? Date.parse(lastIso) : NaN;
      if (Number.isFinite(lastMs) && nowMs - lastMs < cooldownMs) {
        const remaining = cooldownMs - (nowMs - lastMs);
        result = {
          allowed: false,
          code: 'GLOBAL_COOLDOWN',
          message: 'Command is in global cooldown window',
          details: { cooldownMs, lastExecutionAt: lastIso, remainingMs: remaining },
        };
        return;
      }
      const newIso = new Date(nowMs).toISOString();
      const patch: any = { 'runtime.lastExecutionAt': newIso };
      if (chosenTemplateId) patch['runtime.lastUsedTemplateId'] = String(chosenTemplateId);
      tx.update(commandRef, patch);
      result = { allowed: true, details: { cooldownMs }, updatedRuntime: { lastExecutionAt: newIso } };
    });
    if (!result.allowed) {
      logger.info('command_processor.policy.blocked', { code: result.code, ...result.details });
    }
    return result;
  } catch (e: any) {
    // Surface error to caller to decide nack/ack policy
    logger.error('command_processor.policy.global_cooldown.error', { error: e?.message || String(e) });
    throw e;
  }
}

/**
 * Enforce per-user cooldown using a Firestore transaction.
 * - Reads cooldowns/users/{userId}.lastExecutionAt
 * - If within window: allowed=false
 * - Else: set lastExecutionAt=now and allowed=true
 */
export async function checkAndUpdateUserCooldown(
  commandRef: DocumentReference,
  doc: CommandDoc,
  userId: string,
  now: Date,
  defaultUserMs: number
): Promise<PolicyDecision> {
  const cooldownMs = effectivePerUserCooldownMs(doc, defaultUserMs);
  if (!cooldownMs) return { allowed: true, details: { cooldownMs, userId } };
  const nowMs = now.getTime();
  try {
    let decision: PolicyDecision = { allowed: true, details: { cooldownMs, userId } };
    const subRef = userCooldownRef(commandRef, String(userId));
    await (commandRef.firestore as any).runTransaction(async (tx: any) => {
      const snap = await tx.get(subRef);
      const data = snap?.exists ? (snap.data() as any) : {};
      const lastIso: string | undefined = data?.lastExecutionAt ? String(data.lastExecutionAt) : undefined;
      const lastMs = lastIso ? Date.parse(lastIso) : NaN;
      if (Number.isFinite(lastMs) && nowMs - lastMs < cooldownMs) {
        const remaining = cooldownMs - (nowMs - lastMs);
        decision = {
          allowed: false,
          code: 'USER_COOLDOWN',
          message: 'User is in per-user cooldown window',
          details: { cooldownMs, lastExecutionAt: lastIso, remainingMs: remaining, userId },
        };
        return;
      }
      const newIso = new Date(nowMs).toISOString();
      if (snap?.exists) {
        tx.update(subRef, { lastExecutionAt: newIso });
      } else {
        tx.set(subRef, { lastExecutionAt: newIso }, { merge: true });
      }
      decision = { allowed: true, details: { cooldownMs, userId } };
    });
    if (!decision.allowed) {
      logger.info('command_processor.policy.blocked', { code: decision.code, ...decision.details });
    }
    return decision;
  } catch (e: any) {
    logger.error('command_processor.policy.user_cooldown.error', { error: e?.message || String(e) });
    throw e;
  }
}

export interface RateLimitConfig { max: number; perMs: number }

/** Compute the effective rate limit for a command, or null/disabled if max <= 0. */
export function effectiveRateLimit(doc: CommandDoc, defaults: { max: number; perMs: number }): RateLimitConfig | null {
  const max = (doc?.rateLimit?.max ?? defaults.max ?? 0) | 0;
  const perMs = (doc?.rateLimit?.perMs ?? defaults.perMs ?? 60000) | 0;
  if (!Number.isFinite(max) || max <= 0) return null;
  return { max: Math.trunc(max), perMs: Math.max(1, Math.trunc(perMs || 60000)) };
}

/** Given now and window length, compute the fixed-window key and start ISO timestamp. */
export function currentWindowKey(now: Date, perMs: number): { key: string; windowStartIso: string } {
  const ms = now.getTime();
  const start = Math.floor(ms / perMs) * perMs;
  const iso = new Date(start).toISOString();
  return { key: `${iso}@${perMs}`, windowStartIso: iso };
}

/**
 * Enforce fixed-window rate limiting using a Firestore transaction.
 * - Window doc path: rate-limits/windows/byKey/{windowKey}
 * - Behavior: allow while count < max, then increment; when >= max deny without write.
 */
export async function checkAndUpdateRateLimit(
  commandRef: DocumentReference,
  doc: CommandDoc,
  now: Date,
  defaults: { max: number; perMs: number }
): Promise<PolicyDecision> {
  const cfg = effectiveRateLimit(doc, defaults);
  if (!cfg) return { allowed: true, details: { rate: { max: 0 } } };
  const { key, windowStartIso } = currentWindowKey(now, cfg.perMs);
  try {
    let decision: PolicyDecision = { allowed: true, details: { rate: cfg, windowKey: key } };
    const subRef = rateWindowRef(commandRef, key);
    await (commandRef.firestore as any).runTransaction(async (tx: any) => {
      const snap = await tx.get(subRef);
      const exists = !!snap?.exists;
      const data = exists ? (snap.data() as any) : undefined;
      const count = Number(exists ? data?.count ?? 0 : 0);
      if (count >= cfg.max) {
        decision = {
          allowed: false,
          code: 'RATE_LIMIT',
          message: 'Command rate limit exceeded for current window',
          details: { rate: cfg, windowKey: key, count },
        };
        return;
      }
      if (exists) {
        tx.update(subRef, { count: count + 1 });
      } else {
        tx.set(subRef, { count: 1, windowStartAt: windowStartIso }, { merge: true });
      }
      decision = { allowed: true, details: { rate: cfg, windowKey: key, count: count + 1 } };
    });
    if (!decision.allowed) {
      logger.info('command_processor.policy.blocked', { code: decision.code, ...(decision.details || {}) });
    }
    return decision;
  } catch (e: any) {
    logger.error('command_processor.policy.rate_limit.error', { error: e?.message || String(e) });
    throw e;
  }
}
