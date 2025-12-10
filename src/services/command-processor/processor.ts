import { InternalEventV2, RoutingStep, RoutingStatus } from '../../types/events';
import { getConfig } from '../../common/config';
import { markStepResult } from '../routing/slip';
import { logger } from '../../common/logging';
import { findByNameOrAlias, type CommandLookupResult } from './command-repo';
import {
  checkAndUpdateGlobalCooldown,
  checkAndUpdateRateLimit,
  checkAndUpdateUserCooldown,
  effectiveGlobalCooldownMs,
  effectivePerUserCooldownMs,
  effectiveRateLimit,
} from './policy';
import { appendTextCandidate } from './candidate';
import { appendAnnotation, createAnnotation } from './annotation';
import { buildRenderContext, chooseTemplate, renderTemplate } from './templates';

export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface ProcessResult {
  action: 'skip' | 'parsed';
  parsed?: ParsedCommand;
  event: InternalEventV2;
  stepStatus: RoutingStatus;
  reason?: string;
}

export interface ProcessOutcome {
  action: 'skip' | 'produced' | 'blocked' | 'parsed';
  event: InternalEventV2;
  stepStatus: RoutingStatus;
  reason?: string;
}

/** Normalize unknown payload to InternalEventV2. */
export function normalizeEvent(raw: any): InternalEventV2 {
  return raw as InternalEventV2;
}

/** Extract message text in V2-safe way. */
function getText(evt: InternalEventV2): string {
  return (evt?.message?.text || '').trim();
}

/** Parse command if text begins with configured sigil. Lowercases name; preserves args tokens. */
export function parseCommandFromText(text: string, sigil: string): ParsedCommand | null {
  if (!text || !sigil) return null;
  if (!text.startsWith(sigil)) return null;
  const without = text.slice(sigil.length).trim();
  if (!without) return null;
  const parts = without.split(/\s+/).filter(Boolean);
  const name = (parts.shift() || '').toLowerCase();
  if (!name) return null;
  return { name, args: parts };
}

/** Mark current step as SKIP due to reason, if a step is pending for this service. */
function markSkip(evt: InternalEventV2, reason: string, code: string = 'NO_COMMAND'): void {
  const slip = evt.routingSlip || [];
  const idx = slip.findIndex((s) => s.status !== 'OK' && s.status !== 'SKIP');
  if (idx >= 0) {
    markStepResult(slip[idx] as RoutingStep, 'SKIP', { code, message: reason, retryable: false });
  }
}

/**
 * Entry processor for the command-processor pipeline up to parsing only (no Firestore yet).
 */
export function processForParsing(raw: any): ProcessResult {
  const cfg = getConfig();
  const evt = normalizeEvent(raw);
  const text = getText(evt);
  const sigil = (cfg.commandSigil || '!').slice(0, 1);

  if (!cfg.botUsername) {
    // Bot username needed later for rendering; do not fail parsing, but log warning.
    logger.warn('command_processor.config.bot_username.missing');
  }

  const parsed = parseCommandFromText(text, sigil);
  if (!parsed) {
    // Do not mutate routing slip here. We may still match a sigil-optional command later.
    logger.debug('command_processor.parse.skip', { textPreview: text.slice(0, 64), sigil });
    return { action: 'skip', event: evt, stepStatus: 'SKIP', reason: 'no-command' };
  }

  logger.info('command_processor.command.parsed', { name: parsed.name, args: parsed.args.length });
  return { action: 'parsed', parsed, event: evt, stepStatus: 'OK' };
}

// Dependency injection for easier testing
export interface ProcessorDeps {
  repoFindByNameOrAlias: (name: string) => Promise<CommandLookupResult | null>;
  policy: {
    checkAndUpdateGlobalCooldown: typeof checkAndUpdateGlobalCooldown;
    checkAndUpdateUserCooldown: typeof checkAndUpdateUserCooldown;
    checkAndUpdateRateLimit: typeof checkAndUpdateRateLimit;
  };
  rng: () => number;
  now: () => Date;
}

function defaultDeps(): ProcessorDeps {
  return {
    repoFindByNameOrAlias: (name: string) => findByNameOrAlias(name),
    policy: { checkAndUpdateGlobalCooldown, checkAndUpdateUserCooldown, checkAndUpdateRateLimit },
    rng: () => Math.random(),
    now: () => new Date(),
  };
}

