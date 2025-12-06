import { computeBackoffSchedule } from '../../src/common/retry';

describe('computeBackoffSchedule', () => {
  const origRandom = Math.random;
  afterEach(() => {
    Math.random = origRandom;
  });

  it('produces deterministic schedule when jitterRatio=0', () => {
    const out = computeBackoffSchedule(3, 250, 5000, 0);
    expect(out).toEqual([250, 500, 1000]);
  });

  it('applies positive jitter within bounds', () => {
    // Force Math.random() to 1 => ideal + jitter
    Math.random = () => 1;
    const base = 100;
    const jr = 0.2;
    const out = computeBackoffSchedule(1, base, 10000, jr);
    expect(out[0]).toBe(base + Math.floor(base * jr));
  });

  it('applies negative jitter within bounds', () => {
    // Force Math.random() to 0 => ideal - jitter
    Math.random = () => 0;
    const base = 1000;
    const jr = 0.2;
    const out = computeBackoffSchedule(1, base, 10000, jr);
    const expected = Math.max(1, Math.floor(base - base * jr));
    expect(out[0]).toBe(expected);
  });

  it('respects maxDelay cap', () => {
    const out = computeBackoffSchedule(3, 4000, 5000, 0);
    expect(out).toEqual([4000, 5000, 5000]);
  });
});
