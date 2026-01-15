import { normalizeDelay } from '../../src/common/safe-timers';

describe('safe-timers', () => {
  describe('normalizeDelay', () => {
    it('should return the same value for positive finite numbers', () => {
      expect(normalizeDelay(100)).toBe(100);
      expect(normalizeDelay(1)).toBe(1);
    });

    it('should return 1 for negative numbers', () => {
      expect(normalizeDelay(-100)).toBe(1);
      expect(normalizeDelay(-0.5)).toBe(1);
    });

    it('should return 1 for zero', () => {
      expect(normalizeDelay(0)).toBe(1);
    });

    it('should return 1 for non-finite numbers', () => {
      expect(normalizeDelay(Infinity)).toBe(1);
      expect(normalizeDelay(-Infinity)).toBe(1);
      expect(normalizeDelay(NaN)).toBe(1);
    });

    it('should return 1 for non-numeric types', () => {
      expect(normalizeDelay('abc')).toBe(1);
      expect(normalizeDelay(undefined)).toBe(1);
      expect(normalizeDelay(null)).toBe(1);
      expect(normalizeDelay({})).toBe(1);
    });

    it('should round up fractional delays', () => {
      expect(normalizeDelay(1.2)).toBe(2);
      expect(normalizeDelay(0.1)).toBe(1);
    });
  });
});
