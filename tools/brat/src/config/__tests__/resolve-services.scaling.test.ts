import { resolveServices } from '../../config/loader';
import type { Architecture } from '../../config/schema';

describe('resolveServices – scaling defaults', () => {
  it('applies defaults.services.scaling when service.scaling is not set', () => {
    const arch: Architecture = {
      name: 'Test',
      defaults: {
        services: {
          region: 'us-central1',
          port: 3000,
          scaling: { min: 2, max: 6 },
        },
      },
      services: {
        svcA: { entry: 'a.ts' },
      },
      deploymentDefaults: {
        maxConcurrentDeployments: 1,
        region: 'us-central1',
        'cloud-run': { minInstances: 0, maxInstances: 100, cpu: '1', memory: '512Mi' },
      },
    } as any;

    const res = resolveServices(arch);
    expect(res.svcA.minInstances).toBe(2);
    expect(res.svcA.maxInstances).toBe(6);
  });

  it('service-level scaling overrides defaults', () => {
    const arch: Architecture = {
      name: 'Test',
      defaults: { services: { port: 3000, scaling: { min: 2, max: 6 } } },
      services: {
        svcB: { entry: 'b.ts', scaling: { min: 0, max: 1 } },
      },
      deploymentDefaults: { maxConcurrentDeployments: 1, region: 'us-central1', 'cloud-run': { minInstances: 5, maxInstances: 9 } },
    } as any;
    const res = resolveServices(arch);
    expect(res.svcB.minInstances).toBe(0);
    expect(res.svcB.maxInstances).toBe(1);
  });

  it('falls back to deploymentDefaults.cloud-run when no defaults.services.scaling provided', () => {
    const arch: Architecture = {
      name: 'Test',
      defaults: { services: { port: 3000 } },
      services: {
        svcC: { entry: 'c.ts' },
      },
      deploymentDefaults: { maxConcurrentDeployments: 1, region: 'us-central1', 'cloud-run': { minInstances: 4, maxInstances: 8 } },
    } as any;
    const res = resolveServices(arch);
    expect(res.svcC.minInstances).toBe(4);
    expect(res.svcC.maxInstances).toBe(8);
  });

  it('supports partial service-level overrides (e.g., only min)', () => {
    const arch: Architecture = {
      name: 'Test',
      defaults: { services: { scaling: { min: 2, max: 6 } } },
      services: {
        svcD: { entry: 'd.ts', scaling: { min: 3 } as any },
      },
      deploymentDefaults: { maxConcurrentDeployments: 1, region: 'us-central1', 'cloud-run': { minInstances: 0, maxInstances: 100 } as any },
    } as any;
    const res = resolveServices(arch);
    expect(res.svcD.minInstances).toBe(3);
    expect(res.svcD.maxInstances).toBe(6); // inherited default max
  });
});
