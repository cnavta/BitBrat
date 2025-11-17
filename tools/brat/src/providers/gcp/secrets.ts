import { execCmd } from '../../orchestration/exec';

function tryLoadSecretManager(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require('@google-cloud/secret-manager');
    return sdk;
  } catch {
    return null;
  }
}

async function sdkResolveLatestEnabledVersion(client: any, projectId: string, secretName: string): Promise<string | null> {
  const parent = `projects/${projectId}/secrets/${secretName}`;
  try {
    const [versions] = await client.listSecretVersions({ parent });
    if (!Array.isArray(versions)) return null;
    // choose latest by createTime among ENABLED
    const enabled = versions.filter((v: any) => (v.state === 'ENABLED') || (v.state?.toString?.().endsWith('ENABLED')));
    if (!enabled.length) return null;
    enabled.sort((a: any, b: any) => {
      const at = new Date(a.createTime?.seconds ? Number(a.createTime.seconds) * 1000 : a.createTime || 0).getTime();
      const bt = new Date(b.createTime?.seconds ? Number(b.createTime.seconds) * 1000 : b.createTime || 0).getTime();
      return bt - at;
    });
    const name: string = enabled[0].name || '';
    const num = name.split('/').pop();
    return num || null;
  } catch {
    return null;
  }
}

async function sdkCheckVersionEnabled(client: any, projectId: string, secretName: string, version: string): Promise<boolean> {
  const name = `projects/${projectId}/secrets/${secretName}/versions/${version}`;
  try {
    const [v] = await client.getSecretVersion({ name });
    const state = v?.state;
    return state === 'ENABLED' || state?.toString?.().endsWith('ENABLED');
  } catch {
    return false;
  }
}

export async function resolveSecretMappingToNumeric(mapping: string, projectId: string): Promise<string> {
  if (!mapping) return '';
  const pairs = mapping.split(';').filter(Boolean);
  const out: string[] = [];
  const sdk = tryLoadSecretManager();
  const client = sdk ? new sdk.SecretManagerServiceClient() : null;

  for (const pair of pairs) {
    const [envName, rhs] = pair.split('=');
    const [secretName, verSpec] = (rhs || '').split(':');
    if (!secretName) continue;

    let ver = '';
    if (client) {
      if (!verSpec || verSpec === 'latest') {
        ver = (await sdkResolveLatestEnabledVersion(client, projectId, secretName)) || '';
      } else {
        const ok = await sdkCheckVersionEnabled(client, projectId, secretName, verSpec);
        ver = ok ? verSpec : '';
      }
    }

    if (!ver) {
      // Fallback to gcloud
      if (!verSpec || verSpec === 'latest') {
        const res = await execCmd('gcloud', ['secrets', 'versions', 'list', secretName, '--project', projectId, '--filter', 'state=ENABLED', '--sort-by', '~createTime', '--limit', '1', '--format', 'value(name)']);
        ver = res.stdout.trim();
      } else {
        const res = await execCmd('gcloud', ['secrets', 'versions', 'describe', `${secretName}/${verSpec}`, '--project', projectId, '--format', 'value(state)']);
        const state = res.stdout.trim();
        if (state === 'ENABLED') ver = verSpec;
      }
    }

    if (!ver) {
      throw new Error(`No ENABLED versions found for secret '${secretName}' (required for '${envName}')`);
    }
    out.push(`${envName}=${secretName}:${ver}`);
  }
  return out.join(';');
}
