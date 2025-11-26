import { createApp } from './event-router-service';
import { INTERNAL_INGRESS_V1 } from '../types/events';

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
  it('subscribes to internal.ingress.v1 with BUS_PREFIX when creating app', async () => {
    const origEnv = process.env.BUS_PREFIX;
    process.env.BUS_PREFIX = 'test.';

    const mb = require('../services/message-bus');
    const subFn = mb.createMessageSubscriber().subscribe as jest.Mock;

    createApp();

    // setup() is async; wait a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(subFn).toHaveBeenCalled();
    const [subject, handler, opts] = subFn.mock.calls[0];
    expect(subject).toBe(`test.${INTERNAL_INGRESS_V1}`);
    expect(typeof handler).toBe('function');
    expect(opts).toMatchObject({ queue: 'event-router' });

    process.env.BUS_PREFIX = origEnv;
  });
});
