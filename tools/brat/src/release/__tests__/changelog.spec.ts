import { rollChangelog, hasVersionHeading, unreleasedHasEntries, formatDate, UNRELEASED_SKELETON, extractReleaseNotes } from '../changelog';
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

  describe('extractReleaseNotes', () => {
    const CHANGELOG_WITH_MULTIPLE_VERSIONS = `# Changelog

All notable changes are documented here.

## [Unreleased]

### Added
- Upcoming feature

## [1.2.3] - 2026-07-10

### Added
- Feature A that does something amazing
- Feature B with **markdown** formatting

### Fixed
- Bug fix for issue #123
- Another critical fix

### Changed
- Updated dependency versions

## [1.2.2] - 2026-07-05

### Fixed
- Old bug fix

## [1.2.1] - 2026-07-01

### Added
- Initial feature
`;

    const CHANGELOG_WITH_EMPTY_VERSION = `# Changelog

## [Unreleased]

## [2.0.0] - 2026-07-10

### Added

### Changed

### Fixed

## [1.9.0] - 2026-06-01

### Added
- Real content here
`;

    const CHANGELOG_MINIMAL = `# Changelog

## [1.0.0] - 2026-01-01

- Simple release note without subsections
- Another note with _italic_ and **bold**
`;

    it('extracts release notes from well-formed CHANGELOG', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.3');
      expect(notes).toContain('Feature A that does something amazing');
      expect(notes).toContain('Feature B with **markdown** formatting');
      expect(notes).toContain('Bug fix for issue #123');
      expect(notes).toContain('Another critical fix');
      expect(notes).toContain('Updated dependency versions');
      // Should NOT contain content from other versions
      expect(notes).not.toContain('Old bug fix');
      expect(notes).not.toContain('Initial feature');
    });

    it('extracts notes up to next version heading', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.2');
      expect(notes).toContain('Old bug fix');
      // Should stop at the next ## [ heading
      expect(notes).not.toContain('Initial feature');
    });

    it('extracts notes for last version (no next heading)', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.1');
      expect(notes).toContain('Initial feature');
      expect(notes).not.toContain('Old bug fix');
    });

    it('preserves markdown formatting in extracted notes', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.3');
      expect(notes).toContain('**markdown**');
      const minimalNotes = extractReleaseNotes(CHANGELOG_MINIMAL, '1.0.0');
      expect(minimalNotes).toContain('_italic_');
      expect(minimalNotes).toContain('**bold**');
    });

    it('returns default message when version not found', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '99.99.99');
      expect(notes).toBe('Release 99.99.99');
    });

    it('returns default message when CHANGELOG is empty', () => {
      const notes = extractReleaseNotes('# Changelog\n\n', '1.0.0');
      expect(notes).toBe('Release 1.0.0');
    });

    it('returns default message when version section is empty (only headers)', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_EMPTY_VERSION, '2.0.0');
      expect(notes).toBe('Release 2.0.0');
    });

    it('extracts notes from version with actual content after empty version', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_EMPTY_VERSION, '1.9.0');
      expect(notes).toContain('Real content here');
    });

    it('handles version with special regex characters', () => {
      const specialChangelog = `# Changelog

## [1.2.3-beta.1] - 2026-07-10

### Added
- Beta feature
`;
      const notes = extractReleaseNotes(specialChangelog, '1.2.3-beta.1');
      expect(notes).toContain('Beta feature');
    });

    it('strips leading and trailing whitespace from notes', () => {
      const messyChangelog = `# Changelog

## [1.0.0] - 2026-01-01


### Added
- Feature


`;
      const notes = extractReleaseNotes(messyChangelog, '1.0.0');
      expect(notes).toBe('### Added\n- Feature');
      expect(notes[0]).not.toBe('\n');
      expect(notes[notes.length - 1]).not.toBe('\n');
    });

    it('handles CHANGELOG with only Unreleased section', () => {
      const onlyUnreleased = `# Changelog

## [Unreleased]

### Added
- New stuff
`;
      const notes = extractReleaseNotes(onlyUnreleased, '1.0.0');
      expect(notes).toBe('Release 1.0.0');
    });

    it('handles multiple versions and extracts correct one', () => {
      const notes1 = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.3');
      const notes2 = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.2');
      const notes3 = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, '1.2.1');

      expect(notes1).not.toEqual(notes2);
      expect(notes2).not.toEqual(notes3);
      expect(notes1).not.toEqual(notes3);
    });

    it('handles CHANGELOG with varied spacing in headings', () => {
      const variedSpacing = `# Changelog

##  [  1.0.0  ]  -  2026-07-10

### Added
- Feature with varied spacing
`;
      const notes = extractReleaseNotes(variedSpacing, '1.0.0');
      expect(notes).toContain('Feature with varied spacing');
    });

    it('does not extract from Unreleased section', () => {
      const notes = extractReleaseNotes(CHANGELOG_WITH_MULTIPLE_VERSIONS, 'Unreleased');
      expect(notes).toBe('Release Unreleased');
    });

    it('handles empty string input', () => {
      const notes = extractReleaseNotes('', '1.0.0');
      expect(notes).toBe('Release 1.0.0');
    });

    it('handles malformed dates gracefully', () => {
      const malformedDate = `# Changelog

## [1.0.0] - not-a-date

### Added
- Feature
`;
      const notes = extractReleaseNotes(malformedDate, '1.0.0');
      // Should still return default since regex requires YYYY-MM-DD format
      expect(notes).toBe('Release 1.0.0');
    });

    it('handles CHANGELOG with valid date format', () => {
      const validDate = `# Changelog

## [1.0.0] - 2026-07-10

### Added
- Feature
`;
      const notes = extractReleaseNotes(validDate, '1.0.0');
      expect(notes).toContain('Feature');
    });
  });
});
