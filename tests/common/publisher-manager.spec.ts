jest.mock('../../src/services/message-bus', () => {
  const flush1 = jest.fn().mockResolvedValue(undefined);
  const flush2 = jest.fn().mockResolvedValue(undefined);
  const pub1 = { publishJson: jest.fn(), flush: flush1 };
  const pub2 = { publishJson: jest.fn(), flush: flush2 };
  let callCount = 0;
  return {
    createMessagePublisher: jest.fn((subject: string) => {
      callCount++;
      if (subject === 's1') return pub1 as any;
      if (subject === 's2') return pub2 as any;
      return { publishJson: jest.fn(), flush: jest.fn() } as any;
    }),
    __pub1: pub1,
    __pub2: pub2,
  };
});

import { PublisherManager } from '../../src/common/resources/publisher-manager';

describe('PublisherManager', () => {
  it('caches publishers per subject and reuses same instance', async () => {
    const mgr = new PublisherManager();
    const res = mgr.setup({} as any);
    const p1a = res.create('s1');
    const p1b = res.create('s1');
    const p2 = res.create('s2');
    expect(p1a).toBe(p1b);
    expect(p1a).not.toBe(p2);
  });

  it('flushAll best-effort calls flush on all cached publishers', async () => {
    const mgr = new PublisherManager();
    const res = mgr.setup({} as any);
    res.create('s1');
    res.create('s2');
    const nmod: any = require('../../src/services/message-bus');
    // Make one flush throw to ensure best-effort behavior
    (nmod.__pub1.flush as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(res.flushAll()).resolves.toBeUndefined();
    expect(nmod.__pub1.flush).toHaveBeenCalled();
    expect(nmod.__pub2.flush).toHaveBeenCalled();
  });

  it('shutdown flushes and clears cache without throwing', async () => {
    const mgr = new PublisherManager();
    const res = mgr.setup({} as any);
    res.create('s1');
    await expect(mgr.shutdown(res)).resolves.toBeUndefined();
  });
});
