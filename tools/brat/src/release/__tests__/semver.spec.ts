import { computeNextVersion, parseSemVer, isValidSemVer, formatSemVer, isBumpKeyword } from '../semver';
import { ConfigurationError } from '../../orchestration/errors';

describe('release/semver', () => {
  describe('isValidSemVer', () => {
    it('accepts plain triples', () => {
      expect(isValidSemVer('0.7.0')).toBe(true);
      expect(isValidSemVer('1.2.3')).toBe(true);
      expect(isValidSemVer('10.20.30')).toBe(true);
    });
    it('rejects malformed / decorated versions', () => {
      expect(isValidSemVer('v1.2.3')).toBe(false);
      expect(isValidSemVer('1.2')).toBe(false);
      expect(isValidSemVer('1.2.3-rc.1')).toBe(false);
      expect(isValidSemVer('01.2.3')).toBe(false);
      expect(isValidSemVer('1.2.x')).toBe(false);
      expect(isValidSemVer('')).toBe(false);
    });
  });

  describe('isBumpKeyword', () => {
    it('recognizes the three keywords only', () => {
      expect(isBumpKeyword('patch')).toBe(true);
      expect(isBumpKeyword('minor')).toBe(true);
      expect(isBumpKeyword('major')).toBe(true);
      expect(isBumpKeyword('1.2.3')).toBe(false);
      expect(isBumpKeyword('Patch')).toBe(false);
    });
  });

  describe('computeNextVersion', () => {
    it('patch increments the patch component', () => {
      expect(computeNextVersion('0.7.0', 'patch')).toBe('0.7.1');
      expect(computeNextVersion('1.2.3', 'patch')).toBe('1.2.4');
    });
    it('minor increments minor and zeroes patch', () => {
      expect(computeNextVersion('0.7.0', 'minor')).toBe('0.8.0');
      expect(computeNextVersion('1.2.3', 'minor')).toBe('1.3.0');
    });
    it('major increments major and zeroes minor+patch (pre-1.0 promotion is explicit)', () => {
      expect(computeNextVersion('0.7.0', 'major')).toBe('1.0.0');
      expect(computeNextVersion('1.2.3', 'major')).toBe('2.0.0');
    });
    it('accepts an explicit version verbatim', () => {
      expect(computeNextVersion('0.7.0', '1.2.3')).toBe('1.2.3');
      expect(computeNextVersion('0.7.0', '0.7.0')).toBe('0.7.0');
    });
    it('fails closed on an empty bump argument', () => {
      expect(() => computeNextVersion('0.7.0', '')).toThrow(ConfigurationError);
    });
    it('fails closed on an invalid bump argument', () => {
      expect(() => computeNextVersion('0.7.0', 'huge')).toThrow(ConfigurationError);
      expect(() => computeNextVersion('0.7.0', 'v1.2.3')).toThrow(ConfigurationError);
      expect(() => computeNextVersion('0.7.0', '1.2')).toThrow(ConfigurationError);
    });
    it('fails closed on a malformed current version', () => {
      expect(() => computeNextVersion('not-a-version', 'patch')).toThrow(ConfigurationError);
    });
  });

  describe('parseSemVer / formatSemVer round-trip', () => {
    it('round-trips a valid version', () => {
      expect(formatSemVer(parseSemVer('3.14.159'))).toBe('3.14.159');
    });
  });
});
