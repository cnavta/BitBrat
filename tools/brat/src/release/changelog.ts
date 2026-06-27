/**
 * CHANGELOG.md rollover transformer for the `brat release` tool (sprint-326, BL-326-200).
 *
 * CHANGELOG.md follows Keep-a-Changelog + SemVer with a `## [Unreleased]` section. On release we:
 *   1. Rename `## [Unreleased]` -> `## [<version>] - <YYYY-MM-DD>` (preserving its existing entries), and
 *   2. Insert a fresh, empty `## [Unreleased]` skeleton above the newly dated block.
 *
 * The transform is PURE (string in -> string out) and IDEMPOTENT: re-running for the same version does
 * not double-roll, duplicate the Unreleased section, or corrupt existing entries.
 */

import { ConfigurationError } from '../orchestration/errors';

/** The empty Keep-a-Changelog section skeleton inserted as the new `## [Unreleased]`. */
export const UNRELEASED_SKELETON = [
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '### Changed',
  '',
  '### Deprecated',
  '',
  '### Removed',
  '',
  '### Fixed',
  '',
  '### Security',
  '',
].join('\n');

/** Matches an `## [Unreleased]` heading (case-insensitive on the word, tolerant of surrounding space). */
const UNRELEASED_HEADING_RE = /^##\s*\[Unreleased\]\s*$/im;

/** Format a Date as `YYYY-MM-DD` in UTC (deterministic, timezone-independent). */
export function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Returns true if the changelog already contains a dated heading for `version`
 * (i.e. `## [<version>] - ...`), meaning a rollover for it has already happened.
 */
export function hasVersionHeading(source: string, version: string): boolean {
  const re = new RegExp(`^##\\s*\\[${escapeRegExp(version)}\\]`, 'im');
  return re.test(source);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the `## [Unreleased]` section currently holds any non-empty content entries. */
export function unreleasedHasEntries(source: string): boolean {
  const idx = source.search(UNRELEASED_HEADING_RE);
  if (idx === -1) return false;
  const afterHeading = source.slice(idx).split('\n').slice(1);
  for (const line of afterHeading) {
    if (/^##\s/.test(line)) break; // next section
    const t = line.trim();
    if (t === '') continue;
    // Empty Keep-a-Changelog skeleton lines are just `### <Category>` subheadings — ignore those.
    if (/^###\s/.test(t)) continue;
    return true;
  }
  return false;
}

/**
 * Roll the `## [Unreleased]` section into a dated `## [<version>]` block and insert a fresh empty
 * `## [Unreleased]` above it. Idempotent: if a dated heading for `version` already exists, the source is
 * returned unchanged.
 */
export function rollChangelog(source: string, version: string, date: Date): string {
  if (hasVersionHeading(source, version)) {
    // Already rolled for this version — no-op (idempotent).
    return source;
  }
  const match = UNRELEASED_HEADING_RE.exec(source);
  if (!match) {
    throw new ConfigurationError(
      'CHANGELOG.md has no `## [Unreleased]` section to roll. Expected a Keep-a-Changelog formatted file.',
    );
  }
  const headingStart = match.index;
  const headingEnd = headingStart + match[0].length;
  const datedHeading = `## [${version}] - ${formatDate(date)}`;
  const before = source.slice(0, headingStart);
  const afterHeading = source.slice(headingEnd);
  // Reconstruct: <before><new empty Unreleased>\n\n<dated heading><preserved entries...>
  return `${before}${UNRELEASED_SKELETON}\n${datedHeading}${afterHeading}`;
}
