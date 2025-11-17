import { preflightLbExistingResources } from './lb-preflight';

jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async (cmd: string, args: string[]) => {
    const joined = `${cmd} ${args.join(' ')}`;
    if (joined.includes('compute addresses describe')) {
      return { code: 0, stdout: JSON.stringify({ address: '34.123.45.67' }), stderr: '' };
    }
    if (joined.includes('compute ssl-certificates describe')) {
      // Default to ACTIVE
      return { code: 0, stdout: JSON.stringify({ type: 'MANAGED', managed: { status: 'ACTIVE' } }), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unknown resource' };
  }),
}));

const { execCmd } = require('../../orchestration/exec');

describe('gcp lb preflight', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns ok when ip exists and cert ACTIVE in strict mode', async () => {
    const res = await preflightLbExistingResources({ projectId: 'p1', env: 'prod', ipName: 'ip1', certName: 'cert1', strict: true });
    expect(res.ok).toBe(true);
    expect(res.ip.exists).toBe(true);
    expect(res.cert.exists).toBe(true);
    expect(res.cert.status).toBe('ACTIVE');
  });

  it('fails strict when cert not ACTIVE but passes non-strict', async () => {
    (execCmd as jest.Mock).mockImplementationOnce(async () => ({ code: 0, stdout: JSON.stringify({ address: '34.123.45.67' }), stderr: '' }))
      .mockImplementationOnce(async () => ({ code: 0, stdout: JSON.stringify({ type: 'MANAGED', managed: { status: 'PROVISIONING' } }), stderr: '' }));

    const strictRes = await preflightLbExistingResources({ projectId: 'p1', env: 'prod', ipName: 'ip1', certName: 'cert1', strict: true });
    expect(strictRes.ok).toBe(false);
    expect(strictRes.cert.status).toBe('PROVISIONING');

    // non-strict: rerun with same mocks
    (execCmd as jest.Mock).mockImplementationOnce(async () => ({ code: 0, stdout: JSON.stringify({ address: '34.123.45.67' }), stderr: '' }))
      .mockImplementationOnce(async () => ({ code: 0, stdout: JSON.stringify({ type: 'MANAGED', managed: { status: 'PROVISIONING' } }), stderr: '' }));
    const nonStrictRes = await preflightLbExistingResources({ projectId: 'p1', env: 'dev', ipName: 'ip1', certName: 'cert1', strict: false });
    expect(nonStrictRes.ok).toBe(true);
  });
});
