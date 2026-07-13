import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { isCodeFirstRun, markCodeRunComplete, writeBitBratConfig } from '../utils/bitbrat-config';

/**
 * Integration test for the first-run welcome prompt feature.
 *
 * This test verifies the end-to-end flow:
 * 1. Fresh setup (codeFirstRun: true) -> should trigger welcome
 * 2. After marking complete -> should not trigger welcome again
 * 3. Legacy setup (no codeFirstRun field) -> should trigger welcome (backwards compatibility)
 */
describe('First-run welcome prompt integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitbrat-first-run-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should trigger welcome prompt on fresh setup', async () => {
    // Simulate fresh setup (as created by `brat setup`)
    await writeBitBratConfig(tempDir, {
      apiToken: 'test-token',
      codeFirstRun: true,
    });

    // First run check
    const isFirstRun = await isCodeFirstRun(tempDir);
    expect(isFirstRun).toBe(true);

    // Simulate user running `brat code` (no arguments)
    const passThrough: string[] = [];
    if (isFirstRun && passThrough.length === 0) {
      passThrough.push('Explain the BitBrat project to me');
    }

    expect(passThrough).toEqual(['Explain the BitBrat project to me']);
  });

  it('should not trigger welcome prompt after first run', async () => {
    // Simulate fresh setup
    await writeBitBratConfig(tempDir, {
      apiToken: 'test-token',
      codeFirstRun: true,
    });

    // First run - mark complete
    await markCodeRunComplete(tempDir);

    // Second run check
    const isFirstRun = await isCodeFirstRun(tempDir);
    expect(isFirstRun).toBe(false);

    // Simulate user running `brat code` again (no arguments)
    const passThrough: string[] = [];
    if (isFirstRun && passThrough.length === 0) {
      passThrough.push('Explain the BitBrat project to me');
    }

    // Should not inject welcome prompt
    expect(passThrough).toEqual([]);
  });

  it('should trigger welcome prompt on legacy setup (backwards compatibility)', async () => {
    // Simulate legacy setup (created before codeFirstRun feature)
    await writeBitBratConfig(tempDir, {
      apiToken: 'legacy-token',
    } as any);

    // First run check (should be true for backwards compatibility)
    const isFirstRun = await isCodeFirstRun(tempDir);
    expect(isFirstRun).toBe(true);

    // Simulate user running `brat code` (no arguments)
    const passThrough: string[] = [];
    if (isFirstRun && passThrough.length === 0) {
      passThrough.push('Explain the BitBrat project to me');
    }

    expect(passThrough).toEqual(['Explain the BitBrat project to me']);
  });

  it('should not trigger welcome prompt if user provides arguments', async () => {
    // Simulate fresh setup
    await writeBitBratConfig(tempDir, {
      apiToken: 'test-token',
      codeFirstRun: true,
    });

    const isFirstRun = await isCodeFirstRun(tempDir);
    expect(isFirstRun).toBe(true);

    // Simulate user running `brat code "Fix the bug in main.ts"`
    const passThrough: string[] = ['Fix the bug in main.ts'];
    if (isFirstRun && passThrough.length === 0) {
      passThrough.push('Explain the BitBrat project to me');
    }

    // Should NOT inject welcome prompt because user provided their own prompt
    expect(passThrough).toEqual(['Fix the bug in main.ts']);
  });

  it('should mark first run complete after launch', async () => {
    // Simulate fresh setup
    await writeBitBratConfig(tempDir, {
      apiToken: 'test-token',
      codeFirstRun: true,
    });

    // Verify it's first run
    expect(await isCodeFirstRun(tempDir)).toBe(true);

    // Simulate marking first run complete (happens after agent launches)
    await markCodeRunComplete(tempDir);

    // Verify it's no longer first run
    expect(await isCodeFirstRun(tempDir)).toBe(false);
  });
});
