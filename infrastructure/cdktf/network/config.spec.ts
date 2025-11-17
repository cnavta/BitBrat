import { NetworkConfigSchema } from './config';

describe('NetworkConfigSchema', () => {
  it('accepts valid config and applies defaults', () => {
    const input = {
      projectId: 'my-proj',
      environment: 'dev',
      regions: ['us-central1'],
      cidrBlocks: { 'us-central1': '10.10.0.0/20' },
    } as any;
    const parsed = NetworkConfigSchema.parse(input);
    expect(parsed.projectId).toBe('my-proj');
    expect(parsed.environment).toBe('dev');
    expect(parsed.enableFlowLogs).toBe(false);
  });

  it('rejects invalid CIDR block', () => {
    const bad = {
      projectId: 'p',
      environment: 'dev',
      regions: ['us-central1'],
      cidrBlocks: { 'us-central1': '10.10.0.0' },
    } as any;
    expect(() => NetworkConfigSchema.parse(bad)).toThrow();
  });

  it('requires at least one region', () => {
    const bad = {
      projectId: 'p',
      environment: 'dev',
      regions: [],
      cidrBlocks: {},
    } as any;
    expect(() => NetworkConfigSchema.parse(bad)).toThrow();
  });
});
