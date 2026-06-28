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

/**
 * Canonical list of evaluation-context paths an authored rule may reference. This is the single
 * source of truth consumed by the router Context Pack generator (sprint-328) so the JsonLogic guide
 * never drifts from what `buildContext` actually exposes. Keep aligned with EvalContext below and
 * the assignments in buildContext().
 */
export const EVAL_CONTEXT_PATHS: ReadonlyArray<{ path: string; note: string }> = [
  { path: 'type', note: 'InternalEventType of the event, e.g. "chat.message.v1".' },
  { path: 'identity', note: 'Identity object (identity.user, identity.auth, identity.external.*).' },
  { path: 'annotations', note: 'AnnotationV1[] attached to the event (use has_annotation).' },
  { path: 'candidates', note: 'CandidateV1[] proposed for the event (use has_candidate).' },
  { path: 'routingSlip', note: 'RoutingStep[] of the in-flight routing slip (use slip_complete).' },
  { path: 'message', note: 'MessageV1 for chat/text events (message.text, message.role).' },
  { path: 'payload', note: 'Normalized payload (message.rawPlatformPayload or event.payload).' },
  { path: 'source', note: 'Legacy flattened path -> ingress.source.' },
  { path: 'channel', note: 'Legacy flattened path -> ingress.channel.' },
  { path: 'userId', note: 'Legacy flattened path -> identity.external.id.' },
  { path: 'user', note: 'Legacy flattened path -> identity.user.' },
  { path: 'auth', note: 'Legacy flattened path -> identity.auth.' },
  { path: 'now', note: 'ISO8601 evaluation timestamp.' },
  { path: 'ts', note: 'Epoch milliseconds of evaluation.' },
];

export interface EvalContext extends Record<string, any> {
  // --- New Root Paths (V2) ---
  v: '2';
  type: string;
  correlationId: string;
  traceId?: string;
  ingress: any;
  identity: any;
  egress: Egress;
  message?: any;
  payload: Record<string, any>;
  annotations?: any[];
  candidates?: any[];
  routingSlip?: any[];

