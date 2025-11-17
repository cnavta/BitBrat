import { execCmd } from './exec';

describe('execCmd streaming', () => {
  jest.setTimeout(10000);

  it('invokes onStdout for stdout data', async () => {
    const chunks: string[] = [];
    const res = await execCmd('node', ['-e', "console.log('hello'); console.log('world');"], {
      onStdout: (c) => chunks.push(c),
    });
    expect(res.code).toBe(0);
    const combined = chunks.join('');
    expect(combined).toContain('hello');
    expect(combined).toContain('world');
  });

  it('invokes onStderr for stderr data', async () => {
    const errs: string[] = [];
    const res = await execCmd('node', ['-e', "console.error('oops');"], {
      onStderr: (c) => errs.push(c),
    });
    expect(res.code).toBe(0);
    expect(errs.join('')).toContain('oops');
  });
});
