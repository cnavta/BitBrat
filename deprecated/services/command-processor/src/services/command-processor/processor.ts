import { InternalEventV2, RoutingStep, RoutingStatus } from '../../types/events';
import { getConfig } from '../../common/config';
import { markStepResult } from '../routing/slip';
import { logger } from '../../common/logging';
import { findByNameOrAlias, findFirstByCommandTerm, type CommandLookupResult } from './command-repo';
import { getCompiledRegexCommands } from './regex-cache';
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
  sigil: string;
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
  // Name is up to first whitespace or '(' whichever comes first
  let name = without;
  let rest = '';
  const wsIdx = without.search(/\s/);
  const parenIdx = without.indexOf('(');
  let cut = -1;
  if (wsIdx >= 0 && parenIdx >= 0) cut = Math.min(wsIdx, parenIdx);
  else if (wsIdx >= 0) cut = wsIdx;
  else if (parenIdx >= 0) cut = parenIdx;
  if (cut >= 0) {
    name = without.substring(0, cut);
    rest = without.substring(cut);
  }
  name = (name || '').trim().toLowerCase();
  if (!name) return null;
  // If rest begins with parentheses group, extract it as a single arg (payload), else split by spaces
  let args: string[] = [];
  const trimmedRest = rest.trim();
  if (trimmedRest.startsWith('(')) {
    const close = trimmedRest.indexOf(')');
    if (close > 1) {
      args = [trimmedRest.substring(1, close)];
    }
  } else if (trimmedRest) {
    args = trimmedRest.split(/\s+/).filter(Boolean);
  }
  return { name, args, sigil };
}

/** Try to parse with any allowed sigil. Returns first match in config order. */
export function parseWithAllowedSigils(text: string): ParsedCommand | null {
  const cfg = getConfig();
  const sigils = (cfg as any).allowedSigils as string[] | undefined;
  const list = Array.isArray(sigils) && sigils.length ? sigils : [((cfg.commandSigil || '!').slice(0, 1))];
  for (const s of list) {
    const p = parseCommandFromText(text, s);
    if (p) return p;
  }
  return null;
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
  // Multi-sigil support
  const parsed = parseWithAllowedSigils(text);

  if (!cfg.botUsername) {
    // Bot username needed later for rendering; do not fail parsing, but log warning.
    logger.warn('command_processor.config.bot_username.missing');
  }

  if (!parsed) {
    // No sigil-prefix command parsed. This does NOT preclude regex matching.
    // Only matchType.kind == 'command' requires a leading sigil. Proceed with pipeline.
    logger.debug('command_processor.parse.no_sigil', { textPreview: text.slice(0, 64) });
    return { action: 'parsed', event: evt, stepStatus: 'OK', reason: 'no-sigil' };
  }

  logger.info('command_processor.command.parsed', { name: parsed.name, args: parsed.args.length, sigil: parsed.sigil });
  return { action: 'parsed', parsed, event: evt, stepStatus: 'OK' };
}

// Dependency injection for easier testing
export interface ProcessorDeps {
  repoFindByNameOrAlias: (name: string) => Promise<CommandLookupResult | null>; // kept for backward compat in tests
  repoFindFirstByCommandTerm?: (term: string) => Promise<CommandLookupResult | null>;
  policy: {
    checkAndUpdateGlobalCooldown: typeof checkAndUpdateGlobalCooldown;
    checkAndUpdateUserCooldown: typeof checkAndUpdateUserCooldown;
    checkAndUpdateRateLimit: typeof checkAndUpdateRateLimit;
  };
  rng: () => number;
  now: () => Date;
  getRegexCompiled?: () => ReadonlyArray<{
    ref: any;
    doc: any;
    patterns: RegExp[];
  }>;
}

function defaultDeps(): ProcessorDeps {
  return {
    repoFindByNameOrAlias: (name: string) => findByNameOrAlias(name),
    policy: { checkAndUpdateGlobalCooldown, checkAndUpdateUserCooldown, checkAndUpdateRateLimit },
    rng: () => Math.random(),
    now: () => new Date(),
    getRegexCompiled: () => getCompiledRegexCommands(),
  };
}

// legacy termLocation and boundary helpers removed in vNext

