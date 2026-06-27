/**
 * SemVer compute helpers for the `brat release` tool (sprint-326, BL-326-100).
 *
 * Pure, side-effect-free functions: parse a SemVer string, validate it, and resolve the next version
 * from a bump keyword (`patch | minor | major`) or an explicit `x.y.z`. The release tool is **pre-1.0**
 * (see architecture.yaml project.status=experimental), so pre-1.0 SemVer rules apply: `major` is a real
 * 0.x -> 1.0.0 promotion and is only ever taken when explicitly requested (the bump type is always an
 * argument, never guessed).
 */

import { ConfigurationError } from '../orchestration/errors';

/** A parsed, numeric SemVer triple. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** The supported bump keywords. Anything else is treated as an explicit `x.y.z` literal. */
export type BumpKeyword = 'patch' | 'minor' | 'major';

const BUMP_KEYWORDS: ReadonlySet<string> = new Set(['patch', 'minor', 'major']);

/**
 * Strict SemVer core matcher (MAJOR.MINOR.PATCH, no pre-release/build metadata — the platform version
 * is a plain triple in both architecture.yaml and package.json). No leading zeros, no `v` prefix.
 */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Returns true if `value` is a syntactically valid plain SemVer triple. */
export function isValidSemVer(value: string): boolean {
  return typeof value === 'string' && SEMVER_RE.test(value.trim());
}

/**
 * Parse a SemVer string into its numeric components. Fails closed with a {@link ConfigurationError}
 * (clear message, no side effects) when the input is not a valid plain `x.y.z` triple.
 */
export function parseSemVer(value: string): SemVer {
  const v = (value ?? '').trim();
  const m = SEMVER_RE.exec(v);
  if (!m) {
    throw new ConfigurationError(
      `Malformed version "${value}": expected a plain SemVer triple like 1.2.3 (no leading zeros, no 'v' prefix, no pre-release).`,
    );
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Format a {@link SemVer} back into its canonical `x.y.z` string. */
export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Returns true when `value` is one of the supported bump keywords. */
export function isBumpKeyword(value: string): value is BumpKeyword {
  return BUMP_KEYWORDS.has(value);
}

/**
 * Resolve the next version from the current version and a bump argument.
 *
 * The `bump` argument is either:
 *   - a keyword (`patch` | `minor` | `major`) applied to `current`, or
 *   - an explicit SemVer literal (`x.y.z`) accepted verbatim.
 *
 * Fails closed (non-zero exit when surfaced by the CLI) on an empty/invalid bump argument or a
 * malformed current version. This function performs NO filesystem I/O.
 */
export function computeNextVersion(current: string, bump: string): string {
  const cur = parseSemVer(current);
  const arg = (bump ?? '').trim();
  if (!arg) {
    throw new ConfigurationError(
      'Missing bump argument. Provide one of: patch | minor | major | <explicit x.y.z>.',
    );
  }
  if (isBumpKeyword(arg)) {
    switch (arg) {
      case 'patch':
        return formatSemVer({ major: cur.major, minor: cur.minor, patch: cur.patch + 1 });
      case 'minor':
        return formatSemVer({ major: cur.major, minor: cur.minor + 1, patch: 0 });
      case 'major':
        return formatSemVer({ major: cur.major + 1, minor: 0, patch: 0 });
    }
  }
  // Explicit version path: must be a valid SemVer triple.
  if (!isValidSemVer(arg)) {
    throw new ConfigurationError(
      `Invalid bump argument "${bump}": expected patch | minor | major | an explicit SemVer triple (e.g. 1.2.3).`,
    );
  }
  return formatSemVer(parseSemVer(arg));
}
