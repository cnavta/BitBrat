import { ChatController } from '../business/chat';
import { getCurrentContext } from '../config/bratrc';

function parseFlagMap(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    out[key] = v !== undefined ? v : 'true';
  }
  return out;
}

/**
 * Legacy CLI command for chat
 * Sprint 363: Updated to use ChatController from business/chat.ts
 */
export async function cmdChat(flags: any, rest: string[] = []) {
  // Parse additional flags from rest array first
  const restFlags = parseFlagMap(rest);

  // Sprint 349+: Resolve context
  // Priority: --context flag > BITBRAT_CONTEXT env var > ~/.bratrc > default 'local'
  const contextName = flags.context || process.env.BITBRAT_CONTEXT || getCurrentContext() || 'local';

  // DEPRECATED: Support --env and --target for backward compatibility
  const env = flags.env || restFlags.target || restFlags.env || process.env.BITBRAT_ENV || contextName;
  const projectId = flags.projectId || process.env.PROJECT_ID || 'twitch-452523';
  const url = flags.url || restFlags.url;

  const message = restFlags.message || restFlags.m; // Support --message or -m
  const user = restFlags.user || restFlags.u;       // Support --user or -u

  const controller = new ChatController({
    rootDir: flags.root || process.cwd(),
    context: contextName,
    env,
    projectId,
    url,
    message,
    user
  });
  await controller.start();
}