/** Full pipeline: parse → lookup → policy checks → choose/render → append candidate. */
export async function processEvent(raw: any, overrides?: Partial<ProcessorDeps>): Promise<ProcessOutcome> {
  const deps = { ...defaultDeps(), ...(overrides || {}) } as ProcessorDeps;
  const parsedRes = processForParsing(raw);
  const evt = parsedRes.event;
  const msgText = getText(evt);

  // Two-stage matching per TA: command path (by sigil) then regex fallback
  let matched: { ref: any; doc: any; kind: 'command' | 'regex'; regexInfo?: { pattern: string; match: RegExpMatchArray } } | null = null;

  // Command path
  if (parsedRes.parsed?.name) {
    const byTerm = deps.repoFindFirstByCommandTerm
      ? await deps.repoFindFirstByCommandTerm(parsedRes.parsed.name)
      : (await deps.repoFindByNameOrAlias(parsedRes.parsed.name));
    if (byTerm) {
      matched = { ref: byTerm.ref, doc: byTerm.doc, kind: 'command' };
    } else {
      logger.debug('command_processor.command.lookup.miss', { term: parsedRes.parsed.name });
    }
  }

  // Regex fallback
  if (!matched) {
    const cfg = getConfig();
    const compiled = (deps.getRegexCompiled ? deps.getRegexCompiled() : []) as ReadonlyArray<{
      ref: any; doc: any; patterns: RegExp[];
    }>;
    // Apply message-length cap for regex evaluation, if configured
    const cap = Number((cfg as any).regexMaxMessageLength ?? 0) | 0;
    const textForRegex = cap > 0 && msgText.length > cap ? msgText.slice(0, cap) : msgText;
    if (cap > 0 && msgText.length > cap) {
      logger.debug('command_processor.regex.eval.truncated', { originalLen: msgText.length, usedLen: textForRegex.length, cap });
    } else {
      logger.debug('command_processor.regex.eval.start', { len: textForRegex.length, commands: compiled.length });
    }
    outer: for (const entry of compiled) {
      for (const rx of entry.patterns) {
        logger.debug('command_processor.regex.eval.try', { pattern: String(rx) });
        const m = textForRegex.match(rx);
        logger.debug('command_processor.regex.eval.match', { matched: !!m, m });
        if (m) {
          matched = { ref: entry.ref, doc: entry.doc, kind: 'regex', regexInfo: { pattern: String(rx), match: m } };
          break outer;
        }
      }
    }
  }

  if (!matched) {
    // No match at all
    markSkip(evt, parsedRes.action === 'skip' ? 'no-command' : 'no-match', 'NO_COMMAND');
    return { action: 'skip', event: evt, stepStatus: 'SKIP', reason: 'not-found' };
  }

  const { ref, doc } = matched;
  // Observability: record the matched command
  try {
    const id = (ref as any)?.id || doc.id;
    logger.info('command_processor.command.matched', { name: doc.name, id, kind: matched.kind });
  } catch {
    logger.info('command_processor.command.matched', { name: doc.name, kind: matched.kind });
  }

  // Helper: append personality annotation if CommandDoc.bot.personality is valid
  const maybeAppendPersonality = () => {
    try {
      const raw = (doc as any)?.bot?.personality;
      if (raw == null) return; // absent is fine
      if (typeof raw !== 'string') {
        logger.warn('command_processor.personality.invalid', { id: doc.id, name: doc.name, valueType: typeof raw });
        return;
      }
      const name = raw.trim();
      if (!name) {
        logger.warn('command_processor.personality.invalid', { id: doc.id, name: doc.name, value: raw });
        return;
      }
      const ann = createAnnotation('personality', undefined, undefined, { name });
      appendAnnotation(evt, ann);
      logger.info('command_processor.personality.added', { id: doc.id, command: doc.name, personality: name });
    } catch (e: any) {
      logger.warn('command_processor.personality.error', { id: doc.id, name: doc.name, error: e?.message || String(e) });
    }
  };
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

  // Build ParsedCommand for payload/templating
  let parsed: ParsedCommand = { name: doc.name, args: [], sigil: parsedRes.parsed?.sigil || '' };
  if (matched.kind === 'command' && parsedRes.parsed) {
    parsed.args = parsedRes.parsed.args;
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
    const payload: Record<string, any> = { commandName: doc.name, args: parsed.args };
    if (matched.kind === 'command') {
      payload.match = { kind: 'command', sigil: parsed.sigil, term: parsed.name, argsText: parsed.args.join(' ') };
    } else if (matched.kind === 'regex') {
      const m = matched.regexInfo?.match as any;
      payload.match = {
        kind: 'regex',
        pattern: matched.regexInfo?.pattern,
        groups: Array.isArray(m) ? m.slice(1) : [],
        namedGroups: m?.groups || undefined,
      };
    }
    const ann = createAnnotation(kind, doc.name, rendered, payload);
    appendAnnotation(evt, ann);
    logger.info('command_processor.effect.added', { effect: 'annotation', name: doc.name, kind });
    // Personality annotation (append-only)
    maybeAppendPersonality();
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
    match: matched.kind === 'command'
      ? { kind: 'command', sigil: parsed.sigil, term: parsed.name, argsText: parsed.args.join(' ') }
      : matched.kind === 'regex'
        ? {
            kind: 'regex',
            pattern: matched.regexInfo?.pattern,
            groups: matched.regexInfo?.match?.slice ? (matched.regexInfo?.match.slice(1)) : [],
            namedGroups: (matched.regexInfo as any)?.match?.groups,
          }
        : undefined,
    checks: {
      globalCooldownMs: effectiveGlobalCooldownMs(doc, defaults.globalMs),
      perUserMs: effectivePerUserCooldownMs(doc, defaults.userMs),
      rate: effRate,
    },
  });

  // Backward-compatible log name expected by tests and dashboards
  logger.info('command_processor.candidate.added', { name: doc.name, templateId: choice.template.id });
  // Personality annotation (append-only)
  maybeAppendPersonality();
  return { action: 'produced', event: evt, stepStatus: 'OK' };
}
