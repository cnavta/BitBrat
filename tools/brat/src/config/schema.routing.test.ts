import { ArchitectureSchema, parseArchitecture } from './schema';

describe('Sprint 20 — Schema routing and cross-reference validation', () => {
  const base: any = {
    name: 'bitbrat',
    deploymentDefaults: { region: 'us-central1', maxConcurrentDeployments: 1 },
    services: {
      'oauth-flow': { active: true, entry: 'src/apps/oauth-service.ts' },
      'ingress-egress': { active: true, entry: 'src/apps/ingress-egress-service.ts' },
      auth: { active: false, entry: 'src/apps/auth-service.ts' },
    },
    infrastructure: {
      target: 'gcp',
      resources: {
        'default-content-bucket': {
          type: 'object-store',
          implementation: 'cloud-storage',
          description: 'Static assets bucket',
          access_policy: 'private',
        },
      },
    },
  };

  it('validates service-only rule and collects referenced services', () => {
    const raw = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/oauth', service: 'oauth-flow' },
              ],
            },
          },
        },
      },
    };
    const parsed = parseArchitecture(raw);
    expect(parsed.metadata.referencedServiceIds.sort()).toEqual(['oauth-flow']);
    expect(parsed.metadata.referencedBucketKeys).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('validates bucket-only rule and collects referenced buckets', () => {
    const raw = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/assets', bucket: 'default-content-bucket' },
              ],
            },
          },
        },
      },
    };
    const parsed = parseArchitecture(raw);
    expect(parsed.metadata.referencedServiceIds).toEqual([]);
    expect(parsed.metadata.referencedBucketKeys).toEqual(['default-content-bucket']);
  });

  it('supports mixed rules and default_bucket reference', () => {
    const raw = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              default_bucket: 'default-content-bucket',
              rules: [
                { path_prefix: '/oauth', service: 'oauth-flow' },
                { path_prefix: '/assets', bucket: 'default-content-bucket' },
              ],
            },
          },
        },
      },
    };
    const parsed = parseArchitecture(raw);
    expect(parsed.metadata.referencedServiceIds.sort()).toEqual(['oauth-flow']);
    expect(parsed.metadata.referencedBucketKeys.sort()).toEqual(['default-content-bucket']);
  });

  it('errors when both service and bucket are set on a rule', () => {
    const raw = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/bad', service: 'oauth-flow', bucket: 'default-content-bucket' },
              ],
            },
          },
        },
      },
    };
    expect(() => ArchitectureSchema.parse(raw)).toThrow(/exactly one of service or bucket/);
  });

  it('errors when service reference is missing', () => {
    const raw = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/missing', service: 'does-not-exist' },
              ],
            },
          },
        },
      },
    };
    expect(() => parseArchitecture(raw)).toThrow(/references unknown service 'does-not-exist'/);
  });

  it('errors when bucket reference is missing or wrong type', () => {
    const badMissing = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/assets', bucket: 'missing' },
              ],
            },
          },
        },
      },
    };
    expect(() => parseArchitecture(badMissing)).toThrow(/references missing resource 'missing'/);

    const badType = {
      ...base,
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          otherlb: {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb2',
            ip: 'ip2',
            routing: { default_domain: 'x', rules: [] },
          },
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/assets', bucket: 'otherlb' },
              ],
            },
          },
        },
      },
    };
    expect(() => parseArchitecture(badType)).toThrow(/must reference an object-store with implementation=cloud-storage/);
  });

  it('emits deprecation warning when lb.services[] co-exists with routing-driven LB', () => {
    const raw = {
      ...base,
      lb: {
        ipMode: 'use-existing',
        certMode: 'managed',
        services: [{ name: 'legacy' }],
      },
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/oauth', service: 'oauth-flow' },
              ],
            },
          },
        },
      },
    };
    const res = parseArchitecture(raw);
    expect(res.warnings.join(' ')).toMatch(/Deprecation: lb\.services\[\]/);
  });

  it('warns but does not error when referenced service is inactive', () => {
    const raw = {
      ...base,
      services: { ...base.services, auth: { active: false, entry: 'x' } },
      infrastructure: {
        ...base.infrastructure,
        resources: {
          ...base.infrastructure.resources,
          'main-load-balancer': {
            type: 'load-balancer',
            implementation: 'global-external-application-lb',
            name: 'lb',
            ip: 'bitbrat-ip',
            routing: {
              default_domain: 'api.example.com',
              rules: [
                { path_prefix: '/auth', service: 'auth' },
              ],
            },
          },
        },
      },
    };
    const res = parseArchitecture(raw);
    expect(res.warnings.join(' ')).toMatch(/inactive/);
    expect(res.metadata.referencedServiceIds).toEqual(['auth']);
  });
});
