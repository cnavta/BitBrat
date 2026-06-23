import { withBackoff, isTransientError } from './retry';

// Make timers deterministic per-test and restore afterwards to avoid leaking fake timers across suites
afterEach(() => {
  jest.useRealTimers();
});

describe('withBackoff', () => {
  it('retries on failure then succeeds', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));
    let attempts = 0;
    const start = Date.now();

    const p = withBackoff(async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    }, { attempts: 5, baseDelayMs: 5, maxDelayMs: 20, jitter: false });

    // Advance timers for the two backoff sleeps: 5ms then 10ms
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(5);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(10);

    const res = await p;
    const elapsed = Date.now() - start;
    expect(res).toBe('ok');
    expect(attempts).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(15); // 5 + 10ms delays
  });

  it('throws after max attempts', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1000));
    let attempts = 0;
    const p = withBackoff(async () => {
      attempts++;
      throw new Error('boom');
    }, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: false });

    // Attach rejection matcher immediately to avoid unhandled rejection warnings
    const expectation = expect(p).rejects.toThrow('boom');

    // Two waits for 3 attempts: 1ms then 2ms
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(2);

    await expectation;
    expect(attempts).toBe(3);
  });
});

describe('isTransientError', () => {
  it('classifies Google OAuth2 token "Premature close" failures as transient', () => {
    const err = new Error(
      'Invalid response body while trying to fetch https://www.googleapis.com/oauth2/v4/token: Premature close',
    );
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies socket hang up and ERR_STREAM_PREMATURE_CLOSE as transient', () => {
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
    expect(isTransientError({ code: 'ERR_STREAM_PREMATURE_CLOSE' })).toBe(true);
  });

  it('does not classify ordinary 4xx/validation errors as transient', () => {
    expect(isTransientError({ status: 400, message: 'Bad Request' })).toBe(false);
    expect(isTransientError(new Error('Unknown parameter: response_format'))).toBe(false);
  });
});
