import { spawn } from 'child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export function execCmd(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      try { opts.onStdout && opts.onStdout(s); } catch {}
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      try { opts.onStderr && opts.onStderr(s); } catch {}
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        resolve({ code: -1, stdout, stderr: String(err?.message || err) });
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        resolve({ code: code ?? -1, stdout, stderr });
      }
    });
  });
}
