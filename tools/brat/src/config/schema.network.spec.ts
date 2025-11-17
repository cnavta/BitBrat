import { ArchitectureSchema } from './schema';

describe('Network overlays schema (Sprint 15)', () => {
  it('accepts valid network overlays with regions, subnets, flow logs, and remote state', () => {
    const arch = {
      name: 'test',
      services: {},
      network: {
        regions: ['us-central1', 'us-west1'],
        subnets: {
          'us-central1': { cidr: '10.10.0.0/20' },
          'us-west1': { name: 'west-subnet', cidr: '10.20.0.0/20' },
        },
        enableFlowLogs: true,
        remoteState: { bucket: 'tf-state-bucket', prefix: 'network/dev' },
      },
    } as any;

    const parsed = ArchitectureSchema.parse(arch) as any;
    expect(parsed.network).toBeDefined();
    expect(parsed.network.regions).toEqual(['us-central1', 'us-west1']);
    expect(parsed.network.subnets['us-west1'].name).toBe('west-subnet');
    expect(parsed.network.enableFlowLogs).toBe(true);
    expect(parsed.network.remoteState.bucket).toBe('tf-state-bucket');
  });

  it('applies defaults: regions default to ["us-central1"], flow logs default false; network optional', () => {
    const archNoNetwork = { name: 'test', services: {} } as any;
    const parsed1 = ArchitectureSchema.parse(archNoNetwork) as any;
    expect(parsed1.network).toBeUndefined();

    const archEmptyNetwork = { name: 'test', services: {}, network: {} } as any;
    const parsed2 = ArchitectureSchema.parse(archEmptyNetwork) as any;
    expect(parsed2.network.regions).toEqual(['us-central1']);
    expect(parsed2.network.enableFlowLogs).toBe(false);
  });

  it('rejects subnets missing required cidr', () => {
    const bad = {
      name: 'test',
      services: {},
      network: {
        regions: ['us-central1'],
        subnets: {
          'us-central1': { /* missing cidr */ } as any,
        },
      },
    } as any;
    expect(() => ArchitectureSchema.parse(bad)).toThrow();
  });
});
