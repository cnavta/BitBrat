import { execCmd } from '../../orchestration/exec';

export interface VpcPreflightOptions {
  projectId: string;
  region: string;
  env: string;
  allowNoVpc?: boolean;
  dryRun?: boolean;
}

function ciIsTrue(): boolean {
  const ci = String(process.env.CI || '').toLowerCase();
  return ci === 'true' || ci === '1';
}

export async function assertVpcPreconditions(opts: VpcPreflightOptions): Promise<void> {
  const { projectId, region, env, allowNoVpc, dryRun } = opts;

  if (allowNoVpc) {
    if (ciIsTrue()) {
      throw new Error('--allow-no-vpc is not permitted in CI');
    }
    // Local override: permit skipping checks for development
    console.warn('[preflight] --allow-no-vpc specified; skipping VPC/connector enforcement for local development.');
    return;
  }

  const vpcName = 'brat-vpc';
  const subnetName = `brat-subnet-${region}-${env}`;
  const routerName = `brat-router-${region}`;
  const natName = `brat-nat-${region}`;
  const connectorName = `brat-conn-${region}-${env}`;

  const run = async (cmd: string, args: string[], label: string) => {
    const res = await execCmd(cmd, args);
    if (res.code !== 0) {
      const msg = (res.stderr || res.stdout || '').trim();
      throw new Error(`[preflight] Missing or inaccessible ${label}. ${msg || ''}`.trim());
    }
  };

  // We only describe; we do not mutate or enable APIs here to stay side-effect free.
  await run('gcloud', ['compute', 'networks', 'describe', vpcName, '--project', projectId, '--quiet'], 'VPC');
  await run('gcloud', ['compute', 'networks', 'subnets', 'describe', subnetName, '--region', region, '--project', projectId, '--quiet'], 'Subnet');
  await run('gcloud', ['compute', 'routers', 'describe', routerName, '--region', region, '--project', projectId, '--quiet'], 'Cloud Router');
  await run('gcloud', ['compute', 'routers', 'nats', 'describe', natName, '--router', routerName, '--region', region, '--project', projectId, '--quiet'], 'Cloud NAT');
  await run('gcloud', ['compute', 'networks', 'vpc-access', 'connectors', 'describe', connectorName, '--region', region, '--project', projectId, '--quiet'], 'Serverless VPC Access Connector');

  if (dryRun) {
    console.info('[preflight] DRY-RUN: preconditions satisfied (describe-only)');
  }
}
