import { rollChangelog, hasVersionHeading, unreleasedHasEntries, formatDate, UNRELEASED_SKELETON } from '../changelog';
import { ConfigurationError } from '../../orchestration/errors';

const CHANGELOG = `# Changelog

All notable changes are documented here.

## [Unreleased]

### Added
- A shiny new feature (sprint-325).

### Fixed
- A nasty bug.

## [0.6.0] - 2026-05-01

### Added
- Older stuff.
`;

const DATE = new Date(Date.UTC(2026, 5, 26)); // 2026-06-26

describe('release/changelog', () => {
  it('formatDate renders YYYY-MM-DD in UTC', () => {
    expect(formatDate(DATE)).toBe('2026-06-26');
  });

  it('rolls [Unreleased] into a dated version block and inserts a fresh empty Unreleased', () => {
    const out = rollChangelog(CHANGELOG, '0.7.0', DATE);
    // New empty Unreleased skeleton present at the top of the rolled section.
    expect(out).toContain(UNRELEASED_SKELETON);
    // Dated heading created, preserving the previously-unreleased entries.
    expect(out).toContain('## [0.7.0] - 2026-06-26');
    expect(out).toContain('- A shiny new feature (sprint-325).');
    expect(out).toContain('- A nasty bug.');
    // Older version block untouched.
    expect(out).toContain('## [0.6.0] - 2026-05-01');
    // The dated 0.7.0 block comes after the new Unreleased block.
    expect(out.indexOf('## [Unreleased]')).toBeLessThan(out.indexOf('## [0.7.0]'));
  });

  it('is idempotent: a second roll for the same version is a no-op', () => {
    const once = rollChangelog(CHANGELOG, '0.7.0', DATE);
    const twice = rollChangelog(once, '0.7.0', DATE);
    expect(twice).toBe(once);
    // Exactly one Unreleased heading remains.
    const count = (twice.match(/##\s*\[Unreleased\]/g) || []).length;
    expect(count).toBe(1);
    // Exactly one 0.7.0 dated heading.
    expect((twice.match(/##\s*\[0\.7\.0\]/g) || []).length).toBe(1);
  });

  it('hasVersionHeading detects an existing dated block', () => {
    expect(hasVersionHeading(CHANGELOG, '0.6.0')).toBe(true);
    expect(hasVersionHeading(CHANGELOG, '0.7.0')).toBe(false);
  });

  it('unreleasedHasEntries distinguishes content vs empty skeleton', () => {
    expect(unreleasedHasEntries(CHANGELOG)).toBe(true);
    expect(unreleasedHasEntries(`# Changelog\n\n${UNRELEASED_SKELETON}\n## [0.1.0] - 2026-01-01\n`)).toBe(false);
  });

  it('throws when there is no Unreleased section', () => {
    expect(() => rollChangelog('# Changelog\n\n## [0.1.0] - 2026-01-01\n', '0.2.0', DATE)).toThrow(ConfigurationError);
  });
});
