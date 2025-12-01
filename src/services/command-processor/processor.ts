import { InternalEventV1, InternalEventV2, RoutingStep, RoutingStatus } from '../../types/events';
import { toV2 } from '../../common/events/adapters';
import { getConfig } from '../../common/config';
import { markStepResult } from '../routing/slip';
import { logger } from '../../common/logging';

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

/** Normalize unknown payload to InternalEventV2. */
export function normalizeEvent(raw: any): InternalEventV2 {
  if (raw && raw.envelope) return toV2(raw as InternalEventV1);
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
function markSkip(evt: InternalEventV2, reason: string): void {
  const slip = evt.routingSlip || [];
  const idx = slip.findIndex((s) => s.status !== 'OK' && s.status !== 'SKIP');
  if (idx >= 0) {
    markStepResult(slip[idx] as RoutingStep, 'SKIP', { code: 'NO_COMMAND', message: reason, retryable: false });
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
    markSkip(evt, 'message_did_not_start_with_sigil');
    logger.debug('command_processor.parse.skip', { textPreview: text.slice(0, 64), sigil });
    return { action: 'skip', event: evt, stepStatus: 'SKIP', reason: 'no-command' };
  }

  logger.info('command_processor.command.parsed', { name: parsed.name, args: parsed.args.length });
  return { action: 'parsed', parsed, event: evt, stepStatus: 'OK' };
}
