import { ArchitectureSchema } from './schema';

describe('ArchitectureSchema — Load Balancer inputs (Sprint 16)', () => {
  const base: any = {
    name: 'test-arch',
    deploymentDefaults: { region: 'us-central1', maxConcurrentDeployments: 1 },
  };

  it('accepts managed cert with create ip (non-prod typical)', () => {
    const cfg = {
      ...base,
      lb: {
        ipMode: 'create',
        certMode: 'managed',
        services: [
          { name: 'api', regions: ['us-central1'], runService: { name: 'api-svc' } },
        ],
      },
    };
    const res = ArchitectureSchema.safeParse(cfg);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.lb?.ipMode).toBe('create');
      expect(res.data.lb?.certMode).toBe('managed');
      expect(res.data.lb?.services?.[0].name).toBe('api');
    }
  });

  it('accepts use-existing cert with certRef and ip lookup mode', () => {
    const cfg = {
      ...base,
      lb: {
        ipMode: 'use-existing',
        ipName: 'global-ip',
        certMode: 'use-existing',
        certRef: 'projects/p/global/sslCertificates/my-cert',
        services: [
          { name: 'web', runService: { name: 'web-svc', projectId: 'p' } },
        ],
      },
    };
    const res = ArchitectureSchema.safeParse(cfg);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.lb?.ipMode).toBe('use-existing');
      expect(res.data.lb?.ipName).toBe('global-ip');
      expect(res.data.lb?.certRef).toContain('sslCertificates');
    }
  });

  it('fails when certMode is use-existing but certRef missing', () => {
    const cfg = {
      ...base,
      lb: {
        ipMode: 'use-existing',
        certMode: 'use-existing',
        services: [],
      },
    };
    const res = ArchitectureSchema.safeParse(cfg);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(i => i.path.join('.') === 'lb.certRef');
      expect(issue).toBeTruthy();
    }
  });

  it('fails on invalid enum values for ipMode/certMode', () => {
    const cfg = {
      ...base,
      lb: {
        ipMode: 'allocate' as any,
        certMode: 'self-signed' as any,
        services: [],
      },
    };
    const res = ArchitectureSchema.safeParse(cfg);
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('lb.ipMode');
      expect(paths).toContain('lb.certMode');
    }
  });
});
