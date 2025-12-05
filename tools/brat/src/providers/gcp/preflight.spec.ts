import { assertVpcPreconditions } from './preflight';

jest.mock('../../orchestration/exec', () => {
  return {
    execCmd: jest.fn(async (_cmd: string, _args: string[]) => {
      return { code: 0, stdout: '', stderr: '' } as any;
    }),
  };
});

const { execCmd } = require('../../orchestration/exec');

describe('preflight VPC/connector enforcement', () => {
  const origCI = process.env.CI;

  beforeEach(() => {
    (execCmd as jest.Mock).mockClear();
    process.env.CI = '';
  });

  afterAll(() => {
    process.env.CI = origCI;
  });

  it('blocks --allow-no-vpc in CI', async () => {
    process.env.CI = 'true';
    await expect(assertVpcPreconditions({ projectId: 'p', region: 'us-central1', env: 'dev', allowNoVpc: true }))
      .rejects.toThrow(/not permitted in CI/);
  });

  it('skips checks locally when --allow-no-vpc is set', async () => {
    await expect(assertVpcPreconditions({ projectId: 'p', region: 'us-central1', env: 'dev', allowNoVpc: true }))
      .resolves.toBeUndefined();
    expect((execCmd as jest.Mock).mock.calls.length).toBe(0);
  });

  it('passes when all resources are present (describe-only)', async () => {
    (execCmd as jest.Mock).mockImplementation(async () => ({ code: 0, stdout: '', stderr: '' }));
    await expect(assertVpcPreconditions({ projectId: 'p', region: 'us-central1', env: 'dev' }))
      .resolves.toBeUndefined();
    // VPC, Subnet, Router, Connector (no NAT enforced)
    expect((execCmd as jest.Mock).mock.calls.length).toBe(4);
  });

  it('fails when a required resource is missing', async () => {
    let call = 0;
    (execCmd as jest.Mock).mockImplementation(async () => {
      call++;
      // Make 4th call (Connector describe) fail
      if (call === 4) {
        return { code: 1, stdout: '', stderr: 'not found' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    await expect(assertVpcPreconditions({ projectId: 'p', region: 'us-central1', env: 'dev' }))
      .rejects.toThrow(/Missing or inaccessible Serverless VPC Access Connector/);
  });
});
