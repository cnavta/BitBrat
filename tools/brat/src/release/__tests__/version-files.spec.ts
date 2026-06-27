import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  setArchitectureVersionInSource,
  setPackageJsonVersionInSource,
  readArchitectureVersion,
  readPackageJsonVersion,
  writeArchitectureVersion,
  writePackageJsonVersion,
  assertVersionsConsistent,
  readAllVersions,
} from '../version-files';
import { ConfigurationError } from '../../orchestration/errors';

const ARCH = `# header comment
name: BitBrat Platform
project:
  name: BitBrat Platform
  # Single source of truth for the version. Kept in sync with package.json "version".
  version: 0.7.0
  status: experimental
dependencies:
  version: should-not-change
`;

const PKG = `{
  "name": "bitbrat-platform",
  "version": "0.7.0",
  "scripts": {
    "x": "echo version"
  }
}
`;

const LOCK = `{
  "name": "bitbrat-platform",
  "version": "0.7.0",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "bitbrat-platform",
      "version": "0.7.0"
    }
  }
}
`;

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-release-'));
  fs.writeFileSync(path.join(dir, 'architecture.yaml'), ARCH);
  fs.writeFileSync(path.join(dir, 'package.json'), PKG);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), LOCK);
  return dir;
}

describe('release/version-files', () => {
  describe('setArchitectureVersionInSource', () => {
    it('changes only the project.version line, preserving comment + formatting', () => {
      const out = setArchitectureVersionInSource(ARCH, '0.7.1');
      expect(out).toContain('  # Single source of truth for the version. Kept in sync with package.json "version".');
      expect(out).toContain('  version: 0.7.1');
      // The unrelated dependencies.version must be untouched.
      expect(out).toContain('  version: should-not-change');
      // Exactly one line differs from the original.
      const diff = ARCH.split('\n').filter((l, i) => l !== out.split('\n')[i]);
      expect(diff).toEqual(['  version: 0.7.0']);
    });
    it('throws when project.version is absent', () => {
      expect(() => setArchitectureVersionInSource('name: x\nproject:\n  name: y\n', '1.0.0')).toThrow(ConfigurationError);
    });
  });

  describe('setPackageJsonVersionInSource', () => {
    it('updates version preserving JSON formatting and other keys', () => {
      const out = setPackageJsonVersionInSource(PKG, '0.7.1');
      const parsed = JSON.parse(out);
      expect(parsed.version).toBe('0.7.1');
      expect(parsed.name).toBe('bitbrat-platform');
      expect(parsed.scripts.x).toBe('echo version');
      expect(out).toContain('  "version": "0.7.1"');
    });
  });

  describe('readers', () => {
    it('reads the authoritative version from architecture.yaml', () => {
      const dir = tmpRepo();
      expect(readArchitectureVersion(dir)).toBe('0.7.0');
      expect(readPackageJsonVersion(dir)).toBe('0.7.0');
    });
    it('fails closed when project.version is invalid', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-bad-'));
      fs.writeFileSync(path.join(dir, 'architecture.yaml'), 'project:\n  version: not-semver\n');
      expect(() => readArchitectureVersion(dir)).toThrow(ConfigurationError);
    });
  });

  describe('writers honor dry-run (no-op)', () => {
    it('writeArchitectureVersion / writePackageJsonVersion write nothing under dryRun', () => {
      const dir = tmpRepo();
      const archBefore = fs.readFileSync(path.join(dir, 'architecture.yaml'), 'utf8');
      const pkgBefore = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
      writeArchitectureVersion(dir, '9.9.9', true);
      writePackageJsonVersion(dir, '9.9.9', true);
      expect(fs.readFileSync(path.join(dir, 'architecture.yaml'), 'utf8')).toBe(archBefore);
      expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe(pkgBefore);
    });

    it('writers persist + re-validate in real mode', () => {
      const dir = tmpRepo();
      writeArchitectureVersion(dir, '0.8.0', false);
      writePackageJsonVersion(dir, '0.8.0', false);
      expect(readArchitectureVersion(dir)).toBe('0.8.0');
      expect(readPackageJsonVersion(dir)).toBe('0.8.0');
    });
  });

  describe('assertVersionsConsistent', () => {
    it('passes when all three agree', () => {
      const dir = tmpRepo();
      const c = assertVersionsConsistent(dir);
      expect(c.ok).toBe(true);
      expect(c.architecture).toBe('0.7.0');
    });
    it('throws on mismatch', () => {
      const dir = tmpRepo();
      writePackageJsonVersion(dir, '0.7.1', false);
      const r = readAllVersions(dir);
      expect(r.ok).toBe(false);
      expect(() => assertVersionsConsistent(dir)).toThrow(ConfigurationError);
    });
  });
});
