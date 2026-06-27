/**
 * Version file reader/writer for the `brat release` tool (sprint-326, BL-326-101 + BL-326-102).
 *
 * The platform version lives in THREE files that must stay in lockstep:
 *   - architecture.yaml -> project.version   (AGENTS.md §0 precedence + runtime source via
 *     src/common/base-server.ts -> arch?.project?.version). This is the SINGLE SOURCE OF TRUTH.
 *   - package.json -> "version"              (npm/build identity).
 *   - package-lock.json -> "version" (+ packages[""].version) (mirror of package.json).
 *
 * Law #2: writing architecture.yaml here changes ONLY `project.version` (a non-behavioral field) via a
 * line-targeted, comment-preserving replace, and the file is re-parsed afterwards to assert validity.
 * It must never touch behavioral architecture.
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { ConfigurationError } from '../orchestration/errors';
import { execCmd } from '../orchestration/exec';
import { isValidSemVer } from './semver';

export const ARCH_FILE = 'architecture.yaml';
export const PKG_FILE = 'package.json';
export const LOCK_FILE = 'package-lock.json';

/** Resolve the three version-bearing file paths relative to a repo root. */
export function versionFilePaths(rootDir: string): { arch: string; pkg: string; lock: string } {
  return {
    arch: path.join(rootDir, ARCH_FILE),
    pkg: path.join(rootDir, PKG_FILE),
    lock: path.join(rootDir, LOCK_FILE),
  };
}

/**
 * Read the authoritative current version from architecture.yaml `project.version`.
 * Fails closed when the file is missing/unparseable or the field is absent/invalid.
 */
export function readArchitectureVersion(rootDir: string): string {
  const archPath = versionFilePaths(rootDir).arch;
  let raw: any;
  try {
    raw = yaml.load(fs.readFileSync(archPath, 'utf8'));
  } catch (e: any) {
    throw new ConfigurationError(`Failed to read/parse ${ARCH_FILE}: ${e?.message || String(e)}`);
  }
  const version = raw?.project?.version;
  if (typeof version !== 'string' || !isValidSemVer(version)) {
    throw new ConfigurationError(
      `architecture.yaml project.version is missing or not a valid SemVer triple (found: ${JSON.stringify(version)}).`,
    );
  }
  return version.trim();
}

/** Read package.json "version" (used by the consistency assertion). */
export function readPackageJsonVersion(rootDir: string): string {
  const pkgPath = versionFilePaths(rootDir).pkg;
  const v = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))?.version;
  if (typeof v !== 'string') {
    throw new ConfigurationError(`${PKG_FILE} has no string "version" field.`);
  }
  return v.trim();
}

/** Read package-lock.json top-level "version" (used by the consistency assertion). */
export function readPackageLockVersion(rootDir: string): string {
  const lockPath = versionFilePaths(rootDir).lock;
  const v = JSON.parse(fs.readFileSync(lockPath, 'utf8'))?.version;
  if (typeof v !== 'string') {
    throw new ConfigurationError(`${LOCK_FILE} has no string "version" field.`);
  }
  return v.trim();
}

/**
 * Comment-preserving rewrite of `project.version` in an architecture.yaml source string.
 *
 * Targets the `version:` key nested directly under the top-level `project:` block and replaces ONLY its
 * value, preserving indentation, surrounding quotes (if any), and any trailing inline comment. Returns
 * the new source text. Throws when the field cannot be located.
 */
