import { computeDeploySubstitutions } from '../../cli/index';
import type { ResolvedServiceConfig } from '../../config/loader';

describe('computeDeploySubstitutions – scaling propagation', () => {
  it('includes min/max instances from resolved service config', () => {
    const svc: ResolvedServiceConfig = {
      name: 'svc-x',
      region: 'us-central1',
      port: 3000,
      minInstances: 2,
      maxInstances: 7,
      cpu: '2',
      memory: '1Gi',
      allowUnauth: true,
      envKeys: ['A', 'B'],
      secrets: ['S1']
    } as any;

    const subs = computeDeploySubstitutions({
      svc,
      repoName: 'bitbrat-services',
      region: undefined,
      tag: 't1',
      allowUnauth: true,
      dockerfile: 'Dockerfile.svc-x',
      envVarsArg: 'A=1;B=2',
      secretSetArg: 'S1=S1:latest',
      ingressPolicy: 'internal-and-cloud-load-balancing',
      vpcConnectorName: 'brat-conn-us-central1-dev',
    });

    expect(subs._MIN_INSTANCES).toBe(2);
    expect(subs._MAX_INSTANCES).toBe(7);
    expect(subs._CPU).toBe('2');
    expect(subs._MEMORY).toBe('1Gi');
    expect(subs._PORT).toBe(3000);
  });
});
