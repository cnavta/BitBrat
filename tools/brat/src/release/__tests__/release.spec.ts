import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock the exec facade so tests never touch real npm/git.
// - npm install --package-lock-only -> code 1 forces the deterministic direct-patch lockfile fallback.
// - git tag -> code 0 (success).
jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async (cmd: string) => {
    if (cmd === 'npm') return { code: 1, stdout: '', stderr: 'mocked: npm not run in tests' };
    if (cmd === 'git') return { code: 0, stdout: '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  }),
}));

import { runRelease } from '../release';
import { readArchitectureVersion, readPackageJsonVersion, readPackageLockVersion } from '../version-files';
import { execCmd } from '../../orchestration/exec';

const DATE = new Date(Date.UTC(2026, 5, 26)); // 2026-06-26

/** Copy the three real version files + CHANGELOG into a fresh temp repo dir. */
function copyRealRepoFixtures(): string {
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-release-e2e-'));
  for (const f of ['architecture.yaml', 'package.json', 'package-lock.json', 'CHANGELOG.md']) {
    fs.copyFileSync(path.join(root, f), path.join(dir, f));
  }
  return dir;
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ['architecture.yaml', 'package.json', 'package-lock.json', 'CHANGELOG.md']) {
    out[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return out;
}

describe('release/runRelease (integration over real-file fixtures)', () => {
  beforeEach(() => {
    (execCmd as jest.Mock).mockClear();
  });

  it('dry-run computes the bump but writes NOTHING', async () => {
    const dir = copyRealRepoFixtures();
    const before = snapshot(dir);
    const current = readArchitectureVersion(dir);

    const result = await runRelease({ rootDir: dir, bump: 'patch', dryRun: true, now: DATE });

    expect(result.dryRun).toBe(true);
    expect(result.previousVersion).toBe(current);
    // Zero filesystem mutation.
    expect(snapshot(dir)).toEqual(before);
    // No npm/git side effects in dry-run.
    expect(execCmd as jest.Mock).not.toHaveBeenCalled();
  });

  it('real patch bump updates all three files consistently + rolls CHANGELOG', async () => {
    const dir = copyRealRepoFixtures();
    const current = readArchitectureVersion(dir);
    const [maj, min, pat] = current.split('.').map(Number);
    const expected = `${maj}.${min}.${pat + 1}`;

    const result = await runRelease({ rootDir: dir, bump: 'patch', dryRun: false, now: DATE });

    expect(result.nextVersion).toBe(expected);
    expect(readArchitectureVersion(dir)).toBe(expected);
    expect(readPackageJsonVersion(dir)).toBe(expected);
    expect(readPackageLockVersion(dir)).toBe(expected); // synced via the mocked-npm fallback patch
    expect(result.consistency?.ok).toBe(true);
    expect(result.changelogRolled).toBe(true);

    const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain(`## [${expected}] - 2026-06-26`);
    expect(changelog).toContain('## [Unreleased]');
  });

  it('explicit version is honored verbatim', async () => {
    const dir = copyRealRepoFixtures();
    const result = await runRelease({ rootDir: dir, bump: '1.2.3', dryRun: false, now: DATE });
    expect(result.nextVersion).toBe('1.2.3');
    expect(readArchitectureVersion(dir)).toBe('1.2.3');
    expect(readPackageJsonVersion(dir)).toBe('1.2.3');
  });

  it('end-to-end is idempotent on the CHANGELOG for a repeated explicit version', async () => {
    const dir = copyRealRepoFixtures();
    await runRelease({ rootDir: dir, bump: '0.9.0', dryRun: false, now: DATE });
    const afterFirst = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    const second = await runRelease({ rootDir: dir, bump: '0.9.0', dryRun: false, now: DATE });
    expect(second.changelogRolled).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')).toBe(afterFirst);
  });

  it('--tag invokes git tag (mocked) without pushing', async () => {
    const dir = copyRealRepoFixtures();
    const result = await runRelease({ rootDir: dir, bump: 'patch', dryRun: false, tag: true, now: DATE });
    expect(result.tagged).toBe(true);
    const calls = (execCmd as jest.Mock).mock.calls;
    const gitCall = calls.find((c) => c[0] === 'git');
    expect(gitCall).toBeTruthy();
    expect(gitCall[1]).toEqual(['tag', `v${result.nextVersion}`]);
    // Never pushes.
    expect(calls.some((c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('push'))).toBe(false);
  });

  it('fails closed on an invalid bump argument (no file mutation)', async () => {
    const dir = copyRealRepoFixtures();
    const before = snapshot(dir);
    await expect(runRelease({ rootDir: dir, bump: 'nonsense', dryRun: false, now: DATE })).rejects.toThrow();
    expect(snapshot(dir)).toEqual(before);
  });
});
