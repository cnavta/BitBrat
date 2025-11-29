import { createApp } from './event-router-service';
import { INTERNAL_USER_ENRICHED_V1 } from '../types/events';

jest.mock('../services/message-bus', () => {
  const subscribe = jest.fn(async (_subject: string, _handler: any) => {
    return async () => {};
  });
  const singleton = { subscribe };
  return {
    __esModule: true,
    createMessageSubscriber: () => singleton,
  };
});

describe('event-router-service', () => {
  it('subscribes to internal.user.enriched.v1 (default) with BUS_PREFIX when creating app', async () => {
    const origEnv = process.env.BUS_PREFIX;
    process.env.BUS_PREFIX = 'test.';

    const mb = require('../services/message-bus');
    const subFn = mb.createMessageSubscriber().subscribe as jest.Mock;

    createApp();

    // setup() is async; wait a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(subFn).toHaveBeenCalled();
    const [subject, handler, opts] = subFn.mock.calls[0];
    expect(subject).toBe(`test.${INTERNAL_USER_ENRICHED_V1}`);
    expect(typeof handler).toBe('function');
    expect(opts).toMatchObject({ queue: 'event-router', ack: 'explicit' });

    process.env.BUS_PREFIX = origEnv;
  });

  it('allows overriding default input topic via ROUTER_DEFAULT_INPUT_TOPIC', async () => {
    const origPrefix = process.env.BUS_PREFIX;
    const origDefault = process.env.ROUTER_DEFAULT_INPUT_TOPIC;
    process.env.BUS_PREFIX = 'test.';
    process.env.ROUTER_DEFAULT_INPUT_TOPIC = 'internal.custom.topic.v1';

    const mb = require('../services/message-bus');
    const subFn = mb.createMessageSubscriber().subscribe as jest.Mock;
    // Ensure no stale calls from previous tests
    if (typeof subFn.mockClear === 'function') subFn.mockClear();

    createApp();

    await new Promise((r) => setTimeout(r, 0));

    expect(subFn).toHaveBeenCalled();
    const calls = subFn.mock.calls;
    const [subject] = calls[calls.length - 1];
    expect(subject).toBe('test.internal.custom.topic.v1');

    process.env.BUS_PREFIX = origPrefix;
    if (origDefault === undefined) delete process.env.ROUTER_DEFAULT_INPUT_TOPIC; else process.env.ROUTER_DEFAULT_INPUT_TOPIC = origDefault;
  });
});
