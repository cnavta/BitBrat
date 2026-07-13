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
  /** When true, create a local `git tag v<version>`. Default: true. */
  tag?: boolean;
  /** When true, push changes and tags to remote. Default: true. */
  push?: boolean;
  /** When true, create a GitHub PR for the release. Default: true. */
  createPr?: boolean;
  /** When true, skip all interactive prompts (auto-approve). Default: false. */
  yes?: boolean;
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
  uncommittedChanges: boolean;
  changesCommitted: boolean;
  tagged: boolean;
  pushed: boolean;
  prCreated: boolean;
  prUrl?: string;
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

  // Validate: GitHub PRs require git tags
  if (opts.createPr && opts.tag === false) {
    throw new Error('GitHub PRs require git tags. Use --tag with --createPr, or omit --createPr.');
  }

  const previousVersion = readArchitectureVersion(rootDir);
  const nextVersion = computeNextVersion(previousVersion, bump);
  log?.info(
    { action: 'release.compute', previousVersion, nextVersion, bump, dryRun },
    `Release ${previousVersion} -> ${nextVersion}${dryRun ? ' (dry-run)' : ''}`,
  );

  // 0) Check for uncommitted changes BEFORE making any changes
  const uncommittedChanges = await hasUncommittedChanges(rootDir, log);
  let changesCommitted = false;

  if (uncommittedChanges && !dryRun) {
    log?.info({ action: 'release.uncommitted', status: 'detected' }, 'Detected uncommitted changes');

    // Prompt user if not in --yes mode
    let shouldCommit = opts.yes || false;
    if (!opts.yes) {
      shouldCommit = await promptUser('Uncommitted changes detected. Commit them as part of the release?');
    }

    if (shouldCommit) {
      // Commit changes BEFORE version bump so they're included in the release
      changesCommitted = await commitChanges(rootDir, nextVersion, dryRun, log);
      if (!changesCommitted) {
        throw new Error('Failed to commit uncommitted changes');
      }
    } else if (!opts.yes) {
      // User declined to commit, fail the release
      throw new Error('Uncommitted changes detected. Commit or stash them before releasing, or use --yes to auto-commit');
    }
  }

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

  // 6) Commit the version bump changes if there are any
  const postBumpChanges = await hasUncommittedChanges(rootDir, log);
  if (postBumpChanges && !dryRun && !changesCommitted) {
    changesCommitted = await commitChanges(rootDir, nextVersion, dryRun, log);
    if (!changesCommitted) {
      log?.warn({ action: 'release.commit-post-bump', status: 'failed' }, 'Failed to commit version bump changes');
    }
  }

  // 7) Optional git tag (default: true, disable with --no-tag).
  let tagged = false;
  if (opts.tag !== false) {
    tagged = await createGitTag(rootDir, nextVersion, dryRun, log);
  }

  // 8) Optional push to remote (default: true, disable with --no-push).
  let pushed = false;
  if (opts.push !== false && !dryRun) {
    pushed = await pushChanges(rootDir, nextVersion, dryRun, log);
  }

  // 9) Optional GitHub PR creation (default: true, disable with --no-pr).
  let prCreated = false;
  let prUrl: string | undefined;
  if (opts.createPr !== false) {
    const currentBranch = await getCurrentBranch(rootDir);
    const prResult = await createGitHubPR(rootDir, nextVersion, currentBranch, dryRun, log);
    prCreated = prResult.created;
    prUrl = prResult.url;
  }

  return {
    previousVersion,
    nextVersion,
    dryRun,
    uncommittedChanges,
    changesCommitted,
    tagged,
    pushed,
    prCreated,
    prUrl,
    changelogRolled,
    consistency,
  };
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

/**
 * Check if there are uncommitted changes in the working directory.
 * Returns true if there are unstaged or uncommitted changes.
 */
async function hasUncommittedChanges(
  rootDir: string,
  log?: Pick<Logger, 'info' | 'debug'>,
): Promise<boolean> {
  const res = await execCmd('git', ['status', '--porcelain'], { cwd: rootDir });
  if (res.code !== 0) {
    log?.info({ action: 'release.git-status', status: 'failed' }, 'Failed to check git status');
    return false;
  }
  const hasChanges = res.stdout?.trim().length > 0;
  log?.debug({ action: 'release.git-status', hasChanges }, `Uncommitted changes: ${hasChanges}`);
  return hasChanges;
}

/**
 * Prompt user for confirmation. Returns true if user confirms (y/yes).
 * If stdin is not a TTY, returns false.
 */
