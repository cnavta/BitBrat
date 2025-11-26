import { jest } from '@jest/globals';

describe('message-bus factory', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('creates PubSub driver by default', async () => {
    process.env.MESSAGE_BUS_DRIVER = '';
    jest.doMock('./pubsub-driver', () => ({
      PubSubPublisher: class { constructor(public subject: string) {} publishJson = jest.fn(async () => '1'); flush = jest.fn(async () => {}); },
      PubSubSubscriber: class { subscribe = jest.fn(async () => async () => {}); },
    }));
    const { createMessagePublisher, createMessageSubscriber } = await import('./index');
    const pub = createMessagePublisher('internal.test');
    expect(pub).toBeTruthy();
    const sub = createMessageSubscriber();
    expect(sub).toBeTruthy();
  });

  it('creates NATS driver when MESSAGE_BUS_DRIVER=nats', async () => {
    process.env.MESSAGE_BUS_DRIVER = 'nats';
    jest.doMock('./nats-driver', () => ({
      NatsPublisher: class { constructor(public subject: string) {} publishJson = jest.fn(async () => '1'); flush = jest.fn(async () => {}); },
      NatsSubscriber: class { subscribe = jest.fn(async () => async () => {}); },
    }));
    const { createMessagePublisher, createMessageSubscriber } = await import('./index');
    const pub = createMessagePublisher('internal.test');
    expect(pub).toBeTruthy();
    const sub = createMessageSubscriber();
    expect(sub).toBeTruthy();
  });
});
