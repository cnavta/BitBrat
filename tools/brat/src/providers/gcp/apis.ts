import { execCmd } from '../../orchestration/exec';

export type EnvironmentName = 'dev' | 'staging' | 'prod' | string;

export interface EnableApisResultItem {
  api: string;
  enabled: boolean;
  code: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface EnableApisResult {
  projectId: string;
  attempted: string[];
  results: EnableApisResultItem[];
  ok: boolean;
  dryRun?: boolean;
}

/**
 * Returns the curated list of required GCP APIs for BitBrat based on architecture.yaml and infra plan.
 * This list is intentionally conservative and limited to current usage:
 * - Cloud Run, Cloud Build, Artifact Registry, Compute (LB, URL Maps, Managed Certs)
 * - Serverless VPC Access (connectors)
 * - Secret Manager (service configuration)
 * - Logging (observability)
 * - Certificate Manager (optional, safe to enable)
 * - Service Usage (self)
 */
export function getRequiredApis(env: EnvironmentName): string[] {
  const base = [
    'run.googleapis.com',
    'cloudbuild.googleapis.com',
    'artifactregistry.googleapis.com',
    'compute.googleapis.com',
    'vpcaccess.googleapis.com',
    'secretmanager.googleapis.com',
    'logging.googleapis.com',
    'servicemanagement.googleapis.com',
    'serviceusage.googleapis.com',
  ];
  // Enable Certificate Manager in all envs to support optional cert workflows
  const optional = ['certificatemanager.googleapis.com'];

  // No special differences per env yet, but keep hook for future overlays
  return Array.from(new Set([...base, ...optional])).sort();
}

export async function enableApis(options: { projectId: string; env: EnvironmentName; apis?: string[]; dryRun?: boolean }): Promise<EnableApisResult> {
  const { projectId, env, dryRun } = options;
  const apis = (options.apis && options.apis.length ? options.apis : getRequiredApis(env)).filter(Boolean);

  const results: EnableApisResultItem[] = [];

  if (dryRun) {
    // In dry-run, do not invoke gcloud; return the intent
    return { projectId, attempted: apis, results: apis.map((api) => ({ api, enabled: false, code: 0 })), ok: true, dryRun: true };
  }

  // gcloud can accept multiple services at once, but we’ll enable in chunks to improve error isolation
  const chunkSize = 10;
  for (let i = 0; i < apis.length; i += chunkSize) {
    const chunk = apis.slice(i, i + chunkSize);
    const args = ['services', 'enable', '--project', projectId, '--quiet', ...chunk];
    try {
      const res = await execCmd('gcloud', args);
      const success = res.code === 0;
      for (const api of chunk) {
        results.push({ api, enabled: success, code: res.code, stdout: res.stdout, stderr: res.stderr });
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      for (const api of chunk) {
        results.push({ api, enabled: false, code: 1, error: msg });
      }
    }
  }

  const ok = results.every((r) => r.enabled);
  return { projectId, attempted: apis, results, ok };
}
