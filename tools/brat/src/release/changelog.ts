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

/**
 * Extracts release notes for a specific version from a Keep-a-Changelog formatted CHANGELOG.md.
 *
 * Searches for a dated version heading (e.g., `## [1.2.3] - 2026-07-11`) and extracts all content
 * until the next `## [` heading or end of file. Returns a default message if the version section
 * is not found or is empty.
 *
 * @param source - The full CHANGELOG.md content
 * @param version - The version to extract notes for (e.g., "1.2.3")
 * @returns The extracted release notes, or a default message if not found/empty
 *
 * @example
 * ```typescript
 * const notes = extractReleaseNotes(changelogContent, '1.2.3');
 * // Returns the content between ## [1.2.3] and the next ## [ heading
 * ```
 */
export function extractReleaseNotes(source: string, version: string): string {
  // Match the dated version heading: ## [version] - YYYY-MM-DD
  // This regex is tolerant of spacing (including inside brackets) and captures the heading line
  const versionHeadingRe = new RegExp(
    `^##\\s*\\[\\s*${escapeRegExp(version)}\\s*\\]\\s*-\\s*\\d{4}-\\d{2}-\\d{2}\\s*$`,
    'im',
  );
  const match = versionHeadingRe.exec(source);

  if (!match) {
    // Version section not found — return default message
    return `Release ${version}`;
  }

  const headingEnd = match.index + match[0].length;
  const afterHeading = source.slice(headingEnd);

  // Find the next ## [ heading (next version section) or use end of file
  const nextHeadingMatch = /^##\s*\[/im.exec(afterHeading);
  const nextHeadingStart = nextHeadingMatch ? nextHeadingMatch.index : afterHeading.length;

  // Extract content between this version heading and the next
  const content = afterHeading.slice(0, nextHeadingStart).trim();

  // If content is empty or only contains whitespace/empty Keep-a-Changelog headers, use default
  if (!content || !hasNonEmptyContent(content)) {
    return `Release ${version}`;
  }

  return content;
}

/**
 * Returns true if the content has actual release notes (not just empty Keep-a-Changelog section headers).
 * @internal
 */
function hasNonEmptyContent(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and Keep-a-Changelog section headers (### Added, ### Changed, etc.)
    if (trimmed === '' || /^###\s/.test(trimmed)) {
      continue;
    }
    // Found actual content
    return true;
  }
  return false;
}
