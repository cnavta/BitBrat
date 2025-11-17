import { execCmd } from '../../orchestration/exec';

export interface LbPreflightOptions {
  projectId: string;
  env: string;
  ipName: string;
  certName: string;
  strict?: boolean; // when true (prod apply), fail if cert not ACTIVE or resources missing
}

export interface LbPreflightResult {
  projectId: string;
  env: string;
  ip: { name: string; exists: boolean; address?: string };
  cert: { name: string; exists: boolean; type?: string; status?: string };
  ok: boolean;
}

async function describeGlobalAddress(projectId: string, name: string): Promise<{ exists: boolean; address?: string }> {
  const args = ['compute', 'addresses', 'describe', name, '--global', '--project', projectId, '--format', 'json'];
  const res = await execCmd('gcloud', args);
  if (res.code !== 0) return { exists: false };
  try {
    const data = JSON.parse(res.stdout || '{}');
    return { exists: true, address: data?.address };
  } catch {
    return { exists: true };
  }
}

async function describeSslCertificate(projectId: string, name: string): Promise<{ exists: boolean; type?: string; status?: string }> {
  const args = ['compute', 'ssl-certificates', 'describe', name, '--global', '--project', projectId, '--format', 'json'];
  const res = await execCmd('gcloud', args);
  if (res.code !== 0) return { exists: false };
  try {
    const data = JSON.parse(res.stdout || '{}');
    const type = data?.type;
    const status = data?.managed?.status || (data?.managedStatus as string | undefined) || undefined;
    return { exists: true, type, status };
  } catch {
    return { exists: true };
  }
}

export async function preflightLbExistingResources(opts: LbPreflightOptions): Promise<LbPreflightResult> {
  const { projectId, env, ipName, certName, strict } = opts;
  const [ip, cert] = await Promise.all([
    describeGlobalAddress(projectId, ipName),
    describeSslCertificate(projectId, certName),
  ]);

  let ok = ip.exists && cert.exists;
  if (strict) {
    // In strict mode require cert ACTIVE when it's a managed certificate (status present)
    if (!ok) {
      return { projectId, env, ip: { name: ipName, ...ip }, cert: { name: certName, ...cert }, ok: false };
    }
    if (cert.status && cert.status.toUpperCase() !== 'ACTIVE') {
      ok = false;
    }
  }

  return {
    projectId,
    env,
    ip: { name: ipName, ...ip },
    cert: { name: certName, ...cert },
    ok,
  };
}
