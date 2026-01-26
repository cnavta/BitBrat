/**
 * JsonLogic Evaluator
 *
 * Provides utilities to build an evaluation context from an InternalEventV2
 * and to evaluate JsonLogic expressions safely (malformed logic returns false).
 *
 * Custom JsonLogic operators registered here (idempotent):
 * - ci_eq(a, b): boolean — case-insensitive equality; null/undefined → ''
 * - re_test(value, pattern[, flags]) or re_test(value, [pattern, flags]): boolean — regex test with safe caching
 * - slip_complete(routingSlip?): boolean — true if routing slip is fully complete
 * - has_role(roles, role[, ci]): boolean — membership test in roles array; optional case-insensitive
 * - has_annotation(annotationsOrEvent, key[, value]): boolean — presence of annotation by label/value
 * - has_candidate(candidatesOrEvent[, provider]): boolean — presence of candidate; optional filter by provider/source
 * - text_contains(value, needle[, ci]): boolean — substring test; optional case-insensitive
 */
import type {Egress, InternalEventV2} from '../../types/events';
import type { IConfig } from '../../types';

// json-logic-js does not ship perfect TS types in all versions; use a safe import
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsonLogic: any = require('json-logic-js');

export interface EvalContext extends Record<string, any> {
  type: string;
  channel?: string;
  userId?: string;
  user?: any;
  // Back-compat fields to ease rule expressions during V1→V2 migration:
  // - payload maps to message.rawPlatformPayload
  // - envelope-like fields are exposed at top-level where useful
  payload: Record<string, any>;
  v?: string;
  source?: string;
  correlationId?: string;
  traceId?: string;
  message?: any;
  egress?: Egress;
  annotations?: any[];
  candidates?: any[];
  routingSlip?: any[];
  config?: IConfig;
  now: string; // ISO8601
  ts: number; // epoch ms
}

/** Build a deterministic evaluation context for JsonLogic from an InternalEventV2. */
export function buildContext(evt: InternalEventV2, nowIso?: string, ts?: number, config?: IConfig): EvalContext {
  const now = nowIso || new Date().toISOString();
  const n = typeof ts === 'number' ? ts : Date.now();
  return {
    ...evt,
    payload: evt.message?.rawPlatformPayload || evt.payload || {},
    config,
    now,
    ts: n,
  } as any;
}

/**
 * Evaluate a JsonLogic expression against the provided context.
 * Accepts either an object (native JsonLogic) or a JSON string representation of it.
 * Returns boolean; any error or non-boolean result is coerced to false.
 */
export function evaluate(logic: unknown, context: EvalContext): boolean {
  try {
    // Normalize logic when stored as a string (Firestore recommendation)
    let expr: any = null;
    if (typeof logic === 'string') {
      try {
        expr = JSON.parse(logic);
      } catch {
        return false; // invalid JSON string
      }
    } else if (logic && typeof logic === 'object') {
      expr = logic as any;
    } else {
      return false;
    }

    registerOperatorsOnce();
    const result = jsonLogic.apply(expr, context);
    return result === true || result === 1;
  } catch {
    // Malformed logic should not throw; treat as non-match
    return false;
  }
}

export default { buildContext, evaluate };

// ---------------------------
// Custom operators
// ---------------------------

let __opsRegistered = false;

