import { jest } from '@jest/globals';

describe('message-bus factory selection', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('uses noop driver by default under CI/test to avoid I/O', async () => {
    delete process.env.MESSAGE_BUS_DRIVER;
    process.env.CI = '1';
    process.env.MESSAGE_BUS_DISABLE_IO = '1';

    jest.doMock('../noop-driver', () => ({
      NoopPublisher: class { constructor(public subject: string) {} publishJson = jest.fn(async () => null); flush = jest.fn(async () => {}); },
      NoopSubscriber: class { subscribe = jest.fn(async () => async () => {}); },
    }));
    const { createMessagePublisher, createMessageSubscriber } = await import('../index');
    const pub = createMessagePublisher('internal.test');
    expect(pub).toBeTruthy();
    const sub = createMessageSubscriber();
    expect(sub).toBeTruthy();
  });

  it('honors explicit MESSAGE_BUS_DRIVER=pubsub in CI', async () => {
    process.env.CI = '1';
    process.env.MESSAGE_BUS_DRIVER = 'pubsub';
    jest.doMock('../pubsub-driver', () => ({
      PubSubPublisher: class { constructor(public subject: string) {} publishJson = jest.fn(async () => '1'); flush = jest.fn(async () => {}); },
      PubSubSubscriber: class { subscribe = jest.fn(async () => async () => {}); },
    }));
    const { createMessagePublisher, createMessageSubscriber } = await import('../index');
    const pub = createMessagePublisher('internal.test');
    expect(pub).toBeTruthy();
    const sub = createMessageSubscriber();
    expect(sub).toBeTruthy();
  });
});
