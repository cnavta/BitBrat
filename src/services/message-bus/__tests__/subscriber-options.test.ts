import { DEFAULTS, loadSubscriberOptionsFromEnv } from '../subscriber-options';

describe('subscriber-options env loader', () => {
  it('uses defaults when env is empty', () => {
    const opts = loadSubscriberOptionsFromEnv('router-staging-pull', {});
    expect(opts.subscription).toBe('router-staging-pull');
    expect(opts.ackDeadlineSeconds).toBe(DEFAULTS.ackDeadlineSeconds);
    expect(opts.maxMessages).toBe(DEFAULTS.maxMessages);
    expect(opts.maxOutstandingBytes).toBe(DEFAULTS.maxOutstandingBytes);
    expect(opts.parallelHandlers).toBe(DEFAULTS.parallelHandlers);
    expect(opts.retryAttempts).toBe(DEFAULTS.retryAttempts);
    expect(opts.backoffMs).toEqual(DEFAULTS.backoffMs);
  });

  it('parses numeric env values and enforces bounds', () => {
    const env = {
      PUBSUB_ACK_DEADLINE_SECONDS: '5',    // below min -> coerced to 10
      PUBSUB_MAX_MESSAGES: '2000',         // above max -> coerced to 1000
      PUBSUB_MAX_OUTSTANDING_BYTES: '1048576',
      PUBSUB_PARALLEL_HANDLERS: '0',       // below min -> 1
      PUBSUB_RETRY_ATTEMPTS: '-1',         // below min -> 0
      PUBSUB_BACKOFF_MS: '100, 200, notnum, 400',
    } as any;
    const opts = loadSubscriberOptionsFromEnv('llm-bot-staging-pull', env);
    expect(opts.ackDeadlineSeconds).toBe(10);
    expect(opts.maxMessages).toBe(1000);
    expect(opts.maxOutstandingBytes).toBe(1048576);
    expect(opts.parallelHandlers).toBe(1);
    expect(opts.retryAttempts).toBe(0);
    expect(opts.backoffMs).toEqual([100, 200, 400]);
  });

  it('supports typical router/llm-bot values', () => {
    const env = {
      PUBSUB_ACK_DEADLINE_SECONDS: '60',
      PUBSUB_MAX_MESSAGES: '10',
      PUBSUB_RETRY_ATTEMPTS: '5',
      PUBSUB_BACKOFF_MS: '1000,2000,4000,8000',
    } as any;
    const opts = loadSubscriberOptionsFromEnv('router-staging-pull', env);
    expect(opts.ackDeadlineSeconds).toBe(60);
    expect(opts.maxMessages).toBe(10);
    expect(opts.retryAttempts).toBe(5);
    expect(opts.backoffMs).toEqual([1000, 2000, 4000, 8000]);
  });
});
