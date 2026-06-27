import fs from 'fs';
import path from 'path';
import { PermissionError } from '../orchestration/errors';
import type { Logger } from '../orchestration/logger';
import { FleetIdentity } from './types';

/**
 * BL-204 §6.1 / OQ3 — fleet identity + fail-closed bearer-token resolution.
 *
 * A resolvable bearer token is REQUIRED for a fleet command to engage. When none can be resolved the
 * command MUST refuse to run (non-zero exit) and emit a posture warning — never a silent
 * unauthenticated call. Token resolution mirrors existing Brat/secret conventions and is
 * deployment-target-agnostic:
 *
 *   1. `MCP_AUTH_TOKEN` env (GCP Secret Manager injects it here on Cloud Run; CI/local exports it).
 *   2. environment-target secret files, in order: `.secure.local`, `.env.brat`, `.env.local`
 *      (the `ssh://`-synced `.env.brat` covers the Remote Docker target).
 *
 * No secret is ever embedded in code; tokens are read at runtime only (TA §6.6).
 */

const TOKEN_ENV_KEYS = ['MCP_AUTH_TOKEN'];
const SECRET_FILES = ['.secure.local', '.env.brat', '.env.local'];
const SECRET_FILE_KEYS = ['MCP_AUTH_TOKEN'];

export interface ResolveIdentityOptions {
  /** Roles to forward (e.g. ['bit:read'] or ['bit:operate']). */
  roles?: string[];
  /** Operator user id, forwarded via `_meta.userId`. */
  userId?: string;
  /** Calling agent name (defaults to `brat`). */
  agentName?: string;
  /** Directory to look for secret files in (defaults to process.cwd()). */
  cwd?: string;
  /** Optional explicit token (e.g. a future --token flag); takes precedence over discovery. */
  token?: string;
}

/** Parse a single KEY from a dotenv-style file's contents, tolerating quotes and comments. */
function readKeyFromEnvContents(contents: string, key: string): string | undefined {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (k !== key) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) return v;
  }
  return undefined;
}

/** Attempt to resolve a bearer token from env then environment-target secret files. */
export function resolveToken(opts: ResolveIdentityOptions = {}): string | undefined {
  if (opts.token && opts.token.trim()) return opts.token.trim();

  for (const key of TOKEN_ENV_KEYS) {
    const v = (process.env[key] || '').trim();
    if (v) return v;
  }

  const dir = opts.cwd || process.cwd();
  for (const file of SECRET_FILES) {
    const p = path.join(dir, file);
    try {
      if (!fs.existsSync(p)) continue;
      const contents = fs.readFileSync(p, 'utf8');
      for (const key of SECRET_FILE_KEYS) {
        const v = readKeyFromEnvContents(contents, key);
        if (v && v.trim()) return v.trim();
      }
    } catch {
      /* unreadable secret file — fall through to the next candidate */
    }
  }

  return undefined;
}

/**
 * Build a fully-formed {@link FleetIdentity}, failing closed when no token resolves.
 *
 * Throws {@link PermissionError} (exit code 4) and logs a `fleet.auth.posture_warning` when no token
 * is found, so the operator gets a clear refusal rather than a silent unauthenticated attempt (OQ3).
 */
export function resolveIdentity(opts: ResolveIdentityOptions = {}, logger?: Logger): FleetIdentity {
  const token = resolveToken(opts);
  if (!token) {
    logger?.warn(
      { action: 'fleet.auth.posture_warning' },
      'Refusing to run: no MCP_AUTH_TOKEN resolved (env or .secure.local/.env.brat/.env.local). ' +
        'Fleet commands are fail-closed — set MCP_AUTH_TOKEN to engage.',
    );
    throw new PermissionError(
      'No MCP_AUTH_TOKEN resolved. Set MCP_AUTH_TOKEN (env) or provide it via .secure.local / .env.brat / .env.local.',
    );
  }
  return {
    token,
    roles: opts.roles && opts.roles.length > 0 ? opts.roles : [],
    userId: opts.userId,
    agentName: opts.agentName || 'brat',
  };
}