export function setArchitectureVersionInSource(source: string, newVersion: string): string {
  const lines = source.split('\n');
  let inProject = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Top-level key (column 0, not a comment) — entering/leaving the `project:` block.
    if (/^[^\s#][^:]*:/.test(line)) {
      inProject = /^project\s*:/.test(line);
      continue;
    }
    if (!inProject) continue;
    // Within the project block: match a nested `version:` key and replace only its value token.
    const m = /^(\s+version:\s*)(["']?)([^\s"'#]+)(["']?)(\s*)(#.*)?$/.exec(line);
    if (m) {
      const [, prefix, openQuote, , closeQuote, gap, comment] = m;
      lines[i] = `${prefix}${openQuote}${newVersion}${closeQuote}${gap || ''}${comment || ''}`;
      return lines.join('\n');
    }
  }
  throw new ConfigurationError(
    'Could not locate project.version in architecture.yaml; aborting to avoid touching behavioral architecture (Law #2).',
  );
}

/**
 * Write `project.version` into architecture.yaml (only that field), then re-parse the file to assert it
 * is still valid YAML and that project.version equals the requested value. No-op when `dryRun` is true.
 * Returns the would-be / written file text.
 */
export function writeArchitectureVersion(rootDir: string, newVersion: string, dryRun: boolean): string {
  const archPath = versionFilePaths(rootDir).arch;
  const before = fs.readFileSync(archPath, 'utf8');
  const after = setArchitectureVersionInSource(before, newVersion);
  if (dryRun) return after;
  fs.writeFileSync(archPath, after, 'utf8');
  // Re-parse to honor Law #2: file must remain valid and only project.version should now read as new.
  const reparsed = yaml.load(after) as any;
  if (reparsed?.project?.version !== newVersion) {
    throw new ConfigurationError(
      `Post-write validation failed: architecture.yaml project.version is ${JSON.stringify(reparsed?.project?.version)}, expected ${newVersion}.`,
    );
  }
  return after;
}

/**
 * Replace the first top-level `"version": "x.y.z"` in a package.json source string, preserving JSON
 * formatting/indentation and key order. Returns the new source text.
 */
export function setPackageJsonVersionInSource(source: string, newVersion: string): string {
  let replaced = false;
  const out = source.replace(/("version"\s*:\s*")[^"]*(")/, (_match, p1, p2) => {
    replaced = true;
    return `${p1}${newVersion}${p2}`;
  });
  if (!replaced) {
    throw new ConfigurationError('Could not locate "version" in package.json.');
  }
  return out;
}

/** Write package.json "version" (formatting-preserving). No-op when `dryRun` is true. */
export function writePackageJsonVersion(rootDir: string, newVersion: string, dryRun: boolean): string {
  const pkgPath = versionFilePaths(rootDir).pkg;
  const before = fs.readFileSync(pkgPath, 'utf8');
  const after = setPackageJsonVersionInSource(before, newVersion);
  if (dryRun) return after;
  fs.writeFileSync(pkgPath, after, 'utf8');
  return after;
}

/**
 * Sync package-lock.json to the current package.json version. Prefers `npm install --package-lock-only`
 * (the canonical, offline-safe lockfile regeneration), falling back to a direct text patch of the
 * top-level and `packages[""]` version fields if npm is unavailable or fails. No-op when `dryRun`.
 */
export async function syncLockfileVersion(rootDir: string, newVersion: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  const res = await execCmd('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: rootDir,
  });
  if (res.code === 0 && readPackageLockVersion(rootDir) === newVersion) return;
  // Fallback: patch the lockfile JSON directly (top-level + root package entry).
  const lockPath = versionFilePaths(rootDir).lock;
  const before = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(before);
  lock.version = newVersion;
  if (lock.packages && lock.packages[''] && typeof lock.packages[''].version === 'string') {
    lock.packages[''].version = newVersion;
  }
  // Preserve a trailing newline if the original had one.
  const trailing = before.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + trailing, 'utf8');
}

/** The result of a three-file version consistency check. */
export interface VersionConsistency {
  ok: boolean;
  architecture: string;
  packageJson: string;
  packageLock: string;
}

/** Read the version reported by all three files (no assertion). */
export function readAllVersions(rootDir: string): VersionConsistency {
  const architecture = readArchitectureVersion(rootDir);
  const packageJson = readPackageJsonVersion(rootDir);
  const packageLock = readPackageLockVersion(rootDir);
  return {
    ok: architecture === packageJson && packageJson === packageLock,
    architecture,
    packageJson,
    packageLock,
  };
}

/**
 * Assert that architecture.yaml == package.json == package-lock.json. Throws a {@link ConfigurationError}
 * (surfaced as a non-zero exit by the CLI) on mismatch. Reusable by validate_deliverable.sh.
 */
export function assertVersionsConsistent(rootDir: string): VersionConsistency {
  const c = readAllVersions(rootDir);
  if (!c.ok) {
    throw new ConfigurationError(
      `Version mismatch: architecture.yaml=${c.architecture} package.json=${c.packageJson} package-lock.json=${c.packageLock}.`,
    );
  }
  return c;
}