type TermLocation = 'prefix' | 'suffix' | 'anywhere';

function termLocationOf(doc: any): TermLocation {
  const v = (doc?.termLocation || '').toString().toLowerCase();
  if (v === 'suffix' || v === 'anywhere' || v === 'prefix') return v as TermLocation;
  return 'prefix';
}

function allowedSigils(): string[] {
  const cfg = getConfig();
  const list = (cfg as any).allowedSigils as string[] | undefined;
  return Array.isArray(list) && list.length ? list : [((cfg.commandSigil || '!').slice(0, 1))];
}

function sigilAllowed(s: string): boolean {
  return allowedSigils().includes(s);
}

function effectiveSigil(doc: any): string {
  if (doc?.sigilOptional) return '';
  const cfg = getConfig();
  const s = (typeof doc?.sigil === 'string' && doc.sigil) ? String(doc.sigil) : (cfg.commandSigil || '!').slice(0, 1);
  // Enforce whitelist
  if (!sigilAllowed(s)) return '__DISALLOWED__';
  return s;
}

interface MatchInfo {
  ok: boolean;
  location?: TermLocation;
  start?: number;
  end?: number; // index after match
  parenPayload?: string; // inside (...)
}

function isWs(ch: string | undefined): boolean {
  return ch != null ? /\s/.test(ch) : true;
}

function extractParenPayload(text: string, idxOpen: number): string | null {
  if (text[idxOpen] !== '(') return null;
  const idxClose = text.indexOf(')', idxOpen + 1);
  if (idxClose < 0) return null;
  return text.substring(idxOpen + 1, idxClose);
}

function matchAtPrefix(text: string, term: string): MatchInfo {
  const tlc = term.toLowerCase();
  const tl = tlc.length;
  const lc = text.toLowerCase();
  if (!lc.startsWith(tlc)) return { ok: false };
  const next = lc[tl];
  if (next && !(isWs(next) || next === '(')) return { ok: false };
  const mi: MatchInfo = { ok: true, location: 'prefix', start: 0, end: tl };
  if (next === '(') {
    const payload = extractParenPayload(text, tl);
    if (payload != null) mi.parenPayload = payload;
  }
  return mi;
}

function matchAtSuffix(text: string, term: string): MatchInfo {
  const lc = text.toLowerCase();
  const tlc = term.toLowerCase();
  const tl = tlc.length;
  // Two cases: ...<ws>term$ OR ...<ws>term(payload)$
  // Try parentheses case first
  const idxTerm = lc.lastIndexOf(tlc);
  if (idxTerm >= 0) {
    const after = lc.substring(idxTerm + tl);
    if (after.length === 0) {
      // exactly ends with term
      const before = lc[idxTerm - 1];
      if (idxTerm === 0 || isWs(before)) return { ok: true, location: 'suffix', start: idxTerm, end: idxTerm + tl };
      return { ok: false };
    }
    if (after[0] === '(' && after.endsWith(')')) {
      const before = lc[idxTerm - 1];
      if (!(idxTerm === 0 || isWs(before))) return { ok: false };
      const payload = extractParenPayload(text, idxTerm + tl);
      if (payload == null) return { ok: false };
      return { ok: true, location: 'suffix', start: idxTerm, end: idxTerm + tl, parenPayload: payload };
    }
  }
  return { ok: false };
}

function matchAnywhere(text: string, term: string): MatchInfo {
  const lc = text.toLowerCase();
  const tlc = term.toLowerCase();
  const tl = tlc.length;
  let from = 0;
  while (true) {
    const idx = lc.indexOf(tlc, from);
    if (idx < 0) return { ok: false };
    const before = lc[idx - 1];
    const after = lc[idx + tl];
    if ((idx === 0 || isWs(before)) && (after == null || isWs(after) || after === '(')) {
      const mi: MatchInfo = { ok: true, location: 'anywhere', start: idx, end: idx + tl };
      if (after === '(') {
        const payload = extractParenPayload(text, idx + tl);
        if (payload != null) mi.parenPayload = payload;
      }
      return mi;
    }
    from = idx + 1;
  }
}

