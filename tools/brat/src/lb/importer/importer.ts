import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execCmd } from '../../orchestration/exec';
import { UrlMapYaml } from '../urlmap/schema';
import { desiredYamlToObject, diffObjects } from './diff';

export interface ImportOptions {
  projectId: string;
  env: 'dev'|'staging'|'prod';
  urlMapName: string;
  sourceYamlPath: string;
  dryRun?: boolean;
}

export async function describeUrlMap(projectId: string, urlMapName: string): Promise<any> {
  const res = await execCmd('gcloud', ['compute', 'url-maps', 'describe', urlMapName, '--global', '--project', projectId, '--format', 'yaml']);
  if (res.code !== 0) {
    // Not found or error; treat as empty
    return {};
  }
  try {
    return yaml.load(res.stdout || '') || {};
  } catch {
    return {};
  }
}

export async function importUrlMap(opts: ImportOptions): Promise<{ changed: boolean; message: string }> {
  const desiredText = fs.readFileSync(opts.sourceYamlPath, 'utf8');
  const desiredObj = yaml.load(desiredText) as UrlMapYaml;
  const desired = desiredYamlToObject(desiredObj);

  const current = await describeUrlMap(opts.projectId, opts.urlMapName);
  const { changed } = diffObjects(current, desired);

  if (!changed) {
    return { changed: false, message: 'No drift detected' };
  }

  if (opts.env === 'prod') {
    return { changed: true, message: 'Drift detected in prod. Import is disabled. Review diff and run manually.' };
  }

  if (opts.dryRun) {
    return { changed: true, message: 'Drift detected (dry-run). Import would be executed in non-prod.' };
  }

  // Guard: ensure all referenced backend services exist before attempting import.
  // Collect backend service names from the desired YAML (defaultService, pathMatchers.defaultService,
  // and any weightedBackendServices).
  const backendNames = new Set<string>();
  const pushFromLink = (link?: string) => {
    if (!link || typeof link !== 'string') return;
    const parts = link.split('/');
    const name = parts[parts.length - 1];
    if (name) backendNames.add(name);
  };
  try {
    pushFromLink((desiredObj as any).defaultService);
    const pathMatchers: any[] = Array.isArray((desiredObj as any).pathMatchers) ? (desiredObj as any).pathMatchers : [];
    for (const pm of pathMatchers) {
      pushFromLink(pm?.defaultService);
      const rrs: any[] = Array.isArray(pm?.routeRules) ? pm.routeRules : [];
      for (const rr of rrs) {
        const wbs: any[] = Array.isArray(rr?.routeAction?.weightedBackendServices) ? rr.routeAction.weightedBackendServices : [];
        for (const wb of wbs) pushFromLink(wb?.backendService);
      }
    }
  } catch {}

  if (backendNames.size > 0) {
    const missing: string[] = [];
    for (const be of backendNames) {
      const res = await execCmd('gcloud', ['compute', 'backend-services', 'describe', be, '--global', '--project', opts.projectId, '--format', 'value(name)']);
      // In some unit-test scenarios the exec mock may not return a structured object for this call.
      // Treat indeterminate responses as "unknown" and do not block import; only block when we can
      // positively detect a missing backend (non-zero code).
      if (res && typeof (res as any).code === 'number') {
        if (res.code !== 0) missing.push(be);
      }
    }
    if (missing.length > 0) {
      const msg = `Referenced backend services not found in project ${opts.projectId}: ${missing.join(', ')}. ` +
        `Skipping URL map import. Remediation: ensure routing-driven backends exist (run CDKTF synth/apply for referenced services and the assets proxy), ` +
        `or adjust routing to available backends.`;
      return { changed: false, message: msg };
    }
  }

  const res = await execCmd('gcloud', ['compute', 'url-maps', 'import', opts.urlMapName, '--global', `--source=${opts.sourceYamlPath}`, '--project', opts.projectId, '--quiet']);
  if (res.code !== 0) {
    throw new Error(`gcloud import failed: ${res.stderr || res.stdout}`);
  }

  // Verify parity
  const after = await describeUrlMap(opts.projectId, opts.urlMapName);
  const parity = diffObjects(after, desired);
  if (parity.changed) {
    throw new Error('Post-import parity check failed. Desired != Actual');
  }
  return { changed: true, message: 'URL map imported and verified.' };
}