function toText(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function safeArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

const reCache: Record<string, RegExp> = Object.create(null);

function getRegex(pattern: any, flags?: any): RegExp | null {
  const pat = toText(pattern);
  const fl = flags ? toText(flags) : '';
  const key = `${pat}|${fl}`;
  if (reCache[key]) return reCache[key];
  try {
    const r = new RegExp(pat, fl);
    reCache[key] = r;
    return r;
  } catch {
    return null;
  }
}

/** Idempotently register custom JsonLogic operators. */
export function registerOperatorsOnce(): void {
  if (__opsRegistered) return;
  // ci_eq: case-insensitive equality
  jsonLogic.add_operation('ci_eq', (a: any, b: any) => {
    const aa = toText(a).toLowerCase();
    const bb = toText(b).toLowerCase();
    return aa === bb;
  });

  // re_test: regex test; supports (value, pattern[, flags]) or (value, [pattern, flags])
  jsonLogic.add_operation('re_test', (value: any, pattern: any, flags?: any) => {
    const text = toText(value);
    let pat: any = pattern;
    let fl: any = flags;
    if (Array.isArray(pattern)) {
      pat = pattern[0];
      fl = pattern[1];
    }
    const rx = getRegex(pat, fl);
    if (!rx) return false;
    try {
      return rx.test(text);
    } catch {
      return false;
    }
  });

  // slip_complete: expects routingSlip array as first arg; if omitted/invalid → false
  jsonLogic.add_operation('slip_complete', (slip: any) => {
    const arr: any[] = Array.isArray(slip) ? slip : [];
    if (arr.length === 0) return false;
    // If any PENDING or ERROR exists, not complete
    for (const s of arr) {
      const st = (s?.status || '').toUpperCase();
      if (st === 'PENDING' || st === 'ERROR') return false;
    }
    // If last OK step is terminal (no nextTopic), consider complete
    const oks = arr.filter((s) => (s?.status || '').toUpperCase() === 'OK');
    if (oks.length === 0) return false;
    const lastOk = oks[oks.length - 1];
    const terminal = !lastOk?.nextTopic;
    if (terminal) return true;
    // Otherwise, if all steps are OK (no SKIP), consider complete
    const allOk = arr.every((s) => (s?.status || '').toUpperCase() === 'OK');
    return allOk;
  });

  // has_role: roles array contains role (optionally case-insensitive third param)
  jsonLogic.add_operation('has_role', (roles: any, role: any, ci?: any) => {
    const rlist = safeArray(roles).map((r) => toText(r));
    const needle = toText(role);
    const caseInsensitive = ci === true || toText(ci).toLowerCase() === 'true';
    if (caseInsensitive) {
      const n = needle.toLowerCase();
      return rlist.some((r) => r.toLowerCase() === n);
    }
    return rlist.includes(needle);
  });

  // text_contains: substring search with optional ci
  jsonLogic.add_operation('text_contains', (value: any, needle: any, ci?: any) => {
    const hay = toText(value);
    const ndl = toText(needle);
    const caseInsensitive = ci === true || toText(ci).toLowerCase() === 'true';
    if (caseInsensitive) return hay.toLowerCase().includes(ndl.toLowerCase());
    return hay.includes(ndl);
  });

  // has_annotation: accepts (annotationsOrEvent, key[, value])
  jsonLogic.add_operation('has_annotation', (annsOrEvt: any, key: any, val?: any) => {
    let anns: any[] = [];
    if (Array.isArray(annsOrEvt)) anns = annsOrEvt;
    else if (annsOrEvt && Array.isArray(annsOrEvt.annotations)) anns = annsOrEvt.annotations;
    const k = toText(key);
    const v = val !== undefined ? toText(val) : undefined;
    if (!anns || anns.length === 0) return false;
    return anns.some((a) => {
      const label = toText(a?.label);
      const value = a?.value !== undefined ? toText(a?.value) : undefined;
      if (v === undefined) return label === k;
      return label === k && value === v;
    });
  });

  // has_candidate: accepts (candidatesOrEvent[, provider]) matching by source/provider
  jsonLogic.add_operation('has_candidate', (candsOrEvt: any, provider?: any) => {
    let cands: any[] = [];
    if (Array.isArray(candsOrEvt)) cands = candsOrEvt;
    else if (candsOrEvt && Array.isArray(candsOrEvt.candidates)) cands = candsOrEvt.candidates;
    if (!cands || cands.length === 0) return false;
    const prov = provider !== undefined ? toText(provider) : undefined;
    if (prov === undefined) return cands.length > 0;
    return cands.some((c) => toText(c?.source) === prov || toText(c?.provider) === prov);
  });

  __opsRegistered = true;
}