function matchDocAgainstText(text: string, doc: any, candidateKey: string): MatchInfo {
  const loc = termLocationOf(doc);
  const sig = effectiveSigil(doc);
  if (sig === '__DISALLOWED__') return { ok: false };
  const term = (doc?.sigilOptional ? '' : sig) + String(candidateKey || '').toLowerCase();
  if (!term) return { ok: false };
  let mi: MatchInfo;
  if (loc === 'prefix') mi = matchAtPrefix(text, term);
  else if (loc === 'suffix') mi = matchAtSuffix(text, term);
  else mi = matchAnywhere(text, term);
  return mi;
}

function tokenizeCandidateKeys(text: string): string[] {
  const toks = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  const sigs = allowedSigils();
  for (const t of toks) {
    const base = t.includes('(') ? t.substring(0, t.indexOf('(')) : t;
    // Name without sigil for sigilOptional
    if (base) out.add(base);
    for (const s of sigs) {
      if (base.startsWith(s) && base.length > s.length) {
        out.add(base.substring(s.length));
      }
    }
  }
  // Also consider entire text for sigilOptional full-text commands
  const full = text.trim().toLowerCase();
  if (full) out.add(full);
  return Array.from(out.values()).filter(Boolean);
}

/** Full pipeline: parse → lookup → policy checks → choose/render → append candidate. */
export async function processEvent(raw: any, overrides?: Partial<ProcessorDeps>): Promise<ProcessOutcome> {
  const deps = { ...defaultDeps(), ...(overrides || {}) } as ProcessorDeps;
  const parsedRes = processForParsing(raw);
  const evt = parsedRes.event;
  const msgText = getText(evt);

  // Try fast-path: text started with default sigil → use first word as candidate key
  const fastCandidateKey = parsedRes.parsed?.name;

  type Found = { ref: any; doc: any; match: MatchInfo } | null;
  let found: Found = null;

  async function tryLookupByKey(key: string): Promise<Found> {
    if (!key) return null;
    const res = await deps.repoFindByNameOrAlias(key);
    if (!res) return null;
    const match = matchDocAgainstText(msgText, res.doc, key);
    if (match.ok) return { ref: res.ref, doc: res.doc, match };
    return null;
  }

  if (fastCandidateKey) {
    found = await tryLookupByKey(fastCandidateKey);
  }

  // Secondary search: tokenize and attempt lookups by candidate keys, selecting first valid match
  if (!found) {
    const keys = tokenizeCandidateKeys(msgText);
    for (const k of keys) {
      // Skip duplicate attempt of fast key
      if (k === fastCandidateKey) continue;
      // Skip empty
      if (!k) continue;
      // Avoid obvious non-commands: extremely long tokens
      if (k.length > 80) continue;
      const res = await tryLookupByKey(k);
      if (res) { found = res; break; }
    }
  }

  if (!found) {
    // Nothing matched under the boundary and sigil rules
    markSkip(evt, parsedRes.action === 'skip' ? 'no-command' : 'command_not_matched', 'NO_COMMAND');
    return { action: 'skip', event: evt, stepStatus: 'SKIP', reason: 'not-found' };
  }

  const { ref, doc } = found;
  // Observability: record the matched command
  try {
    const id = (ref as any)?.id || doc.id;
    logger.info('command_processor.command.matched', { name: doc.name, id });
  } catch {
    logger.info('command_processor.command.matched', { name: doc.name });
  }
  // Policy defaults
  const cfg = getConfig();
  const defaults = {
    globalMs: Number(cfg.defaultGlobalCooldownMs || 0) | 0,
    userMs: Number(cfg.defaultUserCooldownMs || 0) | 0,
    rate: { max: Number(cfg.defaultRateMax || 0) | 0, perMs: Number(cfg.defaultRatePerMs || 60000) | 0 },
  };

  const now = deps.now();

  // User cooldown (if userId present)
  const userId = ((evt as any)?.user?.id as string) || (evt.userId as string) || '';
  if (userId) {
    const userDecision = await deps.policy.checkAndUpdateUserCooldown(ref as any, doc, userId, now, defaults.userMs);
    if (!userDecision.allowed) {
      markSkip(evt, 'user_cooldown_active', 'USER_COOLDOWN');
      return { action: 'blocked', event: evt, stepStatus: 'SKIP', reason: 'user-cooldown' };
    }
  }

  // Rate limit
  const rateDecision = await deps.policy.checkAndUpdateRateLimit(ref as any, doc, now, defaults.rate);
  if (!rateDecision.allowed) {
    markSkip(evt, 'rate_limited', 'RATE_LIMIT');
    return { action: 'blocked', event: evt, stepStatus: 'SKIP', reason: 'rate-limit' };
  }

  // Build ParsedCommand using location-specific arg extraction
  const loc = termLocationOf(doc);
  let parsed: ParsedCommand = { name: doc.name, args: [] };
  const m = found.match;
  if (loc === 'prefix') {
    if (m.parenPayload != null) parsed.args = [m.parenPayload];
    else {
      const rest = msgText.substring((m.end as number)).trim();
      parsed.args = rest ? rest.split(/\s+/).filter(Boolean) : [];
    }
  } else if (loc === 'suffix') {
    parsed.args = m.parenPayload != null ? [m.parenPayload] : [];
  } else {
    // anywhere: parse parentheses only if present; ignore trailing text
    parsed.args = m.parenPayload != null ? [m.parenPayload] : [];
  }

  // Branch by command type (default 'candidate')
  const effectType = (doc as any)?.type || 'candidate';
  if (effectType === 'annotation') {
    // Optional template for label/value; if none, fallback to empty rendered text
    const choice = chooseTemplate(doc.templates || [], undefined, deps.rng);
    const ctx = buildRenderContext(evt);
    const rendered = choice ? renderTemplate(choice.template.text, ctx) : '';

    // Global cooldown (do not persist lastUsedTemplateId for annotations)
    const globalDecision = await deps.policy.checkAndUpdateGlobalCooldown(ref as any, doc, now, defaults.globalMs, undefined);
    if (!globalDecision.allowed) {
      markSkip(evt, 'global_cooldown_active', 'GLOBAL_COOLDOWN');
      return { action: 'blocked', event: evt, stepStatus: 'SKIP', reason: 'global-cooldown' };
    }

    const kind = (doc as any)?.annotationKind || 'custom';
    const ann = createAnnotation(kind, doc.name, rendered, {
      commandName: doc.name,
      args: parsed.args,
    });
    appendAnnotation(evt, ann);
    logger.info('command_processor.effect.added', { effect: 'annotation', name: doc.name, kind });
    return { action: 'produced', event: evt, stepStatus: 'OK' };
  }

  // Candidate (default)
  const choice = chooseTemplate(doc.templates || [], doc.runtime?.lastUsedTemplateId, deps.rng);
  if (!choice) {
    markSkip(evt, 'no_templates_available', 'NO_TEMPLATES');
    return { action: 'blocked', event: evt, stepStatus: 'SKIP', reason: 'no-templates' };
  }
  logger.info('command_processor.template.chosen', { name: doc.name, templateId: choice.template.id });

  // Global cooldown (persist lastUsedTemplateId when allowed)
  const globalDecision = await deps.policy.checkAndUpdateGlobalCooldown(ref as any, doc, now, defaults.globalMs, choice.template.id);
  if (!globalDecision.allowed) {
    markSkip(evt, 'global_cooldown_active', 'GLOBAL_COOLDOWN');
    return { action: 'blocked', event: evt, stepStatus: 'SKIP', reason: 'global-cooldown' };
  }

  // Render and append candidate
  logger.debug('command_processor.candidate.rendering', { name: doc.name, templateId: choice.template.id });
  const ctx = buildRenderContext(evt);
  const text = renderTemplate(choice.template.text, ctx);
  const effRate = effectiveRateLimit(doc, defaults.rate) || { max: 0, perMs: defaults.rate.perMs };
  appendTextCandidate(evt, text, {
    commandName: doc.name,
    templateId: choice.template.id,
    args: parsed.args,
    checks: {
      globalCooldownMs: effectiveGlobalCooldownMs(doc, defaults.globalMs),
      perUserMs: effectivePerUserCooldownMs(doc, defaults.userMs),
      rate: effRate,
    },
  });

  // Backward-compatible log name expected by tests and dashboards
  logger.info('command_processor.candidate.added', { name: doc.name, templateId: choice.template.id });
  return { action: 'produced', event: evt, stepStatus: 'OK' };
}