async function promptUser(message: string): Promise<boolean> {
  // Check if stdin is a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    return false;
  }

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N]: `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Commit all uncommitted changes with a release commit message.
 * Returns true if changes were committed successfully.
 */
async function commitChanges(
  rootDir: string,
  version: string,
  dryRun: boolean,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<boolean> {
  if (dryRun) {
    log?.info({ action: 'release.commit', status: 'dry-run', version }, 'DRY-RUN: would commit uncommitted changes');
    return true;
  }

  // Add all changes
  const addRes = await execCmd('git', ['add', '-A'], { cwd: rootDir });
  if (addRes.code !== 0) {
    log?.error({ action: 'release.commit', status: 'add-failed', stderr: addRes.stderr }, 'Failed to stage changes');
    return false;
  }

  // Commit with release message
  const commitMsg = `Release ${version}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

  const commitRes = await execCmd('git', ['commit', '-m', commitMsg], { cwd: rootDir });
  if (commitRes.code !== 0) {
    log?.error({ action: 'release.commit', status: 'commit-failed', stderr: commitRes.stderr }, 'Failed to commit changes');
    return false;
  }

  log?.info({ action: 'release.commit', status: 'committed', version }, `Committed release ${version}`);
  return true;
}

/**
 * Push changes and tags to remote.
 * Returns true if push was successful.
 */
async function pushChanges(
  rootDir: string,
  version: string,
  dryRun: boolean,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<boolean> {
  const tag = `v${version}`;

  if (dryRun) {
    log?.info({ action: 'release.push', status: 'dry-run', tag }, 'DRY-RUN: would push changes and tags to remote');
    return true;
  }

  // Push commits
  const pushRes = await execCmd('git', ['push'], { cwd: rootDir });
  if (pushRes.code !== 0) {
    log?.error({ action: 'release.push', status: 'push-failed', stderr: pushRes.stderr }, 'Failed to push commits');
    return false;
  }

  // Push tags
  const pushTagRes = await execCmd('git', ['push', 'origin', tag], { cwd: rootDir });
  if (pushTagRes.code !== 0) {
    log?.warn({ action: 'release.push', status: 'tag-push-failed', stderr: pushTagRes.stderr }, `Failed to push tag ${tag}`);
    // Don't return false here - commits were pushed successfully
  }

  log?.info({ action: 'release.push', status: 'pushed', tag }, 'Pushed changes and tags to remote');
  return true;
}

/**
 * Get the current git branch name.
 */
async function getCurrentBranch(rootDir: string): Promise<string> {
  const res = await execCmd('git', ['branch', '--show-current'], { cwd: rootDir });
  if (res.code !== 0) {
    return 'main'; // fallback
  }
  return res.stdout?.trim() || 'main';
}

/**
 * Create a GitHub PR for the release using gh CLI.
 * Returns { created: boolean, url?: string }
 */
async function createGitHubPR(
  rootDir: string,
  version: string,
  currentBranch: string,
  dryRun: boolean,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<{ created: boolean; url?: string }> {
  if (dryRun) {
    log?.info(
      { action: 'release.pr', status: 'dry-run', version, branch: currentBranch },
      `DRY-RUN: would create GitHub PR from ${currentBranch} to main`,
    );
    return { created: true };
  }

  // Check if gh is installed
  const ghCheckRes = await execCmd('gh', ['--version']);
  if (ghCheckRes.code !== 0) {
    log?.error({ action: 'release.pr', status: 'gh-not-found' }, 'GitHub CLI (gh) not found. Install from https://cli.github.com');
    return { created: false };
  }

  // Check if we're on main - if so, no PR needed
  if (currentBranch === 'main' || currentBranch === 'master') {
    log?.info({ action: 'release.pr', status: 'skipped', branch: currentBranch }, 'Already on main branch, skipping PR creation');
    return { created: false };
  }

  // Create PR
  const title = `Release ${version}`;
  const body = `Automated release for version ${version}

This PR bumps the platform version to ${version} and updates:
- architecture.yaml
- package.json
- package-lock.json
- CHANGELOG.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

  const prRes = await execCmd(
    'gh',
    ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', currentBranch],
    { cwd: rootDir },
  );

  if (prRes.code !== 0) {
    log?.error({ action: 'release.pr', status: 'failed', stderr: prRes.stderr }, 'Failed to create GitHub PR');
    return { created: false };
  }

  const prUrl = prRes.stdout?.trim() || '';
  log?.info({ action: 'release.pr', status: 'created', url: prUrl }, `Created GitHub PR: ${prUrl}`);
  return { created: true, url: prUrl };
}

// Keep `versionFilePaths` reachable for callers importing from the orchestrator surface.
export { versionFilePaths };
