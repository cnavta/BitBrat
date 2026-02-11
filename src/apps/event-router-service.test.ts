import { createApp } from './event-router-service';
import { INTERNAL_INGRESS_V1, INTERNAL_ENRICHED_V1 } from '../types/events';

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
  it('subscribes to internal.ingress.v1 and internal.enriched.v1 with BUS_PREFIX when creating app', async () => {
    const origEnv = process.env.BUS_PREFIX;
    process.env.BUS_PREFIX = 'test.';

    const mb = require('../services/message-bus');
    const subFn = mb.createMessageSubscriber().subscribe as jest.Mock;
    subFn.mockClear();

    createApp();

    // setup() is async; wait a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(subFn).toHaveBeenCalledTimes(2);
    const topics = subFn.mock.calls.map(c => c[0]);
    expect(topics).toContain(`test.${INTERNAL_INGRESS_V1}`);
    expect(topics).toContain(`test.${INTERNAL_ENRICHED_V1}`);
    
    const [,, opts] = subFn.mock.calls[0];
    expect(opts).toMatchObject({ queue: 'event-router', ack: 'explicit' });

    process.env.BUS_PREFIX = origEnv;
  });

  it('no longer uses ROUTER_DEFAULT_INPUT_TOPIC override as it subscribes to fixed topics from architecture.yaml', async () => {
    const origPrefix = process.env.BUS_PREFIX;
    process.env.BUS_PREFIX = 'test.';

    const mb = require('../services/message-bus');
    const subFn = mb.createMessageSubscriber().subscribe as jest.Mock;
    subFn.mockClear();

    createApp();

    await new Promise((r) => setTimeout(r, 0));

    expect(subFn).toHaveBeenCalledTimes(2);
    const topics = subFn.mock.calls.map(c => c[0]);
    expect(topics).toContain(`test.${INTERNAL_INGRESS_V1}`);
    expect(topics).toContain(`test.${INTERNAL_ENRICHED_V1}`);

    process.env.BUS_PREFIX = origPrefix;
  });
});
