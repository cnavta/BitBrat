import { execSync } from 'child_process';

export function deriveTag(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {}
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const tag =
    ts.getUTCFullYear().toString() +
    pad(ts.getUTCMonth() + 1) +
    pad(ts.getUTCDate()) +
    pad(ts.getUTCHours()) +
    pad(ts.getUTCMinutes()) +
    pad(ts.getUTCSeconds());
  return tag;
}
