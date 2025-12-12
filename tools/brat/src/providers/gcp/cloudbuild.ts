import { execCmd } from '../../orchestration/exec';

export interface CloudBuildSubmitOptions {
  projectId: string;
  configPath: string;
  substitutions: Record<string, string | number | boolean>;
  cwd?: string;
  dryRun?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  // New: throttle Cloud Build polling to avoid hitting Get requests quota (429)
  pollIntervalSec?: number; // default 5
  maxWaitMinutes?: number; // default 60
}

function escapeSubstitutionValue(val: string): string {
  // Cloud Build --substitutions uses comma to separate pairs and '=' to split key/value.
  // Values must escape ',', '=' and '\\' with a backslash to avoid being parsed as delimiters.
  return String(val)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/=/g, '\\=');
}

function buildSubstitutionsArg(subs: Record<string, string | number | boolean>): string {
  // Convert to _KEY=value format separated by commas with proper escaping of values
  const parts: string[] = [];
  for (const [k, v] of Object.entries(subs)) {
    const val = typeof v === 'string' ? escapeSubstitutionValue(v) : String(v);
    parts.push(`${k}=${val}`);
  }
  return parts.join(',');
}

// Extract build ID from gcloud output lines like:
// Created [https://cloudbuild.googleapis.com/v1/projects/<proj>/locations/global/builds/<BUILD_ID>].
export function extractBuildIdFromGcloudOutput(out: string): string | null {
  const m = out.match(/builds\/([a-f0-9\-]{8,})/i);
  return m ? m[1] : null;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function submitBuild(opts: CloudBuildSubmitOptions): Promise<{ code: number; stdout: string; stderr: string; cmd: string[] }> {
  const { projectId, configPath, substitutions, cwd, dryRun, onStdout, onStderr } = opts;
  const pollIntervalSec = Math.max(1, opts.pollIntervalSec ?? 5);
  const maxWaitMs = (opts.maxWaitMinutes ?? 60) * 60 * 1000;
  const subsArg = buildSubstitutionsArg(substitutions);
  // Use --async and implement our own throttled waiter to avoid 1s polling inside gcloud
  const args = ['builds', 'submit', '--async', '--project', projectId, '--config', configPath, '--substitutions', subsArg, '.'];
  if (dryRun) {
    return { code: 0, stdout: `DRY-RUN: gcloud ${args.join(' ')}`, stderr: '', cmd: ['gcloud', ...args] };
  }
  const res = await execCmd('gcloud', args, { cwd, onStdout, onStderr });
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  const buildId = extractBuildIdFromGcloudOutput(combined);
  if (!buildId) {
    // Fallback: if async submission failed, propagate result
    return { code: res.code, stdout: res.stdout, stderr: res.stderr, cmd: ['gcloud', ...args] };
  }
  // Poll build status with throttling and basic backoff on 429
  const start = Date.now();
  let delay = pollIntervalSec * 1000;
  let lastStdout = res.stdout || '';
  let lastStderr = res.stderr || '';
  while (Date.now() - start < maxWaitMs) {
    const describeArgs = ['builds', 'describe', buildId, '--project', projectId, '--format', 'json'];
    const d = await execCmd('gcloud', describeArgs, { cwd });
    const out = d.stdout || '';
    if (d.code === 0) {
      try {
        const json = JSON.parse(out || '{}');
        const status = (json.status || '').toUpperCase();
        if (status === 'SUCCESS') {
          return { code: 0, stdout: (lastStdout + '\n' + out).trim(), stderr: lastStderr, cmd: ['gcloud', ...args] };
        }
        if (status === 'FAILURE' || status === 'CANCELLED' || status === 'EXPIRED' || status === 'INTERNAL_ERROR' || status === 'TIMEOUT') {
          return { code: 1, stdout: (lastStdout + '\n' + out).trim(), stderr: lastStderr, cmd: ['gcloud', ...args] };
        }
      } catch {}
      // Still running
      await sleep(delay);
      continue;
    } else {
      // Handle quota 429 with exponential backoff and jitter
      const stderr = d.stderr || '';
      if (/\b(429|RATE_LIMIT|RESOURCE_EXHAUSTED)\b/i.test(stderr)) {
        delay = Math.min(delay * 2, 30000) + Math.floor(Math.random() * 500);
        await sleep(delay);
        continue;
      }
      // Other errors: accumulate and break
      lastStderr += `\n${stderr}`;
      return { code: 1, stdout: lastStdout, stderr: lastStderr, cmd: ['gcloud', ...args] };
    }
  }
  // Timed out waiting
  return { code: 1, stdout: lastStdout, stderr: (lastStderr + '\nTimed out waiting for Cloud Build').trim(), cmd: ['gcloud', ...args] };
}
