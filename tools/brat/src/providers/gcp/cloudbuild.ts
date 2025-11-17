import { execCmd } from '../../orchestration/exec';

export interface CloudBuildSubmitOptions {
  projectId: string;
  configPath: string;
  substitutions: Record<string, string | number | boolean>;
  cwd?: string;
  dryRun?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

function buildSubstitutionsArg(subs: Record<string, string | number | boolean>): string {
  // Convert to _KEY=value format separated by commas
  const parts: string[] = [];
  for (const [k, v] of Object.entries(subs)) {
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join(',');
}

export async function submitBuild(opts: CloudBuildSubmitOptions): Promise<{ code: number; stdout: string; stderr: string; cmd: string[] }> {
  const { projectId, configPath, substitutions, cwd, dryRun, onStdout, onStderr } = opts;
  const subsArg = buildSubstitutionsArg(substitutions);
  const args = ['builds', 'submit', '--project', projectId, '--config', configPath, '--substitutions', subsArg, '.'];
  if (dryRun) {
    return { code: 0, stdout: `DRY-RUN: gcloud ${args.join(' ')}`, stderr: '', cmd: ['gcloud', ...args] };
  }
  const res = await execCmd('gcloud', args, { cwd, onStdout, onStderr });
  return { code: res.code, stdout: res.stdout, stderr: res.stderr, cmd: ['gcloud', ...args] };
}
