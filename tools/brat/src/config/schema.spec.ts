import { ArchitectureSchema } from './schema';

describe('ArchitectureSchema', () => {
  it('accepts minimal architecture with defaults', () => {
    const raw = {
      name: 'BitBrat Platform',
      services: {
        'oauth-flow': { description: 'OAuth flow' },
      },
      deploymentDefaults: { region: 'us-central1', maxConcurrentDeployments: 1 },
    };
    const res = ArchitectureSchema.safeParse(raw);
    expect(res.success).toBe(true);
  });

  it('provides default empty services when missing', () => {
    const raw = { name: 'Empty' };
    const res = ArchitectureSchema.safeParse(raw);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.services).toEqual({});
    }
  });
});
