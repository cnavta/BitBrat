/**
 * Release orchestrator for the `brat release` tool (sprint-326, BL-326-300 core).
 *
 * Ties the version core + CHANGELOG transformer together into one idempotent, dry-run-able flow:
 *   compute -> write architecture.yaml (only project.version) + package.json -> sync lockfile ->
 *   assert 3-file consistency -> roll CHANGELOG -> (optional) git tag.
 *
 * The CLI (tools/brat/src/cli/release.ts) is a thin shell over `runRelease`. Logging goes through the
 * injected logger facade (AGENTS.md §8). Side effects are gated by `dryRun`.
 */

import * as fs from 'fs';
import type { Logger } from '../orchestration/logger';
import { execCmd } from '../orchestration/exec';
import { computeNextVersion } from './semver';
import {
  readArchitectureVersion,
  writeArchitectureVersion,
  writePackageJsonVersion,
  syncLockfileVersion,
  assertVersionsConsistent,
  versionFilePaths,
  VersionConsistency,
} from './version-files';
import { rollChangelog } from './changelog';

/** Options for {@link runRelease}. */
export interface ReleaseOptions {
  /** Repo root that contains architecture.yaml / package.json / package-lock.json / CHANGELOG.md. */
  rootDir: string;
  /** Bump argument: `patch | minor | major | <explicit x.y.z>`. */
  bump: string;
  /** When true, compute and report but write NOTHING. */
  dryRun: boolean;
  /** When true, create a local annotated-less `git tag v<version>` (never pushes). Off by default. */
  tag?: boolean;
  /** When true, create a GitHub Release via gh CLI (requires tag to be true). Off by default. */
  githubRelease?: boolean;
  /** Date used for the CHANGELOG dated heading (injectable for deterministic tests). */
  now?: Date;
  /** Optional logger facade. */
  logger?: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>;
}

/** Outcome of a release run. */
export interface ReleaseResult {
  previousVersion: string;
  nextVersion: string;
  dryRun: boolean;
  tagged: boolean;
  githubReleaseCreated: boolean;
  changelogRolled: boolean;
  consistency: VersionConsistency | null;
}

const CHANGELOG_FILE = 'CHANGELOG.md';

/**
 * Execute (or dry-run) a release. Returns a structured result; throws (fail-closed) on invalid input or
 * any post-write validation failure.
 */
export async function runRelease(opts: ReleaseOptions): Promise<ReleaseResult> {
  const { rootDir, bump, dryRun } = opts;
  const now = opts.now ?? new Date();
  const log = opts.logger;

  const previousVersion = readArchitectureVersion(rootDir);
  const nextVersion = computeNextVersion(previousVersion, bump);
  log?.info(
    { action: 'release.compute', previousVersion, nextVersion, bump, dryRun },
    `Release ${previousVersion} -> ${nextVersion}${dryRun ? ' (dry-run)' : ''}`,
  );

  // 1) architecture.yaml (authoritative; only project.version; re-validated) + 2) package.json.
  writeArchitectureVersion(rootDir, nextVersion, dryRun);
  writePackageJsonVersion(rootDir, nextVersion, dryRun);
  log?.debug({ action: 'release.write-files', dryRun }, 'Wrote architecture.yaml + package.json version');

  // 3) Lockfile sync (npm install --package-lock-only, with direct-patch fallback).
  await syncLockfileVersion(rootDir, nextVersion, dryRun);

  // 4) Three-file consistency self-check (skipped in dry-run, since nothing was written).
  let consistency: VersionConsistency | null = null;
  if (!dryRun) {
    consistency = assertVersionsConsistent(rootDir);
    log?.info({ action: 'release.verify', ...consistency }, 'Version consistent across all three files');
  }

  // 5) CHANGELOG rollover (idempotent).
  const changelogRolled = rollChangelogFile(rootDir, nextVersion, now, dryRun, log);

  // 6) Optional git tag (local only; never pushes).
  let tagged = false;
  if (opts.tag) {
    tagged = await createGitTag(rootDir, nextVersion, dryRun, log);
  }

  // 7) Optional GitHub Release creation (requires tag).
  let githubReleaseCreated = false;
  if (opts.githubRelease) {
    if (!opts.tag) {
      log?.error(
        { action: 'release.github', status: 'validation-failed', reason: 'tag-required' },
        'GitHub releases require git tags. Use --tag with --github-release',
      );
      throw new Error('GitHub releases require git tags. Use --tag with --github-release');
    }

    // Read CHANGELOG to extract release notes
    const changelogPath = `${rootDir}/${CHANGELOG_FILE}`;
    let releaseNotes = `Release ${nextVersion}`;
    if (fs.existsSync(changelogPath)) {
      const changelogContent = fs.readFileSync(changelogPath, 'utf8');
      const { extractReleaseNotes } = await import('./changelog');
      releaseNotes = extractReleaseNotes(changelogContent, nextVersion);
    } else {
      log?.warn(
        { action: 'release.github', status: 'changelog-not-found' },
        'CHANGELOG.md not found — using default release notes',
      );
    }

    const success = await createGitHubRelease(rootDir, nextVersion, releaseNotes, dryRun, log);
    // In dry-run mode, nothing was actually created; in normal mode, set based on success
    githubReleaseCreated = dryRun ? false : success;
    if (!success && !dryRun) {
      // Non-fatal: version bump succeeded, but GitHub release failed
      log?.warn(
        { action: 'release.github', status: 'failed-non-fatal' },
        'GitHub release creation failed, but version bump completed successfully',
      );
    }
  }

  return { previousVersion, nextVersion, dryRun, tagged, githubReleaseCreated, changelogRolled, consistency };
}

