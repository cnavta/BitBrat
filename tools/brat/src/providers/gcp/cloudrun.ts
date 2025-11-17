import { execCmd } from '../../orchestration/exec';

function tryLoadGoogleApis(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const google = require('googleapis').google;
    return google;
  } catch {
    return null;
  }
}

export interface CloudRunServiceDesc {
  name: string;
  url?: string;
  status?: string;
  latestReadyRevision?: string;
}

export async function describeService(projectId: string, region: string, serviceName: string): Promise<CloudRunServiceDesc | null> {
  const google = tryLoadGoogleApis();
  if (google) {
    try {
      const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      const run = google.run('v2');
      const name = `projects/${projectId}/locations/${region}/services/${serviceName}`;
      const res = await run.projects.locations.services.get({ name, auth } as any);
      const data: any = (res as any).data || {};
      return {
        name: data.name || name,
        url: data.uri || data.url,
        status: data?.conditions?.filter?.((c: any) => c.type === 'Ready')?.[0]?.state || data?.status,
        latestReadyRevision: data?.latestReadyRevision || data?.latestReadyRevisionName,
      };
    } catch {
      // ignore and fallback
    }
  }
  const args = ['run', 'services', 'describe', serviceName, '--project', projectId, '--region', region, '--format', 'json'];
  const res = await execCmd('gcloud', args);
  try {
    const data = JSON.parse(res.stdout || '{}');
    return {
      name: data?.metadata?.name || serviceName,
      url: data?.status?.url || data?.uri,
      status: data?.status?.conditions?.find?.((c: any) => c.type === 'Ready')?.status,
      latestReadyRevision: data?.status?.latestReadyRevisionName,
    };
  } catch {
    return null;
  }
}
