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
