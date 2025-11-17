import { execCmd } from '../../orchestration/exec';

export interface RepoSource {
  type: 'github' | 'cloud-source-repo';
  repo: string; // for github: owner/repo; for csr: projects/<proj>/repos/<name>
  branchRegex: string;
}

export interface TriggerSpec {
  name: string;
  configPath: string; // path to cloudbuild yaml file
  substitutions?: Record<string, string>;
  repoSource: RepoSource;
}

function tryLoadCloudBuild(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require('@google-cloud/cloudbuild');
    return sdk;
  } catch {
    return null;
  }
}

export interface TriggerSummary {
  id?: string;
  name: string;
  configPath?: string;
  substitutions?: Record<string, string>;
  repoSource?: RepoSource;
}

export function isTriggerEqual(a: TriggerSummary, b: TriggerSpec): boolean {
  if (!a) return false;
  if (a.name !== b.name) return false;
  if ((a.configPath || '') !== (b.configPath || '')) return false;
  const aSubs = a.substitutions || {};
  const bSubs = b.substitutions || {};
  const aKeys = Object.keys(aSubs).sort();
  const bKeys = Object.keys(bSubs).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (aSubs[aKeys[i]] !== bSubs[bKeys[i]]) return false;
  }
  const ar = a.repoSource;
  const br = b.repoSource;
  if (!ar || !br) return false;
  return ar.type === br.type && ar.repo === br.repo && ar.branchRegex === br.branchRegex;
}

export async function getTriggerByName(projectId: string, name: string): Promise<TriggerSummary | null> {
  const sdk = tryLoadCloudBuild();
  if (sdk) {
    try {
      const client = new sdk.CloudBuildClient();
      const parent = `projects/${projectId}/locations/global`;
      const iterable = client.listBuildTriggersAsync({ parent });
      for await (const t of iterable as any) {
        if (t.name === name) {
          const repoSource: RepoSource | undefined = t.github ? { type: 'github', repo: `${t.github.owner}/${t.github.name}`, branchRegex: t.github.push?.branch || t.github.pullRequest?.branch || '' } : undefined;
          return { id: t.id, name: t.name, configPath: t.filename, substitutions: t.substitutions, repoSource };
        }
      }
    } catch {
      // ignore, fallback
    }
  }
  // fallback to gcloud
  const res = await execCmd('gcloud', ['builds', 'triggers', 'list', '--project', projectId, '--format', 'json']);
  try {
    const arr = JSON.parse(res.stdout || '[]');
    const found = (arr as any[]).find((t) => t.name === name);
    if (!found) return null;
    let repoSource: RepoSource | undefined;
    if (found.github) {
      repoSource = { type: 'github', repo: `${found.github.owner}/${found.github.name}`, branchRegex: found.github.push?.branch || '' };
    }
    return { id: found.id, name: found.name, configPath: found.filename, substitutions: found.substitutions, repoSource };
  } catch {
    return null;
  }
}

export async function createTrigger(projectId: string, spec: TriggerSpec, dryRun = false): Promise<{ action: 'created'; id?: string } | { action: 'noop' }> {
  const exists = await getTriggerByName(projectId, spec.name);
  if (exists) return { action: 'noop' };
  if (dryRun) return { action: 'created' };
  const sdk = tryLoadCloudBuild();
  if (sdk) {
    try {
      const client = new sdk.CloudBuildClient();
      const parent = `projects/${projectId}/locations/global`;
      const trigger: any = {
        name: spec.name,
        filename: spec.configPath,
        substitutions: spec.substitutions || {},
      };
      if (spec.repoSource.type === 'github') {
        const [owner, repo] = spec.repoSource.repo.split('/');
        trigger.github = { owner, name: repo, push: { branch: spec.repoSource.branchRegex } };
      }
      const [resp] = await client.createBuildTrigger({ parent, trigger });
      return { action: 'created', id: resp?.id } as any;
    } catch {
      // ignore and fallback
    }
  }
  // fallback to gcloud
  if (spec.repoSource.type === 'github') {
    const [owner, repo] = spec.repoSource.repo.split('/');
    const args = ['builds', 'triggers', 'create', 'github', '--project', projectId, '--name', spec.name, '--repo-owner', owner, '--repo-name', repo, '--branch-pattern', spec.repoSource.branchRegex, '--build-config', spec.configPath];
    await execCmd('gcloud', args);
  }
  return { action: 'created' };
}

export async function updateTrigger(projectId: string, spec: TriggerSpec, dryRun = false): Promise<{ action: 'updated' | 'noop' }> {
  const existing = await getTriggerByName(projectId, spec.name);
  if (!existing) {
    return (await createTrigger(projectId, spec, dryRun)) as any;
  }
  if (isTriggerEqual(existing, spec)) return { action: 'noop' };
  if (dryRun) return { action: 'updated' };
  const sdk = tryLoadCloudBuild();
  if (sdk && existing.id) {
    try {
      const client = new sdk.CloudBuildClient();
      const trigger: any = { id: existing.id, name: spec.name, filename: spec.configPath, substitutions: spec.substitutions || {} };
      if (spec.repoSource.type === 'github') {
        const [owner, repo] = spec.repoSource.repo.split('/');
        trigger.github = { owner, name: repo, push: { branch: spec.repoSource.branchRegex } };
      }
      await client.updateBuildTrigger({ projectId, triggerId: existing.id, trigger });
      return { action: 'updated' };
    } catch {
      // fall back
    }
  }
  if (existing.id) {
    // gcloud has update with flags; simpler to delete+create
    await execCmd('gcloud', ['builds', 'triggers', 'delete', existing.id, '--project', projectId, '--quiet']);
  }
  await createTrigger(projectId, spec, false);
  return { action: 'updated' };
}

export async function deleteTrigger(projectId: string, name: string, dryRun = false): Promise<{ action: 'deleted' | 'noop' }> {
  const existing = await getTriggerByName(projectId, name);
  if (!existing) return { action: 'noop' };
  if (dryRun) return { action: 'deleted' };
  const sdk = tryLoadCloudBuild();
  if (sdk && existing.id) {
    try {
      const client = new sdk.CloudBuildClient();
      await client.deleteBuildTrigger({ projectId, triggerId: existing.id });
      return { action: 'deleted' };
    } catch {
      // ignore and fallback
    }
  }
  if (existing.id) {
    await execCmd('gcloud', ['builds', 'triggers', 'delete', existing.id, '--project', projectId, '--quiet']);
  } else {
    // try by name
    await execCmd('gcloud', ['builds', 'triggers', 'delete', name, '--project', projectId, '--quiet']);
  }
  return { action: 'deleted' };
}
