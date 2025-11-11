import { execCmd } from '../../orchestration/exec';

export async function resolveSecretMappingToNumeric(mapping: string, projectId: string): Promise<string> {
  if (!mapping) return '';
  const pairs = mapping.split(';').filter(Boolean);
  const out: string[] = [];
  for (const pair of pairs) {
    const [envName, rhs] = pair.split('=');
    const secretName = (rhs || '').split(':')[0];
    if (!secretName) continue;
    const res = await execCmd('gcloud', ['secrets', 'versions', 'list', secretName, '--project', projectId, '--filter', 'state=ENABLED', '--sort-by', '~createTime', '--limit', '1', '--format', 'value(name)']);
    const ver = res.stdout.trim();
    if (!ver) {
      throw new Error(`No ENABLED versions found for secret '${secretName}' (required for '${envName}')`);
    }
    out.push(`${envName}=${secretName}:${ver}`);
  }
  return out.join(';');
}
