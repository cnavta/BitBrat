import { resolveSecretMappingToNumeric } from './secrets';

jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async (cmd: string, args: string[]) => {
    if (args[0] === 'secrets' && args[1] === 'versions' && args[2] === 'list') {
      // return latest enabled version id
      return { code: 0, stdout: '5', stderr: '' } as any;
    }
    if (args[0] === 'secrets' && args[1] === 'versions' && args[2] === 'describe') {
      // enabled
      return { code: 0, stdout: 'ENABLED', stderr: '' } as any;
    }
    return { code: 0, stdout: '', stderr: '' } as any;
  }),
}));

describe('Secret Manager resolver', () => {
  const projectId = 'test-proj';

  it('resolves latest to numeric using fallback when SDK missing', async () => {
    const mapping = 'FOO=FOO:latest;BAR=BAR:latest';
    const out = await resolveSecretMappingToNumeric(mapping, projectId);
    expect(out).toBe('FOO=FOO:5;BAR=BAR:5');
  });

  it('passes through pinned version if ENABLED via fallback', async () => {
    const mapping = 'FOO=FOO:3';
    const out = await resolveSecretMappingToNumeric(mapping, projectId);
    expect(out).toBe('FOO=FOO:3');
  });

  it('throws when no enabled version found', async () => {
    const { execCmd } = require('../../orchestration/exec');
    (execCmd as jest.Mock).mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });
    await expect(resolveSecretMappingToNumeric('BAZ=BAZ:latest', projectId)).rejects.toThrow(/No ENABLED versions/);
  });
});