  // --- Legacy Paths (Flattened for backward compatibility) ---
  source?: string;    // Maps to ingress.source
  channel?: string;   // Maps to ingress.channel
  userId?: string;    // Maps to identity.external.id
  user?: any;         // Maps to identity.user
  auth?: any;         // Maps to identity.auth

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
    // Flattened legacy paths to keep existing JsonLogic rules working
    source: evt.ingress?.source,
    channel: evt.ingress?.channel,
    userId: evt.identity?.external?.id,
    user: evt.identity?.user,
    auth: evt.identity?.auth,
    // Payload normalized to message or fallback
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

/**
 * Custom JsonLogic operator definition. `fn` is the runtime implementation handed to
 * `jsonLogic.add_operation`; `signature`/`description` are surfaced by the router Context Pack
 * generator (sprint-328) so the documented guide is derived from this single source of truth.
 */
export interface CustomOperatorDef {
  name: string;
  signature: string;
  description: string;
  fn: (...args: any[]) => any;
}

/**
 * Single source of truth for the custom JsonLogic operators available to authored routing rules.
 * `registerOperatorsOnce` registers exactly these; the router Context Pack + drift guard read the
 * same list, so a new operator auto-documents and a removed/renamed one fails the drift test.
 */
export const CUSTOM_OPERATORS: ReadonlyArray<CustomOperatorDef> = [
  {
    name: 'ci_eq',
    signature: 'ci_eq(a, b)',
    description: 'Case-insensitive equality; null/undefined coerce to "".',
    fn: (a: any, b: any) => {
      const aa = toText(a).toLowerCase();
      const bb = toText(b).toLowerCase();
      return aa === bb;
    },
  },
  {
    name: 're_test',
    signature: 're_test(value, pattern[, flags]) | re_test(value, [pattern, flags])',
    description: 'Regex test with safe caching; invalid patterns return false.',
    fn: (value: any, pattern: any, flags?: any) => {
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
    },
  },
  {
    name: 'slip_complete',
    signature: 'slip_complete(routingSlip)',
    description: 'True if the routing slip is fully complete (no PENDING/ERROR; terminal or all-OK).',
    fn: (slip: any) => {
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
    },
  },
  {
    name: 'has_role',
    signature: 'has_role(roles, role[, ci])',
    description: 'Membership test in a roles array; optional case-insensitive third arg.',
    fn: (roles: any, role: any, ci?: any) => {
      const rlist = safeArray(roles).map((r) => toText(r));
      const needle = toText(role);
      const caseInsensitive = ci === true || toText(ci).toLowerCase() === 'true';
      if (caseInsensitive) {
        const n = needle.toLowerCase();
        return rlist.some((r) => r.toLowerCase() === n);
      }
      return rlist.includes(needle);
    },
  },
  {
    name: 'text_contains',
    signature: 'text_contains(value, needle[, ci])',
    description: 'Substring test; optional case-insensitive third arg.',
    fn: (value: any, needle: any, ci?: any) => {
      const hay = toText(value);
      const ndl = toText(needle);
      const caseInsensitive = ci === true || toText(ci).toLowerCase() === 'true';

      if (caseInsensitive) {
        const lowerHay = hay.toLowerCase();
        const lowerNdl = ndl.toLowerCase();
        if (lowerHay.includes(lowerNdl)) return true;

        // Sprint 225: If trailing space in needle causes mismatch at end of string, try trimmed
        if (lowerNdl.endsWith(' ') && lowerHay.endsWith(lowerNdl.trimEnd())) {
          return true;
        }
        return false;
      }

      if (hay.includes(ndl)) return true;
      if (ndl.endsWith(' ') && hay.endsWith(ndl.trimEnd())) {
        return true;
      }
      return false;
    },
  },
  {
    name: 'has_annotation',
    signature: 'has_annotation(annotationsOrEvent, key[, value])',
    description: 'Presence of an annotation by kind/label (optionally matching value).',
    fn: (annsOrEvt: any, key: any, val?: any) => {
      let anns: any[] = [];
      if (Array.isArray(annsOrEvt)) anns = annsOrEvt;
      else if (annsOrEvt && Array.isArray(annsOrEvt.annotations)) anns = annsOrEvt.annotations;
      const k = toText(key);
      const v = val !== undefined ? toText(val) : undefined;
      if (!anns || anns.length === 0) return false;
      return anns.some((a) => {
        const kind = toText(a?.kind);
        const label = toText(a?.label);
        const value = a?.value !== undefined ? toText(a?.value) : undefined;
        if (v === undefined) return label === k || kind === k;
        return (label === k && value === v) || (kind === k && (value === v || label === v));
      });
    },
  },
  {
    name: 'has_candidate',
    signature: 'has_candidate(candidatesOrEvent[, provider])',
    description: 'Presence of a candidate; optional filter by source/provider.',
    fn: (candsOrEvt: any, provider?: any) => {
      let cands: any[] = [];
      if (Array.isArray(candsOrEvt)) cands = candsOrEvt;
      else if (candsOrEvt && Array.isArray(candsOrEvt.candidates)) cands = candsOrEvt.candidates;
      if (!cands || cands.length === 0) return false;
      const prov = provider !== undefined ? toText(provider) : undefined;
      if (prov === undefined) return cands.length > 0;
      return cands.some((c) => toText(c?.source) === prov || toText(c?.provider) === prov);
    },
  },
];

/** Idempotently register custom JsonLogic operators from the CUSTOM_OPERATORS source of truth. */
export function registerOperatorsOnce(): void {
  if (__opsRegistered) return;
  for (const op of CUSTOM_OPERATORS) {
    jsonLogic.add_operation(op.name, op.fn);
  }
  __opsRegistered = true;
}
