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

  return { previousVersion, nextVersion, dryRun, tagged, changelogRolled, consistency };
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

// Keep `versionFilePaths` reachable for callers importing from the orchestrator surface.
export { versionFilePaths };