/** Roll the CHANGELOG file on disk. Returns true if a change was (or would be) applied. */
function rollChangelogFile(
  rootDir: string,
  version: string,
  now: Date,
  dryRun: boolean,
  log?: Pick<Logger, 'info' | 'warn' | 'debug'>,
): boolean {
  const changelogPath = `${rootDir}/${CHANGELOG_FILE}`;
  if (!fs.existsSync(changelogPath)) {
    log?.warn({ action: 'release.changelog', status: 'skipped', reason: 'not-found' }, 'CHANGELOG.md not found — skipping rollover');
    return false;
  }
  const before = fs.readFileSync(changelogPath, 'utf8');
  const after = rollChangelog(before, version, now);
  const changed = after !== before;
  if (!changed) {
    log?.info({ action: 'release.changelog', status: 'noop', version }, 'CHANGELOG already rolled for this version (idempotent)');
    return false;
  }
  if (dryRun) {
    log?.info({ action: 'release.changelog', status: 'dry-run', version }, `DRY-RUN: would roll CHANGELOG [Unreleased] -> [${version}]`);
    return true;
  }
  fs.writeFileSync(changelogPath, after, 'utf8');
  log?.info({ action: 'release.changelog', status: 'rolled', version }, `Rolled CHANGELOG [Unreleased] -> [${version}]`);
  return true;
}

/** Create a local git tag `v<version>` (never pushes). Returns true if created (or would be in dry-run). */
async function createGitTag(
  rootDir: string,
  version: string,
  dryRun: boolean,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<boolean> {
  const tag = `v${version}`;
  if (dryRun) {
    log?.info({ action: 'release.tag', status: 'dry-run', tag }, `DRY-RUN: would create git tag ${tag}`);
    return true;
  }
  const res = await execCmd('git', ['tag', tag], { cwd: rootDir });
  if (res.code !== 0) {
    log?.error({ action: 'release.tag', status: 'failed', tag, stderr: res.stderr }, `Failed to create git tag ${tag}`);
    return false;
  }
  log?.info({ action: 'release.tag', status: 'created', tag }, `Created git tag ${tag} (not pushed)`);
  return true;
}

/**
 * Check if GitHub CLI (gh) is installed and available in PATH.
 * Returns true if `gh` command is found, false otherwise.
 *
 * @param log - Optional logger for diagnostics
 * @returns Promise<boolean> - true if gh is installed
 */
async function checkGhInstalled(log?: Partial<Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>>): Promise<boolean> {
  const res = await execCmd('gh', ['--version']);
  const installed = res.code === 0;
  if (!installed) {
    log?.warn?.(
      { action: 'release.gh-check', status: 'not-found' },
      'GitHub CLI (gh) not found. Install from https://cli.github.com',
    );
  } else {
    log?.debug?.(
      { action: 'release.gh-check', status: 'found', version: res.stdout?.trim() },
      `GitHub CLI found: ${res.stdout?.trim()}`,
    );
  }
  return installed;
}

/**
 * Create a GitHub Release using the GitHub CLI (gh).
 *
 * @param rootDir - Repository root directory
 * @param version - Version string (e.g., "1.2.3")
 * @param notes - Release notes (markdown formatted)
 * @param dryRun - If true, logs what would be created but doesn't execute
 * @param log - Optional logger
 * @returns Promise<boolean> - true if release created successfully or dry-run, false on failure
 *
 * @example
 * ```typescript
 * const success = await createGitHubRelease(
 *   '/path/to/repo',
 *   '1.2.3',
 *   '### Added\n- New feature',
 *   false,
 *   logger
 * );
 * ```
 */
async function createGitHubRelease(
  rootDir: string,
  version: string,
  notes: string,
  dryRun: boolean,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<boolean> {
  const tag = `v${version}`;
  const title = `v${version}`;

  if (dryRun) {
    log?.info(
      { action: 'release.github', status: 'dry-run', tag, title },
      `DRY-RUN: would create GitHub release ${tag}`,
    );
    log?.info(
      { action: 'release.github', status: 'dry-run-notes', notesPreview: notes.slice(0, 200) },
      `Release notes preview: ${notes.slice(0, 200)}${notes.length > 200 ? '...' : ''}`,
    );
    return true;
  }

  // Check if gh is installed
  const ghInstalled = await checkGhInstalled(log);
  if (!ghInstalled) {
    log?.error(
      { action: 'release.github', status: 'failed', reason: 'gh-not-found' },
      'GitHub CLI (gh) not found. Install from https://cli.github.com',
    );
    return false;
  }

  // Create the release
  const res = await execCmd(
    'gh',
    ['release', 'create', tag, '--title', title, '--notes', notes],
    { cwd: rootDir },
  );

  if (res.code !== 0) {
    log?.error(
      { action: 'release.github', status: 'failed', tag, stderr: res.stderr },
      `Failed to create GitHub release ${tag}: ${res.stderr || 'unknown error'}`,
    );
    return false;
  }

  // Extract URL from stdout if available (gh outputs the release URL)
  const releaseUrl = res.stdout?.trim() || '';
  log?.info(
    { action: 'release.github', status: 'created', tag, url: releaseUrl },
    `Created GitHub release ${tag}${releaseUrl ? `: ${releaseUrl}` : ''}`,
  );

  return true;
}

// Keep `versionFilePaths` reachable for callers importing from the orchestrator surface.
export { versionFilePaths };
