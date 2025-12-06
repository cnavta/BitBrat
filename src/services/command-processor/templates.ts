import type { InternalEventV2 } from '../../types/events';
import type { CommandTemplate } from './command-repo';
import { getConfig } from '../../common/config';
import {logger} from "../../common/logging";

export interface TemplateChoice {
  template: CommandTemplate;
}

/** Choose a template, avoiding the lastUsedTemplateId when possible. */
export function chooseTemplate(
  templates: CommandTemplate[],
  lastUsedTemplateId?: string,
  rng: () => number = Math.random
): TemplateChoice | null {
  logger.debug('command_processor.template.choose', {templates, lastUsedTemplateId})
  const list = Array.isArray(templates) ? templates.filter((t) => t && t.id && t.text) : [];
  if (list.length === 0) return null;
  let pool = list;
  if (lastUsedTemplateId && list.length > 1) {
    const filtered = list.filter((t) => t.id !== lastUsedTemplateId);
    if (filtered.length > 0) pool = filtered; // only exclude when it still leaves options
  }
  const idx = Math.floor(rng() * pool.length);
  const template = pool[idx];
  logger.debug('command_processor.template.chosen', {template, lastUsedTemplateId, idx, poolLength: pool.length});
  return { template };
}

export interface RenderContext {
  botName: string;
  username: string;
  utcNow: string; // ISO8601
}

/** Build default render context from event + config. */
export function buildRenderContext(evt: InternalEventV2): RenderContext {
  const cfg = getConfig();
  const botName = cfg.botUsername || 'Bot';
  const username = (evt?.user as any)?.displayName || evt?.userId || 'user';
  const utcNow = new Date().toISOString();
  return { botName, username, utcNow };
}

/** Minimal mustache-like renderer supporting {{botName}}, {{username}}, {{utcNow}}. Unknowns left intact. */
export function renderTemplate(text: string, ctx: RenderContext): string {
  if (typeof text !== 'string' || !text) return '';
  const mapping: Record<string, string> = {
    botName: String(ctx.botName ?? ''),
    username: String(ctx.username ?? ''),
    utcNow: String(ctx.utcNow ?? ''),
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, varName: string) => {
    if (Object.prototype.hasOwnProperty.call(mapping, varName)) {
      return mapping[varName];
    }
    return `{{${varName}}}`; // leave unknowns intact
  });
}
