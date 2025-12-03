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
    markSkip(evt, 'message_did_not_start_with_sigil', 'NO_COMMAND');
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

/** Full pipeline: parse → lookup → policy checks → choose/render → append candidate. */
export async function processEvent(raw: any, overrides?: Partial<ProcessorDeps>): Promise<ProcessOutcome> {
  const deps = { ...defaultDeps(), ...(overrides || {}) } as ProcessorDeps;
  const parsedRes = processForParsing(raw);
  const evt = parsedRes.event;
  if (parsedRes.action === 'skip') {
    return { action: 'skip', event: evt, stepStatus: 'SKIP', reason: parsedRes.reason };
  }
  const parsed = parsedRes.parsed!;

  // Lookup command
  const lookup = await deps.repoFindByNameOrAlias(parsed.name);
  if (!lookup) {
    markSkip(evt, 'command_not_found', 'COMMAND_NOT_FOUND');
    logger.info('command_processor.command.not_found', { name: parsed.name });
    return { action: 'skip', event: evt, stepStatus: 'SKIP', reason: 'not-found' };
  }

  const { ref, doc } = lookup;
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

  // Choose template (anti-repeat)
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

  logger.info('command_processor.candidate.added', { name: doc.name, templateId: choice.template.id });
  return { action: 'produced', event: evt, stepStatus: 'OK' };
}
