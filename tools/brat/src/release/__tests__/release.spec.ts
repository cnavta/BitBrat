import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock the exec facade so tests never touch real npm/git/gh.
// - npm install --package-lock-only -> code 1 forces the deterministic direct-patch lockfile fallback.
// - git tag -> code 0 (success).
// - gh --version -> code 0 (installed).
// - gh release create -> code 0 (success), outputs a mock URL.
jest.mock('../../orchestration/exec', () => ({
  execCmd: jest.fn(async (cmd: string, args?: string[]) => {
    if (cmd === 'npm') return { code: 1, stdout: '', stderr: 'mocked: npm not run in tests' };
    if (cmd === 'git') return { code: 0, stdout: '', stderr: '' };
    if (cmd === 'gh') {
      if (args?.[0] === '--version') {
        return { code: 0, stdout: 'gh version 2.40.0 (2024-01-01)', stderr: '' };
      }
      if (args?.[0] === 'release' && args?.[1] === 'create') {
        const tag = args[2];
        return { code: 0, stdout: `https://github.com/test/repo/releases/tag/${tag}`, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
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

  describe('GitHub Release integration', () => {
    it('--github-release creates a GitHub release via gh CLI', async () => {
      const dir = copyRealRepoFixtures();
      const result = await runRelease({
        rootDir: dir,
        bump: 'patch',
        dryRun: false,
        tag: true,
        githubRelease: true,
        now: DATE,
      });

      expect(result.tagged).toBe(true);
      expect(result.githubReleaseCreated).toBe(true);

      const calls = (execCmd as jest.Mock).mock.calls;
      // Should check gh version
      const ghVersionCall = calls.find((c) => c[0] === 'gh' && c[1]?.[0] === '--version');
      expect(ghVersionCall).toBeTruthy();

      // Should create release
      const ghReleaseCall = calls.find((c) => c[0] === 'gh' && c[1]?.[0] === 'release');
      expect(ghReleaseCall).toBeTruthy();
      expect(ghReleaseCall[1]).toContain('create');
      expect(ghReleaseCall[1]).toContain(`v${result.nextVersion}`);
    });

    it('--github-release in dry-run mode does not call gh CLI', async () => {
      const dir = copyRealRepoFixtures();
      const result = await runRelease({
        rootDir: dir,
        bump: 'patch',
        dryRun: true,
        tag: true,
        githubRelease: true,
        now: DATE,
      });

      expect(result.dryRun).toBe(true);
      expect(result.githubReleaseCreated).toBe(false);

      // No gh calls in dry-run
      const calls = (execCmd as jest.Mock).mock.calls;
      const ghCalls = calls.filter((c) => c[0] === 'gh');
      expect(ghCalls.length).toBe(0);
    });

    it('--github-release without --tag throws error', async () => {
      const dir = copyRealRepoFixtures();
      await expect(
        runRelease({
          rootDir: dir,
          bump: 'patch',
          dryRun: false,
          tag: false,
          githubRelease: true,
          now: DATE,
        }),
      ).rejects.toThrow('GitHub releases require git tags');
    });

    it('--github-release extracts notes from CHANGELOG', async () => {
      const dir = copyRealRepoFixtures();
      const result = await runRelease({
        rootDir: dir,
        bump: 'patch',
        dryRun: false,
        tag: true,
        githubRelease: true,
        now: DATE,
      });

      expect(result.githubReleaseCreated).toBe(true);

      const calls = (execCmd as jest.Mock).mock.calls;
      const ghReleaseCall = calls.find((c) => c[0] === 'gh' && c[1]?.[0] === 'release');
      expect(ghReleaseCall).toBeTruthy();

      // Release notes should be passed via --notes flag
      const notesIndex = ghReleaseCall[1].indexOf('--notes');
      expect(notesIndex).toBeGreaterThan(-1);
      const releaseNotes = ghReleaseCall[1][notesIndex + 1];
      expect(releaseNotes).toBeTruthy();
      expect(typeof releaseNotes).toBe('string');
    });

    it('handles gh CLI failure gracefully (non-fatal)', async () => {
      // Temporarily override mock to simulate gh failure
      const originalMock = (execCmd as jest.Mock).getMockImplementation();
      (execCmd as jest.Mock).mockImplementation(async (cmd: string, args?: string[]) => {
        if (cmd === 'gh' && args?.[0] === 'release') {
          return { code: 1, stdout: '', stderr: 'gh: authentication required' };
        }
        return originalMock?.(cmd, args) || { code: 0, stdout: '', stderr: '' };
      });

      const dir = copyRealRepoFixtures();
      const result = await runRelease({
        rootDir: dir,
        bump: 'patch',
        dryRun: false,
        tag: true,
        githubRelease: true,
        now: DATE,
      });

      // Version bump should succeed even though GitHub release failed
      expect(result.tagged).toBe(true);
      expect(result.githubReleaseCreated).toBe(false);
      expect(result.nextVersion).toBeTruthy();

      // Restore original mock
      (execCmd as jest.Mock).mockImplementation(originalMock);
    });

    it('handles gh CLI not installed gracefully (non-fatal)', async () => {
      // Temporarily override mock to simulate gh not installed
      const originalMock = (execCmd as jest.Mock).getMockImplementation();
      (execCmd as jest.Mock).mockImplementation(async (cmd: string, args?: string[]) => {
        if (cmd === 'gh') {
          return { code: 127, stdout: '', stderr: 'command not found: gh' };
        }
        return originalMock?.(cmd, args) || { code: 0, stdout: '', stderr: '' };
      });

      const dir = copyRealRepoFixtures();
      const result = await runRelease({
        rootDir: dir,
        bump: 'patch',
        dryRun: false,
        tag: true,
        githubRelease: true,
        now: DATE,
      });

      // Version bump should succeed even though gh is not installed
      expect(result.tagged).toBe(true);
      expect(result.githubReleaseCreated).toBe(false);
      expect(result.nextVersion).toBeTruthy();

      // Restore original mock
      (execCmd as jest.Mock).mockImplementation(originalMock);
    });

    it('uses default notes when CHANGELOG.md is missing', async () => {
      const dir = copyRealRepoFixtures();
      // Delete CHANGELOG.md to test default notes
      fs.unlinkSync(path.join(dir, 'CHANGELOG.md'));

      const result = await runRelease({
        rootDir: dir,
        bump: '1.5.0',
        dryRun: false,
        tag: true,
        githubRelease: true,
        now: DATE,
      });

      expect(result.githubReleaseCreated).toBe(true);

      const calls = (execCmd as jest.Mock).mock.calls;
      const ghReleaseCall = calls.find((c) => c[0] === 'gh' && c[1]?.[0] === 'release');
      const notesIndex = ghReleaseCall[1].indexOf('--notes');
      const releaseNotes = ghReleaseCall[1][notesIndex + 1];

      // Should use default notes format
      expect(releaseNotes).toBe('Release 1.5.0');
    });
  });
});
